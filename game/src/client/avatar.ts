import * as THREE from "three/webgpu";
import { hash, isFarDetail, loadClip, loadPerson, peopleManifest } from "./crowd";

// A player's person: a real Rocketbox human (crowd.ts, research 20) with its
// own animation mixer, walking and idling to match its speed. Until the model
// has loaded, or if it can't, the old low-poly box person stands in.

const SKINS = [0x5b3a29, 0x6b4430, 0x7a4e36, 0x8d5b3e, 0x4a2f22, 0x9b6a4a];
const TROUSERS = [0x2b2d42, 0x3d405b, 0x1f1f1f, 0x4b3f2f, 0x5c677d];
const HAIR = [0x111111, 0x1b1410, 0x2a1d14];

const shared = new Map<string, THREE.BufferGeometry>();
const material = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.85 });
const shadowMat = new THREE.MeshBasicNodeMaterial({ color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false });
const shadowGeo = new THREE.CircleGeometry(0.42, 12).rotateX(-Math.PI / 2);

/** Box with per-face baked shading, translated so its pivot is at the top centre. */
function shadedBox(w: number, h: number, d: number, hex: number, pivotTop: boolean): THREE.BufferGeometry {
  const key = `${w},${h},${d},${hex},${pivotTop}`;
  const hit = shared.get(key);
  if (hit) return hit;
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  if (pivotTop) g.translate(0, -h / 2, 0);
  const base = new THREE.Color(hex);
  const cols: number[] = [];
  for (let i = 0; i < g.getAttribute("position").count; i++) cols.push(base.r, base.g, base.b);
  g.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
  g.deleteAttribute("uv");
  shared.set(key, g);
  return g;
}

export class Avatar {
  root = new THREE.Group();
  private boxes: THREE.Object3D[] = [];
  private mixer: THREE.AnimationMixer | null = null;
  private walk: THREE.AnimationAction | null = null;
  private idle: THREE.AnimationAction | null = null;
  private walkSpeed = 1.1;
  private legL: THREE.Mesh;
  private legR: THREE.Mesh;
  private armL: THREE.Mesh;
  private armR: THREE.Mesh;
  private phase = 0;

  constructor(shirt: number, seed: number) {
    const skin = SKINS[seed % SKINS.length];
    const trousers = TROUSERS[(seed >> 3) % TROUSERS.length];
    const hair = HAIR[(seed >> 5) % HAIR.length];

    // Torso + head + hair merged into one mesh.
    const body = new THREE.BufferGeometry();
    const torso = shadedBox(0.5, 0.62, 0.28, shirt, false).clone().translate(0, 1.2, 0);
    const neck = shadedBox(0.14, 0.08, 0.14, skin, false).clone().translate(0, 1.55, 0);
    const head = shadedBox(0.3, 0.32, 0.3, skin, false).clone().translate(0, 1.75, 0);
    const cap = shadedBox(0.32, 0.08, 0.32, hair, false).clone().translate(0, 1.92, 0);
    mergeInto(body, [torso, neck, head, cap]);
    this.root.add(new THREE.Mesh(body, material));

    this.legL = new THREE.Mesh(shadedBox(0.2, 0.88, 0.22, trousers, true), material);
    this.legR = new THREE.Mesh(shadedBox(0.2, 0.88, 0.22, trousers, true), material);
    this.legL.position.set(-0.13, 0.89, 0);
    this.legR.position.set(0.13, 0.89, 0);
    this.armL = new THREE.Mesh(shadedBox(0.13, 0.6, 0.15, skin, true), material);
    this.armR = new THREE.Mesh(shadedBox(0.13, 0.6, 0.15, skin, true), material);
    this.armL.position.set(-0.33, 1.48, 0);
    this.armR.position.set(0.33, 1.48, 0);
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.position.y = 0.06;
    this.root.add(this.legL, this.legR, this.armL, this.armR, shadow);
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh && o !== shadow) o.castShadow = true;
    });
    this.boxes = [...this.root.children].filter((o) => o !== shadow);
    void this.becomeHuman(seed);
  }

  /** Swap the box body for a real person, picked from the seed. */
  private async becomeHuman(seed: number) {
    const man = await peopleManifest();
    if (!man?.avatars.length) return;
    const a = man.avatars[hash(seed) % man.avatars.length];
    try {
      const [scene, walk, idle] = await Promise.all([loadPerson(a.name), loadClip(man.clips[a.sex].walk[0]), loadClip(man.clips[a.sex].idle[0])]);
      // Near detail only: this person is always close to the camera.
      scene.traverse((o) => {
        if (isFarDetail(o.name)) o.visible = false;
        if ((o as THREE.Mesh).isMesh) o.castShadow = true;
      });
      this.mixer = new THREE.AnimationMixer(scene);
      if (walk) {
        this.walk = this.mixer.clipAction(walk).play();
        this.walk.setEffectiveWeight(0);
        this.walkSpeed = man.walkSpeed[walk.name] ?? 1.1;
      }
      if (idle) this.idle = this.mixer.clipAction(idle).play();
      for (const b of this.boxes) b.visible = false;
      this.root.add(scene);
    } catch {
      // Keep the box person.
    }
  }

  /** speed in m/s drives the walk cycle. */
  animate(dt: number, speed: number) {
    const moving = speed > 0.2;
    if (this.mixer) {
      // Fade between standing and walking, and play the walk at the pace
      // that matches the ground speed so feet don't slide.
      const w = this.walk, i = this.idle;
      const target = moving ? 1 : 0;
      if (w) {
        const cur = w.getEffectiveWeight();
        w.setEffectiveWeight(cur + (target - cur) * Math.min(1, dt * 6));
        w.timeScale = moving ? Math.min(2.5, speed / this.walkSpeed) : 1;
      }
      if (i) i.setEffectiveWeight(1 - (w?.getEffectiveWeight() ?? 0));
      this.mixer.update(dt);
      return;
    }
    this.phase += dt * (moving ? 2.2 + speed * 1.1 : 0);
    const swing = moving ? Math.min(0.75, 0.25 + speed * 0.09) : 0;
    const s = Math.sin(this.phase) * swing;
    const ease = moving ? 1 : Math.min(1, dt * 10);
    this.legL.rotation.x += (s - this.legL.rotation.x) * ease;
    this.legR.rotation.x += (-s - this.legR.rotation.x) * ease;
    this.armL.rotation.x += (-s * 0.8 - this.armL.rotation.x) * ease;
    this.armR.rotation.x += (s * 0.8 - this.armR.rotation.x) * ease;
    this.root.position.y = moving ? Math.abs(Math.cos(this.phase)) * 0.05 * swing : 0;
  }
}

function mergeInto(target: THREE.BufferGeometry, parts: THREE.BufferGeometry[]) {
  const pos: number[] = [];
  const col: number[] = [];
  const nrm: number[] = [];
  for (const p of parts) {
    pos.push(...(p.getAttribute("position").array as Float32Array));
    col.push(...(p.getAttribute("color").array as Float32Array));
    nrm.push(...(p.getAttribute("normal").array as Float32Array));
  }
  target.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  target.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  target.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  target.computeBoundingSphere();
}
