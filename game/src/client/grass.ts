import * as THREE from "three/webgpu";
import { Fn, attribute, cameraPosition, float, fract, hash, instanceIndex, int, mix, normalLocal, positionLocal, sin, smoothstep, step, texture, uint, uniform, vec2, vec3 } from "three/tsl";
import { clockUniform } from "./facade";

// Grass blades on the bare ground near the camera (the technique of Ghost of
// Tsushima's and SimonDev's Quick_Grass, research 22): a grid of clumps that
// follows the player, placed, sized, coloured and swayed entirely in the
// vertex shader, faded out by RADIUS into the ground's grass texture.
//
// Where grass may grow comes from a coverage mask: the static world rendered
// top-down around the player, recording whether the topmost surface is grass
// (the bare ground, code -5, or a green area drawn over it). Roads,
// footpaths, junctions, driveways, walls, hedges and buildings all cover it,
// so blades never poke through.

/** Blades fade out by this distance, m. */
const RADIUS = 28;
/** Clump spacing, m. */
const SPACING = 0.32;
/** Clumps per side of the grid. */
const N = Math.ceil((2 * RADIUS) / SPACING);
/** The coverage mask covers this square around the player, m (wider than the grid, so it can lag). */
const MASK = 80;
/** Re-render the mask after moving this far, m. */
const REMASK = 10;
/** Blades per clump. */
const BLADES = 10;

/** The layout numbers, for tests. The grid plus a REMASK of travel must stay inside the mask, or blades sample past its edge. */
export const GRASS = { RADIUS, SPACING, N, MASK, REMASK, BLADES };

/** The whole-number grid cell a coordinate falls in. */
export function gridCell(v: number) {
  return Math.round(v / SPACING);
}

/** One clump: BLADES thin blades (base pair, mid pair, tip), height 0..1 in y, spread over one cell. */
export function clumpGeometry() {
  const pos: number[] = [], h: number[] = [], idx: number[] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let b = 0; b < BLADES; b++) {
    const x = (rnd() - 0.5) * SPACING, z = (rnd() - 0.5) * SPACING;
    const a = rnd() * Math.PI, w = 0.018 + rnd() * 0.012, lean = (rnd() - 0.5) * 0.4;
    const cx = Math.cos(a) * w, cz = Math.sin(a) * w;
    const base = pos.length / 3;
    for (const [t, k] of [[0, 1], [0.55, 0.65]] as const) {
      pos.push(x - cx * k + lean * t * 0.1, t, z - cz * k, x + cx * k + lean * t * 0.1, t, z + cz * k);
      h.push(t, t);
    }
    pos.push(x + lean * 0.1, 1, z);
    h.push(1);
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2, base + 2, base + 3, base + 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("blade", new THREE.Float32BufferAttribute(h, 1));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}


export class Grass {
  readonly mesh: THREE.Mesh;
  private target = new THREE.RenderTarget(512, 512, { depthBuffer: true });
  private camera = new THREE.OrthographicCamera(-MASK / 2, MASK / 2, MASK / 2, -MASK / 2, 1, 200);
  private maskScene = new THREE.Scene();
  /** The grid's centre as a whole cell index (exact integers, so a clump's cell never rounds next door). */
  private origin = uniform(new THREE.Vector2());
  private maskCentre = uniform(new THREE.Vector2(1e9, 1e9));
  private at = new THREE.Vector2(1e9, 1e9);

  /** `ground` is what covers the ground (the world's static meshes), `hide` what must not (trees: grass grows under them). */
  constructor(private ground: THREE.Object3D, private hide: THREE.Object3D[] = []) {
    // Mask: 1 where the topmost surface isn't grass. Grass is the bare ground
    // (code -5) and the green areas drawn over it (parks, greens, verges: plain
    // code -1 in a green vertex colour).
    const code = attribute("facade", "vec4").z, col = attribute("color", "vec3");
    const bare = step(-5.5, code).mul(step(code, -4.5));
    const greenArea = step(-1.5, code).mul(step(code, -0.5)).mul(step(col.r.mul(1.1), col.g)).mul(step(col.b.mul(1.1), col.g));
    const cover = new THREE.MeshBasicNodeMaterial();
    cover.colorNode = vec3(float(1).sub(bare.max(greenArea)));
    this.maskScene.overrideMaterial = cover;
    this.camera.up.set(0, 0, -1);

    const mat = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, roughness: 0.9 });
    const blade = attribute("blade", "float");
    const cell = Fn(() => {
      const i = int(instanceIndex);
      return vec2(float(i.mod(N)), float(i.div(N))).sub(N / 2);
    });
    // The clump's cell (whole numbers) and place: the grid around the player, so blades don't swim as it moves.
    const cellAt = Fn(() => this.origin.add(cell()))();
    const base = cellAt.mul(SPACING);
    // A stable hash of the cell (0..1), in integers (PCG): same cell, same clump, anywhere on the map.
    const ix = uint(int(cellAt.x).add(1 << 20)), iz = uint(int(cellAt.y).add(1 << 20));
    const rnd = hash(ix.mul(73856093).bitXor(iz.mul(19349663)));
    // Where the mask says the ground is covered, and toward the edge of the grid, blades shrink to nothing.
    const muv = base.sub(this.maskCentre).div(MASK).add(0.5);
    const covered = texture(this.target.texture, muv).level(float(0)).r;
    const fade = float(1).sub(smoothstep(float(RADIUS - 8), float(RADIUS), base.sub(cameraPosition.xz).length()));
    const h = mix(float(0.07), float(0.16), rnd).mul(fade).mul(float(1).sub(step(0.2, covered)));
    // No visible grid: each clump turned and nudged within its cell.
    const turn = fract(rnd.mul(13.71)).mul(6.2832), nudge = vec2(fract(rnd.mul(71.3)), fract(rnd.mul(37.9))).sub(0.5).mul(SPACING);
    mat.positionNode = Fn(() => {
      const p0 = positionLocal;
      const ct = turn.cos(), st = turn.sin();
      const p = vec3(p0.x.mul(ct).sub(p0.z.mul(st)).add(nudge.x), p0.y, p0.x.mul(st).add(p0.z.mul(ct)).add(nudge.y));
      // Wind: a slow wave across the field, bending the tips most.
      const sway = sin(clockUniform.mul(1.6).add(base.x.mul(0.35)).add(base.y.mul(0.25)).add(rnd.mul(6.28))).mul(0.05).mul(blade.mul(blade));
      normalLocal.assign(vec3(0, 1, 0));
      return vec3(base.x.add(p.x).add(sway.mul(h).mul(4)), p.y.mul(h), base.y.add(p.z));
    })();
    // Darker at the root, lighter and yellower at the tip, each clump a little different.
    mat.colorNode = mix(vec3(0.07, 0.14, 0.04), vec3(0.2, 0.31, 0.1), blade).mul(mix(float(0.85), float(1.15), rnd));
    this.mesh = new THREE.Mesh(clumpGeometry(), mat);
    this.mesh.count = N * N;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
  }

  /** Call before rendering each frame with the camera's position. */
  update(renderer: THREE.WebGPURenderer, x: number, z: number) {
    this.origin.value.set(gridCell(x), gridCell(z));
    if (this.at.distanceToSquared(new THREE.Vector2(x, z)) < REMASK * REMASK) return;
    this.at.set(x, z);
    this.renderMask(renderer, x, z);
  }

  /** Render what covers the ground, top-down, around (x, z). */
  private renderMask(renderer: THREE.WebGPURenderer, x: number, z: number) {
    const parent = this.ground.parent;
    const hidden = this.hide.map((o) => [o, o.visible] as const);
    for (const [o] of hidden) o.visible = false;
    this.maskScene.add(this.ground);
    this.camera.position.set(x, 100, z);
    this.camera.lookAt(x, 0, z);
    this.camera.updateMatrixWorld();
    const prev = renderer.getRenderTarget();
    const clear = renderer.getClearColor(new THREE.Color()), alpha = renderer.getClearAlpha();
    // Cleared to covered: where nothing is drawn (past the world's edge), no grass.
    renderer.setClearColor(0xffffff, 1);
    renderer.setRenderTarget(this.target);
    renderer.render(this.maskScene, this.camera);
    renderer.setRenderTarget(prev);
    renderer.setClearColor(clear, alpha);
    parent?.add(this.ground);
    for (const [o, v] of hidden) o.visible = v;
    this.maskCentre.value.set(x, z);
  }
}
