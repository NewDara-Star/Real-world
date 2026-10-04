import * as THREE from "three/webgpu";
import { FACADE_FLAT_ROOF, FACADE_HEDGE, FACADE_PATH } from "./facade";
import type { GardenPlanner, Piece } from "./gardens";
import type { StreetModels } from "./models";
import { makeTemplate } from "./props";
import { Builder, type World } from "./world";

// Street detail near the player: front gardens, real lamp posts and the walls
// and hedges OSM maps. Small things in their thousands (Finglas has ~15,000
// front gardens) would cost hundreds of MB if built for the whole map at
// once, so, like the cull distances and streaming cells of open-world games,
// they are built in 100 m cells as the player approaches and dropped behind
// them. Bins (the most detailed model) have a shorter radius than walls.

const CELL = 100;
/** Build cells whose centre is within FAR, drop them beyond DROP; bins within NEAR. */
const FAR = 320, DROP = 400, NEAR = 140, NEAR_DROP = 190;
/** Cells built per update, so a teleport doesn't stall one frame. */
const PER_UPDATE = 2;

const HEDGE = makeTemplate([[hedgeBox(), 0x3f6a2e, FACADE_HEDGE]]);
const DRIVE = 0x9a9893, PATH = 0xb3ab9e;

/** A 1 m hedge section (x -0.5..0.5, 1 m tall, 1 m deep), its top a little narrower like a clipped hedge. */
function hedgeBox() {
  const g = new THREE.BoxGeometry(1, 1, 1, 1, 2, 1).translate(0, 0.5, 0);
  const p = g.getAttribute("position");
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0.99) p.setZ(i, p.getZ(i) * 0.82);
  g.computeVertexNormals();
  return g;
}

interface Cell {
  buildings: number[];
  lamps: number[];
  barriers: number[];
}

export interface StreetLamp {
  x: number;
  z: number;
  /** Facing: the arm reaches out along (sin rot, cos rot). */
  rot: number;
}

export interface Barrier {
  /** 0 wall, 1 hedge, 2 retaining wall (tools/bake/osm_features.py). */
  kind: number;
  /** Height in metres. */
  h: number;
  pts: number[];
}

export class StreetDetail {
  group = new THREE.Group();
  private cells = new Map<number, Cell>();
  private far = new Map<number, THREE.Mesh>();
  private near = new Map<number, THREE.Mesh>();

  constructor(
    private world: World,
    private planner: GardenPlanner | null,
    private models: StreetModels,
    private lamps: StreetLamp[],
    private barriers: Barrier[],
    private mat: THREE.Material,
  ) {
    const cell = (x: number, z: number) => {
      const k = key(Math.floor(x / CELL), Math.floor(z / CELL));
      let c = this.cells.get(k);
      if (!c) this.cells.set(k, (c = { buildings: [], lamps: [], barriers: [] }));
      return c;
    };
    if (planner) world.buildings.forEach((b, i) => cell(b.pts[0], b.pts[1]).buildings.push(i));
    lamps.forEach((l, i) => cell(l.x, l.z).lamps.push(i));
    barriers.forEach((b, i) => cell(b.pts[0], b.pts[1]).barriers.push(i));
  }

  /** Build what's near (x, z), drop what's far. Call every frame; it does little when nothing changes. */
  update(x: number, z: number) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    const r = Math.ceil(FAR / CELL);
    let budget = PER_UPDATE;
    // Nearest cells first.
    const todo: [number, number, number][] = [];
    for (let i = -r; i <= r; i++) {
      for (let j = -r; j <= r; j++) {
        const d = Math.hypot((cx + i + 0.5) * CELL - x, (cz + j + 0.5) * CELL - z);
        if (d < FAR) todo.push([d, cx + i, cz + j]);
      }
    }
    todo.sort((a, b) => a[0] - b[0]);
    for (const [d, gx, gz] of todo) {
      if (budget <= 0) break;
      const k = key(gx, gz);
      const c = this.cells.get(k);
      if (!c) continue;
      if (!this.far.has(k)) {
        this.far.set(k, this.add(this.buildFar(c)));
        budget--;
      }
      if (d < NEAR && !this.near.has(k) && budget > 0) {
        this.near.set(k, this.add(this.buildNear(c)));
        budget--;
      }
    }
    for (const [map, limit] of [[this.far, DROP], [this.near, NEAR_DROP]] as const) {
      for (const [k, m] of map) {
        const gx = Math.floor(k / 4000) - 1000, gz = (k % 4000) - 1000;
        if (Math.hypot((gx + 0.5) * CELL - x, (gz + 0.5) * CELL - z) < limit) continue;
        this.group.remove(m);
        m.geometry.dispose();
        map.delete(k);
      }
    }
  }

  /** How many cells are built (far, near): for the debug readout and tests. */
  get built() {
    return [this.far.size, this.near.size];
  }

  private add(b: Builder) {
    const mesh = new THREE.Mesh(b.geometry(), this.mat);
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    return mesh;
  }

  private buildFar(c: Cell): Builder {
    const b = new Builder(this.world.city);
    const m = this.models;
    for (const i of c.buildings) for (const p of this.planner!.pieces(i)) this.piece(b, p);
    for (const i of c.lamps) {
      const l = this.lamps[i];
      b.stamp(m.lamp, l.x, l.z, l.rot, 1);
    }
    for (const i of c.barriers) {
      const { kind, h, pts } = this.barriers[i];
      const height = h;
      for (let k = 0; k + 3 < pts.length; k += 2) {
        if (kind === 1) this.run(b, HEDGE, pts[k], pts[k + 1], pts[k + 2], pts[k + 3], height, 0.8);
        else this.run(b, m.wall.render, pts[k], pts[k + 1], pts[k + 2], pts[k + 3], height / 0.9, 1);
      }
    }
    return b;
  }

  private buildNear(c: Cell): Builder {
    const b = new Builder(this.world.city);
    for (const i of c.buildings) {
      for (const p of this.planner!.pieces(i)) if (p.kind === "bin") b.stamp(this.models.bins[p.colour], p.x, p.z, p.rot, 1);
    }
    return b;
  }

  private piece(b: Builder, p: Piece) {
    const m = this.models;
    switch (p.kind) {
      case "wall":
        return this.run(b, p.brick ? m.wall.brick : m.wall.render, p.ax, p.az, p.bx, p.bz, 1, 1);
      case "hedge":
        return this.run(b, HEDGE, p.ax, p.az, p.bx, p.bz, p.h, p.t);
      case "pier":
        return b.stamp(p.brick ? m.pier.brick : m.pier.render, p.x, p.z, p.rot, 1);
      case "drive":
        return b.flat(p.pts, 0.02, DRIVE, FACADE_FLAT_ROOF);
      case "path":
        return b.flat(p.pts, 0.02, PATH, FACADE_PATH);
      case "bin":
        return; // near layer
    }
  }

  /** A 1 m module stretched along a run from a to b (y and depth scaled by sy, sz). */
  private run(b: Builder, t: Parameters<Builder["stamp"]>[0], ax: number, az: number, bx: number, bz: number, sy: number, sz: number) {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.05) return;
    b.stamp(t, (ax + bx) / 2, (az + bz) / 2, Math.atan2(-(bz - az), bx - ax), 1, 0, [len, sy, sz]);
  }
}

const key = (gx: number, gz: number) => (gx + 1000) * 4000 + (gz + 1000);
