import * as THREE from "three/webgpu";
import { Fn, attribute, float, floor, int, ivec2, mat4, normalLocal, texture, uniform, vec4 } from "three/tsl";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

// Human pedestrians: Microsoft Rocketbox people (MIT; research/20-human-npcs.md),
// built by tools/assets/people/build_people.mjs into public/models/humans.
//
// Hundreds of animated people can't each be a SkinnedMesh with its own
// mixer. Instead, at load, each person's walk and idle clips are played once
// on the CPU and every frame's bone matrices are written into a small float
// texture (one row per frame, four texels per bone). Each person model is
// then drawn once, instanced: every pedestrian is a row of instance data
// (where it stands, which way it faces, which frame of which clip), and the
// vertex shader skins from the texture. One draw per model part per detail
// level, whatever the head count. Technique: GPU Gems 3 ch. 2, Unity's
// animation instancing; built from scratch for three's TSL.

// Bake rates: walking legs need 30 frames a second; people standing still
// move slowly enough for 15, which halves an idle's share of the texture.
const WALK_FPS = 30;
const IDLE_FPS = 15;
const NEAR_LOD = 28; // metres: full detail closer than this

export interface CrowdPed {
  /** Stable id for this pedestrian slot (picks who they are and keeps their stride). */
  key: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Walking speed (m/s); 0 when standing. */
  speed: number;
  /** Knocked down: lying on the ground. */
  lying: boolean;
}

export interface Clip {
  row: number; // first texture row
  frames: number;
  duration: number;
  /** Walking speed the clip was recorded at (m/s), for matching stride to speed. */
  speed: number;
}

interface Part {
  mesh: THREE.Mesh;
  lod: 0 | 1;
}

interface Model {
  name: string;
  sex: "m" | "f";
  walk: Clip[];
  idle: Clip[];
  parts: Part[];
  /** Per detail level: instance data shared by that level's parts. */
  pos: [Float32Array, Float32Array];
  anim: [Float32Array, Float32Array];
  posAttr: [THREE.InstancedBufferAttribute, THREE.InstancedBufferAttribute];
  animAttr: [THREE.InstancedBufferAttribute, THREE.InstancedBufferAttribute];
  count: [number, number];
}

export interface Manifest {
  avatars: { name: string; sex: "m" | "f"; places: string[] }[];
  clips: Record<"m" | "f", { walk: string[]; idle: string[] }>;
  walkSpeed: Record<string, number>;
}

/** Each pedestrian's own state across frames: who they are, where in their stride. */
export interface Walker {
  model: number;
  clip: number; // index into model.walk or model.idle
  walking: boolean;
  phase: number; // 0..1 through the clip
}

/** What the stride logic needs to know about a person model: its clips. */
export interface ClipSet {
  walk: Clip[];
  idle: Clip[];
}

/**
 * Who each pedestrian is and where they are in their stride, frame to frame.
 * No GPU here, so it's tested headless (tests/crowd.test.mts).
 */
export class Strides {
  private walkers = new Map<number, Walker>();
  constructor(private models: ClipSet[]) {}

  /** Advance one pedestrian; returns which model, which clip and how far through it (0..1). */
  step(p: CrowdPed, dt: number): { model: number; clip: Clip; phase: number } | null {
    if (!this.models.length) return null;
    let w = this.walkers.get(p.key);
    if (!w) {
      // A stable pick from the key, so a person doesn't change into someone
      // else between frames. (Unsigned shifts: the hash is a full 32 bits.)
      const h = hash(p.key);
      w = { model: h % this.models.length, clip: (h >>> 8) % 3, walking: true, phase: ((h >>> 16) % 1000) / 1000 };
      this.walkers.set(p.key, w);
    }
    const m = this.models[w.model];
    const walking = p.speed > 0.15 && !p.lying;
    if (walking !== w.walking) {
      w.walking = walking;
      w.clip = hash(p.key + (walking ? 7 : 13)) % Math.max(1, walking ? m.walk.length : m.idle.length);
      w.phase = 0;
    }
    let clips = walking ? m.walk : m.idle;
    let ci = Math.min(w.clip, clips.length - 1);
    // Slow walkers use the slow walk if there is one (the third walk clip).
    if (walking && p.speed < 0.9 && m.walk.length > 2) ci = 2;
    if (!clips.length) {
      clips = m.walk.length ? m.walk : m.idle;
      ci = 0;
    }
    const c = clips[ci];
    if (!c) return null;
    // Stride matches ground speed: one cycle covers (clip speed × duration)
    // metres, so play it faster or slower to fit. Capped so a glitchy speed
    // can't spin legs absurdly.
    const rate = walking && c.speed > 0 ? Math.min(3, p.speed / c.speed) : 1;
    w.phase = (w.phase + (dt * rate) / Math.max(1e-3, c.duration)) % 1;
    if (!Number.isFinite(w.phase) || w.phase < 0) w.phase = 0;
    return { model: w.model, clip: c, phase: w.phase };
  }

  /** Forget pedestrians not seen this frame. */
  keep(seen: Set<number>) {
    for (const k of this.walkers.keys()) if (!seen.has(k)) this.walkers.delete(k);
  }
}

export class Crowd {
  readonly group = new THREE.Group();
  private strides: Strides;

  private constructor(private models: Model[], private capacity: number) {
    for (const m of models) for (const p of m.parts) this.group.add(p.mesh);
    this.strides = new Strides(models);
  }

  /** Load the people for a place. Resolves to null if the models aren't there (the game keeps its simple walkers). */
  static async load(place: string, capacity: number): Promise<Crowd | null> {
    const man = await peopleManifest();
    if (!man) return null;
    const pool = man.avatars.filter((a) => a.places.includes(place));
    const list = pool.length ? pool : man.avatars;
    const models = (await Promise.all(list.map(async (a) => {
      try {
        const gltf = await loader.loadAsync(`${BASE}${a.name}.glb`);
        const walk = await Promise.all(man.clips[a.sex].walk.map(loadClip));
        const idle = await Promise.all(man.clips[a.sex].idle.map(loadClip));
        return buildModel(a.name, a.sex, gltf.scene, walk, idle, man, capacity);
      } catch (err) {
        console.warn(`person ${a.name} didn't load`, err);
        return null;
      }
    }))).filter((m): m is Model => !!m);
    return models.length ? new Crowd(models, capacity) : null;
  }

  /** Place everyone for this frame. `eye` picks the detail level by distance. */
  update(peds: CrowdPed[], eyeX: number, eyeZ: number, dt: number) {
    for (const m of this.models) m.count = [0, 0];
    const seen = new Set<number>();
    for (const p of peds) {
      seen.add(p.key);
      const st = this.strides.step(p, dt);
      if (!st) continue;
      const m = this.models[st.model], c = st.clip;
      const lod = (p.x - eyeX) ** 2 + (p.z - eyeZ) ** 2 < NEAR_LOD * NEAR_LOD ? 0 : 1;
      const i = m.count[lod]++;
      if (i >= this.capacity) continue;
      m.pos[lod].set([p.x, p.y, p.z, p.yaw], i * 4);
      m.anim[lod].set([c.row, c.frames, st.phase, p.lying ? 1 : 0], i * 4);
    }
    this.strides.keep(seen);
    for (const m of this.models) {
      for (const lod of [0, 1] as const) {
        const n = Math.min(this.capacity, m.count[lod]);
        m.posAttr[lod].needsUpdate = true;
        m.animAttr[lod].needsUpdate = true;
        for (const part of m.parts) if (part.lod === lod) {
          part.mesh.count = n;
          part.mesh.visible = n > 0;
        }
      }
    }
  }

  dispose() {
    for (const m of this.models) for (const p of m.parts) {
      p.mesh.geometry.dispose();
      (p.mesh.material as THREE.Material).dispose();
    }
  }
}

// ---- shared loading (the crowd and the players' own people use the same files) ----

const BASE = "/models/humans/";
const loader = new GLTFLoader();
let manifest: Promise<Manifest | null> | null = null;
const clips = new Map<string, Promise<THREE.AnimationClip | null>>();

/** The list of people and clips (public/models/humans/people.json), or null if missing. */
export function peopleManifest(): Promise<Manifest | null> {
  manifest ??= fetch(BASE + "people.json").then((r) => (r.ok ? r.json() : null), () => null);
  return manifest;
}

/** A clip by name, cached. Walks are recorded in place except a little forward
 * drift; the root's forward position is pinned so people don't slide inside the stride. */
export function loadClip(name: string): Promise<THREE.AnimationClip | null> {
  let p = clips.get(name);
  if (!p) {
    p = loader.loadAsync(`${BASE}clips/${name}.glb`).then((g) => {
      const c = g.animations[0];
      if (!c) return null;
      c.name = name;
      for (const t of c.tracks) {
        if (t.name !== "Bip01.position") continue;
        const z0 = t.values[2];
        for (let i = 2; i < t.values.length; i += 3) t.values[i] = z0;
      }
      return c;
    }, () => null);
    clips.set(name, p);
  }
  return p;
}

/** One person's model, for a single skinned character (players). */
export async function loadPerson(name: string) {
  return (await loader.loadAsync(`${BASE}${name}.glb`)).scene;
}

/** Far-detail parts are named "..._lod1" by the build; the loader appends "_1", "_2"… per material. */
export function isFarDetail(name: string) {
  return name.includes("_lod1");
}

export function hash(n: number) {
  let h = (n * 2654435761) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519) >>> 0;
  return (h ^ (h >>> 13)) >>> 0;
}

/** Bake a person's clips into a bone-matrix texture and make their instanced parts. */
function buildModel(name: string, sex: "m" | "f", scene: THREE.Object3D, walk: (THREE.AnimationClip | null)[], idle: (THREE.AnimationClip | null)[], man: Manifest, capacity: number): Model | null {
  const skinned: THREE.SkinnedMesh[] = [];
  scene.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh);
  });
  if (!skinned.length) return null;
  const skeleton = skinned[0].skeleton;
  const bones = skeleton.bones.length;
  scene.updateMatrixWorld(true);

  // Bake: every frame of every clip, one row each.
  const clips: { clip: THREE.AnimationClip; walk: boolean }[] = [
    ...walk.filter((c): c is THREE.AnimationClip => !!c).map((clip) => ({ clip, walk: true })),
    ...idle.filter((c): c is THREE.AnimationClip => !!c).map((clip) => ({ clip, walk: false })),
  ];
  const fps = (walk: boolean) => (walk ? WALK_FPS : IDLE_FPS);
  const rows = clips.reduce((s, c) => s + Math.max(1, Math.round(c.clip.duration * fps(c.walk))), 0);
  const width = bones * 4;
  const data = new Uint16Array(width * rows * 4);
  const mixer = new THREE.AnimationMixer(scene);
  const walkClips: Clip[] = [], idleClips: Clip[] = [];
  let row = 0;
  for (const { clip, walk: isWalk } of clips) {
    const frames = Math.max(1, Math.round(clip.duration * fps(isWalk)));
    const action = mixer.clipAction(clip);
    action.play();
    for (let f = 0; f < frames; f++) {
      mixer.setTime((f / frames) * clip.duration);
      scene.updateMatrixWorld(true);
      skeleton.update();
      const m = skeleton.boneMatrices!;
      const o = (row + f) * width * 4;
      for (let k = 0; k < bones * 16; k++) data[o + k] = THREE.DataUtils.toHalfFloat(m[k]);
    }
    action.stop();
    (isWalk ? walkClips : idleClips).push({ row, frames, duration: clip.duration, speed: isWalk ? man.walkSpeed[clip.name] ?? 1.1 : 0 });
    row += frames;
  }
  mixer.stopAllAction();
  const bake = new THREE.DataTexture(data, width, rows, THREE.RGBAFormat, THREE.HalfFloatType);
  bake.needsUpdate = true;
  const bakeTex = texture(bake);

  const pos: [Float32Array, Float32Array] = [new Float32Array(capacity * 4), new Float32Array(capacity * 4)];
  const anim: [Float32Array, Float32Array] = [new Float32Array(capacity * 4), new Float32Array(capacity * 4)];
  const posAttr = pos.map((a) => new THREE.InstancedBufferAttribute(a, 4).setUsage(THREE.DynamicDrawUsage)) as Model["posAttr"];
  const animAttr = anim.map((a) => new THREE.InstancedBufferAttribute(a, 4).setUsage(THREE.DynamicDrawUsage)) as Model["animAttr"];

  // TSL's typings don't follow int nodes through toVar(); these are int nodes.
  type IntNode = ReturnType<typeof int>;
  const boneMat = (b: IntNode, frame: IntNode) => {
    const x = b.mul(4);
    const row = (k: number) => bakeTex.load(ivec2(x.add(k), frame));
    return mat4(row(0), row(1), row(2), row(3));
  };

  const parts: Part[] = [];
  for (const sm of skinned) {
    const lod: 0 | 1 = isFarDetail(sm.name) ? 1 : 0;
    const g = sm.geometry.clone();
    g.setAttribute("iPos", posAttr[lod]);
    g.setAttribute("iAnim", animAttr[lod]);
    const world = uniform(sm.matrixWorld.clone());
    const bind = uniform(sm.bindMatrix.clone()), bindInv = uniform(sm.bindMatrixInverse.clone());
    const src = sm.material as THREE.MeshStandardMaterial;
    const mat = new THREE.MeshStandardNodeMaterial({
      map: src.map, normalMap: src.normalMap, color: src.color, roughness: 0.85, metalness: 0,
      alphaTest: src.alphaTest || (src.transparent ? 0.4 : 0), side: src.side,
    });
    mat.positionNode = Fn(() => {
      const ip = attribute("iPos", "vec4"), ia = attribute("iAnim", "vec4");
      const frame = int(ia.x.add(floor(ia.z.mul(ia.y)).min(ia.y.sub(1)))) as IntNode;
      const si = attribute("skinIndex", "uvec4"), sw = attribute("skinWeight", "vec4");
      const skin = boneMat(int(si.x), frame).mul(sw.x)
        .add(boneMat(int(si.y), frame).mul(sw.y))
        .add(boneMat(int(si.z), frame).mul(sw.z))
        .add(boneMat(int(si.w), frame).mul(sw.w)).toVar();
      // Where the pedestrian stands and faces (yaw about +y), lying flat
      // (pitched forward) when knocked down.
      const cy = ip.w.cos(), sy = ip.w.sin();
      const lying = ia.w;
      const yawM = mat4(vec4(cy, 0, sy.negate(), 0), vec4(0, 1, 0, 0), vec4(sy, 0, cy, 0), vec4(ip.x, ip.y.add(lying.mul(0.15)), ip.z, 1));
      const pitch = mat4(vec4(1, 0, 0, 0), vec4(0, float(1).sub(lying), lying, 0), vec4(0, lying.negate(), float(1).sub(lying), 0), vec4(0, 0, 0, 1));
      const full = yawM.mul(pitch).mul(world).mul(bindInv).mul(skin).mul(bind).toVar();
      normalLocal.assign(full.mul(vec4(attribute("normal", "vec3"), 0)).xyz.normalize());
      return full.mul(vec4(attribute("position", "vec3"), 1)).xyz;
    })();
    // The instance placement is done in positionNode, so the object itself sits at the origin.
    const mesh = new THREE.Mesh(g, mat);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.name = `${name}:${sm.name}`;
    parts.push({ mesh, lod });
  }
  return { name, sex, walk: walkClips, idle: idleClips, parts, pos, anim, posAttr, animAttr, count: [0, 0] };
}
