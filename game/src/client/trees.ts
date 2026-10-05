import * as THREE from "three/webgpu";
import { createVertexColorMaterial } from "./facade";
import { TEMPLATES, templateGeometry } from "./props";

// Dublin's street trees with a level of detail (research 22): the nearest ones
// are real procedural trees (ez-tree, MIT: branches plus alpha-cut leaves),
// generated once per variant when the library loads; every other tree is the
// cheap low-poly crown, instanced. Which tree gets which is re-decided as the
// player moves. Lagos keeps its palms and almonds stamped into the city.

export interface TreeSpot {
  x: number;
  z: number;
  rot: number;
  /** Size, about 0.8-1.3. */
  s: number;
}

/** Full trees within this distance, m... */
const NEAR = 170;
/** ...but no more than this many (about 1.2M triangles at most). */
const MAX_NEAR = 160;
/** Re-decide near and far after moving this far, m. */
const RELAYOUT = 8;
/** Crowns further than this (the city chunks' draw distance) aren't drawn at all. */
const DEFAULT_RADIUS = 900;

/** ez-tree presets standing in for Dublin's street trees, scaled to real heights (m, at size 1). */
const VARIANTS = [
  { preset: "Ash Small", seed: 11, height: 8 },
  { preset: "Oak Small", seed: 23, height: 7 },
  { preset: "Aspen Medium", seed: 5, height: 10 },
  { preset: "Ash Medium", seed: 42, height: 11 },
];

export class StreetTrees {
  group = new THREE.Group();
  private far: THREE.InstancedMesh;
  /** Per variant, its parts (branches, leaves), instanced for the near trees. */
  private near: THREE.InstancedMesh[][] = [];
  private variant: Uint8Array;
  private at = { x: Infinity, z: Infinity };
  private radius = DEFAULT_RADIUS;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private sv = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);

  constructor(private spots: TreeSpot[]) {
    this.far = new THREE.InstancedMesh(templateGeometry(TEMPLATES.tree), createVertexColorMaterial(0.8), Math.max(1, spots.length));
    // Distant crowns cast no shadows: the sun's shadow map covers about the full trees' range, no further.
    this.far.castShadow = false;
    this.far.frustumCulled = false;
    this.group.add(this.far);
    // Neighbours along a street get different variants (spots come in street order).
    this.variant = Uint8Array.from(spots, (_, i) => i % VARIANTS.length);
    this.layout(Infinity, Infinity);
  }

  /**
   * Generate the real trees (the library loads on demand; `lib` is swappable
   * for tests). All four variants or none: until they're all built, and for
   * good if anything fails, every tree stays a crown.
   */
  async loadNear(lib: () => Promise<{ Tree: typeof import("@dgreenheck/ez-tree").Tree }> = () => import("@dgreenheck/ez-tree")) {
    const built: THREE.InstancedMesh[][] = [];
    try {
      const { Tree } = await lib();
      for (const v of VARIANTS) {
        const t = new Tree();
        t.loadPreset(v.preset);
        t.options.seed = v.seed;
        t.generate();
        t.updateMatrixWorld(true);
        const k = v.height / Math.max(1e-3, new THREE.Box3().setFromObject(t).max.y);
        const parts: THREE.InstancedMesh[] = [];
        t.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          const g = mesh.geometry.clone().applyMatrix4(new THREE.Matrix4().makeScale(k, k, k).multiply(mesh.matrixWorld));
          const part = new THREE.InstancedMesh(g, mesh.material, MAX_NEAR);
          part.count = 0;
          part.castShadow = true;
          part.frustumCulled = false;
          parts.push(part);
        });
        if (!parts.length) throw new Error(`ez-tree ${v.preset}: no meshes`);
        built.push(parts);
      }
    } catch (e) {
      for (const parts of built) for (const p of parts) p.dispose();
      console.warn("Street trees stay low-poly crowns:", e);
      return false;
    }
    this.near = built;
    for (const parts of built) for (const p of parts) this.group.add(p);
    const { x, z } = this.at;
    this.at = { x: Infinity, z: Infinity };
    this.layout(x, z);
    return true;
  }

  /** Call every frame with the player's position and the draw distance; it only re-lays out after moving RELAYOUT m. */
  update(x: number, z: number, radius = DEFAULT_RADIUS) {
    if ((x - this.at.x) ** 2 + (z - this.at.z) ** 2 < RELAYOUT * RELAYOUT && radius === this.radius) return;
    this.radius = radius;
    this.layout(x, z);
  }

  /** Crowns drawn right now (tests and debugging). */
  get farCount() {
    return this.far.count;
  }

  /** Trees drawn as full trees right now (tests and debugging). */
  get nearCount() {
    return this.near.reduce((s, parts) => s + (parts[0]?.count ?? 0), 0);
  }

  private layout(x: number, z: number) {
    this.at = { x, z };
    // The nearest trees within NEAR become full trees (when they've loaded).
    const full = new Set<number>();
    if (this.near.length) {
      const close: [number, number][] = [];
      this.spots.forEach((s, i) => {
        const d = (s.x - x) ** 2 + (s.z - z) ** 2;
        if (d < NEAR * NEAR) close.push([d, i]);
      });
      close.sort((a, b) => a[0] - b[0]);
      for (const [, i] of close.slice(0, MAX_NEAR)) full.add(i);
    }
    const counts = this.near.map(() => 0);
    let far = 0;
    const r2 = this.radius * this.radius;
    this.spots.forEach((s, i) => {
      if (!full.has(i) && (s.x - x) ** 2 + (s.z - z) ** 2 > r2) return;
      this.q.setFromAxisAngle(this.up, s.rot);
      this.m.compose(this.p.set(s.x, 0, s.z), this.q, this.sv.set(s.s, s.s, s.s));
      if (full.has(i)) {
        const v = this.variant[i];
        for (const part of this.near[v]) part.setMatrixAt(counts[v], this.m);
        counts[v]++;
      } else this.far.setMatrixAt(far++, this.m);
    });
    this.far.count = far;
    this.far.instanceMatrix.needsUpdate = true;
    this.near.forEach((parts, v) => {
      for (const part of parts) {
        part.count = counts[v];
        part.instanceMatrix.needsUpdate = true;
      }
    });
  }
}
