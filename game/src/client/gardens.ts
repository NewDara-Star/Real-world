import { mulberry32 } from "./props";
import { ALLOW_CAR, LaneKind, type RoadNet } from "./roadnet";

// Front gardens for Dublin houses: the strip between a house and the back of
// the footpath, which is most of what you see from the car on an estate road.
// Neither OSM nor Overture maps garden walls (Finglas has 157 mapped walls in
// all, estate boundaries), so this follows the procedural-city approach:
// find each house's frontage and its setback from the street (the "lot" step
// in Parish & Müller 2001 and CityEngine's lot rules), then dress the plot
// from a short list of real layouts (low wall with piers, wall and hedge,
// hedge; a gate or a driveway; party walls; bins by the front wall).
//
// Pure data, no drawing: the renderer (streetdetail.ts) and the car's
// colliders (carphysics.ts) both read the same pieces, and the headless test
// checks them against the real Finglas network.

export type Boundary = "wall" | "wallHedge" | "hedge";

export interface Plot {
  /** Building index. */
  b: number;
  /** House front corners, A to B. */
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** Unit vectors: along the front (A to B), and out toward the street. */
  ux: number;
  uz: number;
  nx: number;
  nz: number;
  len: number;
  /** Distance from the house front to the back of the footpath, at A and at B. */
  dA: number;
  dB: number;
  /** The opening in the front boundary, metres along from A (gate or driveway). */
  gap0: number;
  gap1: number;
  drive: boolean;
  boundary: Boundary;
  brick: boolean;
  /** Boundary with the neighbour on the A side (and the B side at a terrace end). */
  party: "wall" | "hedge" | null;
  endB: boolean;
  /** Wheelie bins against the house front (0-3), starting this far along from A. */
  bins: number;
  binsAt: number;
}

export type Piece =
  | { kind: "wall" | "hedge"; ax: number; az: number; bx: number; bz: number; h: number; t: number; brick: boolean }
  | { kind: "pier"; x: number; z: number; rot: number; brick: boolean }
  | { kind: "bin"; x: number; z: number; rot: number; colour: 0 | 1 | 2 }
  | { kind: "drive" | "path"; pts: number[] };

/** Module sizes from the Blender models (garden_wall_*.glb, wheelie_bin.glb). */
export const WALL_H = 0.9, WALL_T = 0.3, PIER = 0.52, BIN_W = 0.62;
const HEDGE_H = 1.15, HEDGE_T = 0.7;
const MIN_DEPTH = 1.6, MAX_DEPTH = 18, MAX_RAY = 22;
const CELL = 20;

export class GardenPlanner {
  private segs = new Map<number, number[]>(); // cell -> flat [ax, az, bx, bz, ...] street edges
  private cache = new Map<number, Plot | null>();
  private pieceCache = new Map<number, Piece[]>();

  constructor(
    private buildings: { h: number; pts: Float32Array }[],
    private net: RoadNet,
    private inside: (x: number, z: number) => boolean,
  ) {
    // The street's frontage lines: both edges of every footpath and every
    // drivable lane (service lanes and junctions too: a garden never spans
    // one). A ray from a house hits the back of its footpath first, or the
    // road edge where there's no footpath.
    for (const l of net.lanes) {
      const car = (l.kind === LaneKind.Road || l.kind === LaneKind.Internal) && l.allow & ALLOW_CAR;
      if (!car && l.kind !== LaneKind.Footpath) continue;
      const hw = l.width / 2;
      for (let k = 0; k + 3 < l.pts.length; k += 2) {
        const ax = l.pts[k], az = l.pts[k + 1], bx = l.pts[k + 2], bz = l.pts[k + 3];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.05) continue;
        const px = (-(bz - az) / len) * hw, pz = ((bx - ax) / len) * hw;
        for (const s of [1, -1]) this.addSeg(ax + px * s, az + pz * s, bx + px * s, bz + pz * s);
      }
    }
  }

  private addSeg(ax: number, az: number, bx: number, bz: number) {
    for (let gx = Math.floor(Math.min(ax, bx) / CELL); gx <= Math.floor(Math.max(ax, bx) / CELL); gx++) {
      for (let gz = Math.floor(Math.min(az, bz) / CELL); gz <= Math.floor(Math.max(az, bz) / CELL); gz++) {
        const k = cellKey(gx, gz);
        let a = this.segs.get(k);
        if (!a) this.segs.set(k, (a = []));
        a.push(ax, az, bx, bz);
      }
    }
  }

  /**
   * Distance from (px, pz) along (nx, nz) to the first street edge roughly
   * parallel to the house front, or -1. A ray that passes through another
   * building first is facing a back garden, not the street.
   */
  depth(px: number, pz: number, nx: number, nz: number): number {
    let best = MAX_RAY;
    const x1 = px + nx * MAX_RAY, z1 = pz + nz * MAX_RAY;
    const seen = new Set<number[]>();
    for (let gx = Math.floor(Math.min(px, x1) / CELL); gx <= Math.floor(Math.max(px, x1) / CELL); gx++) {
      for (let gz = Math.floor(Math.min(pz, z1) / CELL); gz <= Math.floor(Math.max(pz, z1) / CELL); gz++) {
        const a = this.segs.get(cellKey(gx, gz));
        if (!a || seen.has(a)) continue;
        seen.add(a);
        for (let i = 0; i < a.length; i += 4) {
          const sx = a[i + 2] - a[i], sz = a[i + 3] - a[i + 1];
          const sl = Math.hypot(sx, sz);
          // Parallel-ish to the front: within about 50° of it.
          if (Math.abs(sx * nx + sz * nz) > 0.65 * sl) continue;
          const den = nx * sz - nz * sx;
          if (Math.abs(den) < 1e-6) continue;
          const qx = a[i] - px, qz = a[i + 1] - pz;
          const t = (qx * sz - qz * sx) / den;
          const v = (qx * nz - qz * nx) / den;
          if (t > 0.05 && t < best && v >= 0 && v <= 1) best = t;
        }
      }
    }
    if (best >= MAX_RAY) return -1;
    for (let t = 0.8; t < best - 0.3; t += 1) if (this.inside(px + nx * t, pz + nz * t)) return -1;
    return best;
  }

  /** The front garden of building `b`, or null (not a house, or it fronts straight onto the street). */
  plot(b: number): Plot | null {
    let p = this.cache.get(b);
    if (p === undefined) this.cache.set(b, (p = this.make(b)));
    return p;
  }

  /**
   * The plot's pieces, with each wall and hedge cut back to the parts clear of
   * lanes and other buildings: a wall stops where a laneway or a neighbour's
   * extension starts.
   */
  pieces(b: number): Piece[] {
    let out = this.pieceCache.get(b);
    if (out) return out;
    const p = this.plot(b);
    out = [];
    for (const q of p ? plotPieces(p) : []) {
      if (q.kind !== "wall" && q.kind !== "hedge") {
        out.push(q);
        continue;
      }
      for (const [t0, t1] of this.clearSpans(q.ax, q.az, q.bx, q.bz)) {
        out.push({ ...q, ax: q.ax + (q.bx - q.ax) * t0, az: q.az + (q.bz - q.az) * t0, bx: q.ax + (q.bx - q.ax) * t1, bz: q.az + (q.bz - q.az) * t1 });
      }
    }
    this.pieceCache.set(b, out);
    return out;
  }

  /** The stretches (0..1 along a to b) clear of car lanes and buildings, at least 0.4 m long. */
  private clearSpans(ax: number, az: number, bx: number, bz: number): [number, number][] {
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(len / 0.25));
    const spans: [number, number][] = [];
    let start = -1;
    for (let i = 0; i <= steps + 1; i++) {
      const t = i / steps;
      let ok = i <= steps;
      if (ok) {
        const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        const on = this.inside(x, z) ? null : this.net.locate(x, z, null, ALLOW_CAR);
        ok = !this.inside(x, z) && !(on && Math.abs(on.lat) < on.lane.width / 2 + 0.15);
      }
      if (ok && start < 0) start = i;
      if (!ok && start >= 0) {
        // From the first clear sample to the last one.
        const t0 = start / steps, t1 = Math.min(1, (i - 1) / steps);
        if ((t1 - t0) * len >= 0.4) spans.push([t0, t1]);
        start = -1;
      }
    }
    return spans;
  }

  private make(b: number): Plot | null {
    const { h, pts } = this.buildings[b];
    const n = pts.length / 2;
    const area = Math.abs(ringArea(pts));
    if (h > 12 || area < 25 || area > 260 || n < 3) return null;
    // Which way is out: the ring's winding (positive area turns left).
    const sign = ringArea(pts) > 0 ? 1 : -1;
    let front: Omit<Plot, "gap0" | "gap1" | "drive" | "boundary" | "brick" | "party" | "endB" | "bins" | "binsAt"> | null = null;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const ax = pts[i * 2], az = pts[i * 2 + 1];
      const bx = pts[((i + 1) % n) * 2], bz = pts[((i + 1) % n) * 2 + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 2.4) continue;
      const ux = (bx - ax) / len, uz = (bz - az) / len;
      const nx = uz * sign, nz = -ux * sign;
      const mid = this.depth((ax + bx) / 2 + nx * 0.05, (az + bz) / 2 + nz * 0.05, nx, nz);
      if (mid < MIN_DEPTH || mid > MAX_DEPTH || mid >= bestD) continue;
      // Depth at each end, so a front that isn't square to the street still meets it.
      const e = Math.min(0.4, len / 4);
      let dA = this.depth(ax + ux * e + nx * 0.05, az + uz * e + nz * 0.05, nx, nz);
      let dB = this.depth(bx - ux * e + nx * 0.05, bz - uz * e + nz * 0.05, nx, nz);
      if (dA < MIN_DEPTH || Math.abs(dA - mid) > 2.5) dA = mid;
      if (dB < MIN_DEPTH || Math.abs(dB - mid) > 2.5) dB = mid;
      bestD = mid;
      front = { b, ax, az, bx, bz, ux, uz, nx, nz, len, dA, dB };
    }
    if (!front) return null;
    const r = mulberry32(b * 7919 + 13);
    const { len } = front;
    const depthMin = Math.min(front.dA, front.dB);
    // About half of Finglas front gardens have been paved for a car.
    const drive = len >= 4.6 && depthMin >= 5.2 && r() < 0.5;
    const width = drive ? 3 : 1;
    const atA = r() < 0.5;
    let gap0 = 0, gap1 = 0;
    if (len >= 2.6) {
      if (drive) gap0 = atA ? 0.35 : len - 0.35 - width;
      else gap0 = len * (atA ? 0.3 : 0.7) - width / 2;
      gap1 = gap0 + width;
    }
    const roll = r();
    const boundary: Boundary = roll < 0.65 ? "wall" : roll < 0.8 ? "wallHedge" : "hedge";
    const brick = r() < 0.35;
    const pr = r();
    const party = pr < 0.55 ? "wall" : pr < 0.8 ? "hedge" : null;
    // A terrace end: no neighbouring house just past B.
    const endB = !this.inside(front.bx + front.ux * 0.6 - front.nx * 0.6, front.bz + front.uz * 0.6 - front.nz * 0.6);
    // Bins on the longer stretch of front wall clear of the opening.
    const before = gap1 > gap0 ? gap0 : len, after = gap1 > gap0 ? len - gap1 : 0;
    const room = Math.max(before, after) - 0.5;
    const bins = r() < 0.85 ? Math.max(0, Math.min(r() < 0.5 ? 3 : 2, Math.floor(room / (BIN_W + 0.06)))) : 0;
    const binsAt = before >= after ? 0.3 : gap1 + 0.2;
    return { ...front, gap0, gap1, drive, boundary, brick, party, endB, bins, binsAt };
  }
}

/** The walls, hedges, piers, bins and paving of one plot, in world metres. */
export function plotPieces(p: Plot): Piece[] {
  const out: Piece[] = [];
  const at = (s: number, d: number) => [p.ax + p.ux * s + p.nx * d, p.az + p.uz * s + p.nz * d] as const;
  // The front boundary line, just inside the back of the footpath.
  const line = (s: number, inset: number) => at(s, p.dA + ((p.dB - p.dA) * s) / p.len - inset);
  const rot = Math.atan2(-p.uz, p.ux); // a module's +x along the front
  const hasGap = p.gap1 > p.gap0;
  const runs: [number, number][] = hasGap ? [[0, p.gap0], [p.gap1, p.len]] : [[0, p.len]];
  const wall = p.boundary !== "hedge";
  for (const [s0, s1] of runs) {
    if (s1 - s0 < 0.3) continue;
    if (wall) {
      const [ax, az] = line(s0, WALL_T / 2), [bx, bz] = line(s1, WALL_T / 2);
      out.push({ kind: "wall", ax, az, bx, bz, h: WALL_H, t: WALL_T, brick: p.brick });
    }
    if (p.boundary !== "wall") {
      const inset = wall ? WALL_T + HEDGE_T / 2 : HEDGE_T / 2;
      const [ax, az] = line(s0, inset), [bx, bz] = line(s1, inset);
      out.push({ kind: "hedge", ax, az, bx, bz, h: wall ? HEDGE_H + 0.15 : HEDGE_H, t: HEDGE_T, brick: false });
    }
  }
  // Piers: either side of the opening, and at the plot's corners.
  if (wall) {
    const ss = [PIER / 2];
    if (hasGap) ss.push(Math.max(PIER / 2, p.gap0 - PIER / 2), Math.min(p.len - PIER / 2, p.gap1 + PIER / 2));
    if (p.endB) ss.push(p.len - PIER / 2);
    for (const s of ss) {
      const [x, z] = line(s, WALL_T / 2);
      out.push({ kind: "pier", x, z, rot, brick: p.brick });
    }
  }
  // Party boundaries run from the house front to the front boundary.
  if (p.party) {
    const sides: [number, number][] = [[0, p.dA]];
    if (p.endB) sides.push([p.len, p.dB]);
    for (const [s, d] of sides) {
      const [ax, az] = at(s, 0.15), [bx, bz] = at(s, d - (wall ? WALL_T + 0.05 : HEDGE_T));
      if (d < 1.2) continue;
      if (p.party === "wall") out.push({ kind: "wall", ax, az, bx, bz, h: WALL_H, t: 0.22, brick: p.brick });
      else out.push({ kind: "hedge", ax, az, bx, bz, h: HEDGE_H, t: HEDGE_T, brick: false });
    }
  }
  // Paving: the driveway or the path to the door, from the house to the footpath.
  if (hasGap) {
    const [x0, z0] = at(p.gap0, 0), [x1, z1] = at(p.gap1, 0);
    const [x2, z2] = line(p.gap1, 0), [x3, z3] = line(p.gap0, 0);
    out.push({ kind: p.drive ? "drive" : "path", pts: [x0, z0, x1, z1, x2, z2, x3, z3] });
  }
  // Bins against the front wall, lids to the house, facing the street.
  const face = Math.atan2(p.nx, p.nz);
  for (let k = 0; k < p.bins; k++) {
    const [x, z] = at(p.binsAt + BIN_W / 2 + k * (BIN_W + 0.06), 0.5);
    out.push({ kind: "bin", x, z, rot: face, colour: ((p.b + k) % 3) as 0 | 1 | 2 });
  }
  return out;
}

export function ringArea(p: Float32Array): number {
  let a = 0;
  const n = p.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1];
  }
  return a / 2;
}

const cellKey = (gx: number, gz: number) => (gx + 1000) * 4000 + (gz + 1000);
