// The road rules of a place, baked from a SUMO network (tools/bake/bake_net.py):
// every lane with its shape and speed limit, how lanes connect through each
// junction, who gives way to whom there, and the traffic-light programs.
// Traffic, pedestrians, markings, signs and the driving examiner all read it.

export const enum LaneKind {
  Road = 0,
  Footpath = 1,
  Internal = 2,
  PedInternal = 3,
  Crossing = 4,
  WalkingArea = 5,
}
export const ALLOW_CAR = 1;
export const ALLOW_PED = 2;
/** Drivable, but a service road (driveway, car park): AI traffic keeps off. */
export const ALLOW_SERVICE = 4;
/** Crossing with painted markings (zebra or lines). */
export const MARKED = 8;

export const EDGE_STOP = 1;
export const EDGE_GIVE_WAY = 2;
export const EDGE_TWO_WAY = 4;
export const EDGE_CANONICAL = 8;

export const enum JType {
  Priority = 0,
  TrafficLight = 1,
  DeadEnd = 5,
}

export interface Lane {
  id: number;
  kind: LaneKind;
  allow: number;
  edge: number; // -1 for junction lanes
  index: number;
  speed: number; // m/s
  width: number;
  length: number;
  junction: number; // -1 for normal lanes
  pts: Float32Array; // x, z pairs
  cum: Float32Array; // distance along at each point
  out: number[]; // link ids leaving the end of this lane
  inc: number[]; // link ids arriving at the start
}
export interface Edge {
  from: number;
  to: number;
  name: number;
  prio: number;
  flags: number;
  first: number;
  n: number;
}
export interface Junction {
  /** SUMO junction type (index into JUNCTION_TYPES). */
  type: number;
  /** On a roundabout's ring (SUMO lists the ring's junctions). */
  roundabout: boolean;
  /** A mini-roundabout: one painted circle, give way to the right. */
  mini: boolean;
  x: number;
  z: number;
  shape: Float32Array;
  /** Per request index: links this one must yield to, and links that cross it. */
  resp: Uint8Array[];
  foes: Uint8Array[];
  /** Request index -> link id. */
  links: number[];
}
export interface Link {
  id: number;
  from: number;
  to: number;
  vias: number[];
  /** s straight, l left, r right, t/T turnaround, L/R partly. */
  dir: string;
  /** M major, m minor (give way), o/O uncontrolled, = equal. */
  state: string;
  tl: number;
  li: number;
  j: number;
  req: number;
}
export interface Signal {
  offset: number;
  phases: { d: number; state: string }[];
  cycle: number;
}

const JUNCTION_TYPES = ["priority", "traffic_light", "right_before_left", "allway_stop", "priority_stop", "dead_end"];

export class RoadNet {
  names: string[] = [];
  junctions: Junction[] = [];
  edges: Edge[] = [];
  lanes: Lane[] = [];
  links: Link[] = [];
  signals: Signal[] = [];
  /** Lane segments by 20 m cell, for "which lane am I on". */
  private grid = new Map<number, number[]>();

  static async load(name: string): Promise<RoadNet | null> {
    try {
      const res = await fetch(`/world/${name}.net.bin`);
      if (!res.ok) return null;
      const buf = await res.arrayBuffer();
      const head = new Uint8Array(buf, 0, 4);
      if (String.fromCharCode(...head) !== "LNT1") return null;
      const net = new RoadNet();
      net.parse(new DataView(buf));
      return net;
    } catch {
      return null;
    }
  }

  private parse(v: DataView) {
    let o = 4;
    const u8 = () => v.getUint8(o++);
    const i8 = () => v.getInt8(o++);
    const u16 = () => ((o += 2), v.getUint16(o - 2, true));
    const i16 = () => ((o += 2), v.getInt16(o - 2, true));
    const u32 = () => ((o += 4), v.getUint32(o - 4, true));
    const f32 = () => ((o += 4), v.getFloat32(o - 4, true));
    const idx = (x: number) => (x === 0xffffffff ? -1 : x);
    const pts = () => {
      const n = u16();
      const p = new Float32Array(n * 2);
      for (let i = 0; i < n * 2; i++) p[i] = f32();
      return p;
    };
    const dec = new TextDecoder();
    const nn = u16();
    for (let i = 0; i < nn; i++) {
      const len = u8();
      this.names.push(dec.decode(new Uint8Array(v.buffer, o, len)));
      o += len;
    }
    const nj = u32();
    for (let i = 0; i < nj; i++) {
      // Low 6 bits: the SUMO type; bit 7 roundabout, bit 6 mini-roundabout.
      // (Files baked before these flags simply have them clear.)
      const tb = u8();
      const type = tb & 0x3f, roundabout = !!(tb & 0x80), mini = !!(tb & 0x40);
      const x = f32(), z = f32();
      const shape = pts();
      const nr = u16();
      const nb = (nr + 7) >> 3;
      const resp: Uint8Array[] = [], foes: Uint8Array[] = [];
      for (let r = 0; r < nr; r++) {
        resp.push(new Uint8Array(v.buffer.slice(o, o + nb)));
        o += nb;
        foes.push(new Uint8Array(v.buffer.slice(o, o + nb)));
        o += nb;
        o += 1; // cont
      }
      this.junctions.push({ type, roundabout, mini, x, z, shape, resp, foes, links: new Array(nr).fill(-1) });
    }
    const ne = u32();
    for (let i = 0; i < ne; i++) {
      this.edges.push({ from: idx(u32()), to: idx(u32()), name: u16(), prio: i8(), flags: u8(), first: u32(), n: u8() });
    }
    const nl = u32();
    for (let i = 0; i < nl; i++) {
      const kind = u8(), allow = u8(), edge = idx(u32()), index = u8();
      const speed = f32(), width = f32(), length = f32(), junction = idx(u32());
      const p = pts();
      const cum = new Float32Array(p.length / 2);
      for (let k = 1; k < cum.length; k++) cum[k] = cum[k - 1] + Math.hypot(p[k * 2] - p[k * 2 - 2], p[k * 2 + 1] - p[k * 2 - 1]);
      this.lanes.push({ id: i, kind, allow, edge, index, speed, width, length: cum[cum.length - 1] || length, junction, pts: p, cum, out: [], inc: [] });
    }
    const nk = u32();
    for (let i = 0; i < nk; i++) {
      const from = u32(), to = u32(), nv = u8();
      const dir = String.fromCharCode(u8()), state = String.fromCharCode(u8());
      const tl = i8(), li = i16(), j = idx(u32()), req = i16();
      const vias: number[] = [];
      for (let k = 0; k < nv; k++) vias.push(u32());
      const link: Link = { id: i, from, to, vias, dir, state, tl, li, j, req };
      this.links.push(link);
      this.lanes[from].out.push(i);
      this.lanes[to].inc.push(i);
      if (j >= 0 && req >= 0 && req < this.junctions[j].links.length) this.junctions[j].links[req] = i;
    }
    const nt = u16();
    for (let i = 0; i < nt; i++) {
      const offset = f32();
      const np = u8();
      const phases: { d: number; state: string }[] = [];
      for (let k = 0; k < np; k++) {
        const d = f32();
        const len = u16();
        phases.push({ d, state: dec.decode(new Uint8Array(v.buffer, o, len)) });
        o += len;
      }
      this.signals.push({ offset, phases, cycle: phases.reduce((s, p) => s + p.d, 0) || 1 });
    }
    for (const l of this.lanes) {
      if (l.kind === LaneKind.Road || l.kind === LaneKind.Internal || l.kind === LaneKind.Footpath) this.index(l);
    }
  }

  private cellKey(cx: number, cz: number) {
    return (cx + 4096) * 8192 + (cz + 4096);
  }

  private index(l: Lane) {
    const seen = new Set<number>();
    for (let k = 0; k + 1 < l.pts.length / 2; k++) {
      const ax = l.pts[k * 2], az = l.pts[k * 2 + 1], bx = l.pts[k * 2 + 2], bz = l.pts[k * 2 + 3];
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 10));
      for (let s = 0; s <= steps; s++) {
        const x = ax + ((bx - ax) * s) / steps, z = az + ((bz - az) * s) / steps;
        const key = this.cellKey(Math.floor(x / 20), Math.floor(z / 20));
        if (seen.has(key)) continue;
        seen.add(key);
        let c = this.grid.get(key);
        if (!c) this.grid.set(key, (c = []));
        c.push(l.id);
      }
    }
  }

  /** Signal state character for a traffic-light link at time t (seconds). */
  signalState(tl: number, li: number, t: number): string {
    const s = this.signals[tl];
    if (!s) return "O";
    let u = (((t - s.offset) % s.cycle) + s.cycle) % s.cycle;
    for (const p of s.phases) {
      if (u < p.d) return p.state[li] ?? "O";
      u -= p.d;
    }
    return s.phases[0].state[li] ?? "O";
  }

  /** Seconds until this link's light changes away from its current state. */
  signalRemaining(tl: number, li: number, t: number): number {
    const s = this.signals[tl];
    if (!s) return 99;
    const now = this.signalState(tl, li, t);
    let u = (((t - s.offset) % s.cycle) + s.cycle) % s.cycle;
    let i = 0;
    while (i < s.phases.length && u >= s.phases[i].d) u -= s.phases[i++].d;
    let left = s.phases[i % s.phases.length].d - u;
    for (let k = 1; k < s.phases.length; k++) {
      const p = s.phases[(i + k) % s.phases.length];
      if ((p.state[li] ?? "O") !== now) break;
      left += p.d;
    }
    return left;
  }

  /** Does request `a` have to give way to request `b` at junction j? */
  yieldsTo(j: number, a: number, b: number): boolean {
    const r = this.junctions[j]?.resp[a];
    return !!r && ((r[b >> 3] >> (b & 7)) & 1) === 1;
  }
  foes(j: number, a: number, b: number): boolean {
    const r = this.junctions[j]?.foes[a];
    return !!r && ((r[b >> 3] >> (b & 7)) & 1) === 1;
  }

  /** Point and unit direction at distance s along a lane. */
  at(l: Lane, s: number, out: { x: number; z: number; dx: number; dz: number }) {
    const n = l.cum.length;
    if (n < 2) {
      out.x = l.pts[0];
      out.z = l.pts[1];
      out.dx = 0;
      out.dz = 1;
      return out;
    }
    s = Math.max(0, Math.min(l.length, s));
    let k = 0;
    // Lanes are short; a linear scan beats a binary search here.
    while (k < n - 2 && l.cum[k + 1] < s) k++;
    const seg = l.cum[k + 1] - l.cum[k] || 1;
    const t = (s - l.cum[k]) / seg;
    const ax = l.pts[k * 2], az = l.pts[k * 2 + 1], bx = l.pts[k * 2 + 2], bz = l.pts[k * 2 + 3];
    out.x = ax + (bx - ax) * t;
    out.z = az + (bz - az) * t;
    out.dx = (bx - ax) / seg;
    out.dz = (bz - az) / seg;
    return out;
  }

  /**
   * The lane under (x, z) that best matches a heading: returns the lane, the
   * distance along it and the lateral offset (+ is left of travel), or null.
   * `want` filters by ALLOW_* bits.
   */
  locate(x: number, z: number, yaw: number | null, want: number) {
    const cx = Math.floor(x / 20), cz = Math.floor(z / 20);
    let best: { lane: Lane; s: number; lat: number; score: number; along: number } | null = null;
    const fx = yaw === null ? 0 : Math.sin(yaw), fz = yaw === null ? 0 : Math.cos(yaw);
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gz = cz - 1; gz <= cz + 1; gz++) {
        for (const id of this.grid.get(this.cellKey(gx, gz)) ?? []) {
          const l = this.lanes[id];
          if (!(l.allow & want)) continue;
          for (let k = 0; k + 1 < l.cum.length; k++) {
            const ax = l.pts[k * 2], az = l.pts[k * 2 + 1], bx = l.pts[k * 2 + 2], bz = l.pts[k * 2 + 3];
            const dx = bx - ax, dz = bz - az;
            const len2 = dx * dx + dz * dz || 1;
            const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
            const px = ax + dx * t, pz = az + dz * t;
            const d = Math.hypot(x - px, z - pz);
            if (d > l.width / 2 + 1.5) continue;
            const len = Math.sqrt(len2);
            const along = yaw === null ? 1 : (dx * fx + dz * fz) / len;
            // Prefer lanes we're inside and pointing the same way.
            const score = d - Math.max(0, along) * 1.5;
            if (!best || score < best.score) {
              // Lateral: + to the left of travel (left of (dx,dz) in x-east/z-south is (dz, -dx)).
              const lat = ((x - px) * dz - (z - pz) * dx) / len;
              best = { lane: l, s: l.cum[k] + len * t, lat, score, along };
            }
          }
        }
      }
    }
    return best;
  }

  junctionTypeName(j: number) {
    return JUNCTION_TYPES[this.junctions[j]?.type] ?? "priority";
  }

  /** The car lanes of an edge, kerb side first. */
  carLanes(e: Edge): Lane[] {
    const out: Lane[] = [];
    for (let k = 0; k < e.n; k++) {
      const l = this.lanes[e.first + k];
      if (l.kind === LaneKind.Road) out.push(l);
    }
    return out;
  }
}
