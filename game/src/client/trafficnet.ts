import * as THREE from "three/webgpu";
import { createVertexColorMaterial } from "./facade";
import { makeTemplate, mulberry32, templateGeometry } from "./props";
import { ALLOW_CAR, ALLOW_SERVICE, EDGE_STOP, LaneKind, MARKED, type Lane, type Link, type RoadNet } from "./roadnet";
import { carTemplate, walkerTemplate, type TrafficEvents } from "./traffic";

// Rule-following traffic and pedestrians on a SUMO road network.
//
// Cars follow their lane with the Intelligent Driver Model (the car-following
// model SUMO and most traffic research use): they keep a time gap to whatever
// is ahead and brake smoothly for it. At each junction they take a turn the
// network allows, and decide whether to go from the junction's own rules:
// traffic lights, stop signs (full stop first), and SUMO's right-of-way
// matrix, which says which movements give way to which, pedestrians included.
//
// Pedestrians only walk on footpaths, walking areas and crossings, so nobody
// strolls across a motorway. They cross on the green man at lights, step out
// on zebras when approaching cars can still stop, and wait for a real gap at
// unmarked crossings.

export interface PlayerState {
  x: number;
  z: number;
  yaw: number;
  speed: number;
  driving: boolean;
}

interface Car {
  kind: number;
  len: number;
  w: number;
  active: boolean;
  lane: Lane;
  s: number;
  v: number;
  /** Chosen movement at the end of the current road lane, or the one being driven through. */
  link: Link | null;
  /** -1 on a road lane, else the index into link.vias being driven. */
  via: number;
  v0f: number; // desired speed as a fraction of the limit
  T: number; // time headway (s)
  a: number;
  b: number;
  stopDone: number; // seconds stopped at a stop line
  go: boolean;
  wait: number;
  blockedByPlayer: number;
  honk: number;
  x: number;
  z: number;
  yaw: number;
}

interface Ped {
  kind: number;
  active: boolean;
  lane: Lane;
  s: number;
  dir: 1 | -1;
  off: number;
  v: number;
  /** Crossing a walking area in a straight line from (ax, az) to (bx, bz). */
  area: { ax: number; az: number; bx: number; bz: number; len: number; t: number; next: Lane; nextDir: 1 | -1 } | null;
  waiting: number;
  knocked: number;
  x: number;
  z: number;
  yaw: number;
  phase: number;
}

const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);
const wheel = (x: number, z: number, r = 0.34) => new THREE.CylinderGeometry(r, r, 0.22, 8).rotateZ(Math.PI / 2).translate(x, r, z);
function van(color: number) {
  return makeTemplate([
    [box(1.9, 1.05, 5.0, 0, 0.3, 0), color],
    [box(1.88, 0.85, 3.6, 0, 1.35, -0.65), color],
    [box(1.9, 0.5, 0.06, 0, 1.45, 1.17), 0x2b3238],
    [box(1.92, 0.4, 1.0, 0, 1.4, 0.65), 0x2b3238],
    [wheel(-0.9, 1.6), 0x1a1a1a], [wheel(0.9, 1.6), 0x1a1a1a], [wheel(-0.9, -1.7), 0x1a1a1a], [wheel(0.9, -1.7), 0x1a1a1a],
  ]);
}
function bus() {
  // Dublin Bus double-decker: yellow and blue.
  return makeTemplate([
    [box(2.5, 1.5, 10.8, 0, 0.35, 0), 0xf5c400],
    [box(2.5, 1.4, 10.8, 0, 1.85, 0), 0xf5c400],
    [box(2.52, 0.55, 10.4, 0, 1.0, -0.1), 0x23303a],
    [box(2.52, 0.6, 10.4, 0, 2.3, -0.1), 0x23303a],
    [box(2.52, 0.18, 10.82, 0, 0.35, 0), 0x1d3f8f],
    [box(2.3, 1.2, 0.06, 0, 0.95, 5.41), 0x23303a],
    [wheel(-1.15, 3.6, 0.5), 0x1a1a1a], [wheel(1.15, 3.6, 0.5), 0x1a1a1a], [wheel(-1.15, -2.8, 0.5), 0x1a1a1a], [wheel(1.15, -2.8, 0.5), 0x1a1a1a],
  ]);
}

const KINDS = [
  { tpl: () => carTemplate(0xf2f2f2), len: 4.3, w: 1.8, n: 10 },
  { tpl: () => carTemplate(0x1f3b73), len: 4.3, w: 1.8, n: 8 },
  { tpl: () => carTemplate(0x8b1e1e), len: 4.3, w: 1.8, n: 6 },
  { tpl: () => carTemplate(0x2d2d2d), len: 4.3, w: 1.8, n: 9 },
  { tpl: () => carTemplate(0x9aa3ab), len: 4.3, w: 1.8, n: 9 },
  { tpl: () => carTemplate(0x3d6b47), len: 4.3, w: 1.8, n: 4 },
  { tpl: () => van(0xeeeeee), len: 5.0, w: 1.9, n: 6 },
  { tpl: () => bus(), len: 10.8, w: 2.5, n: 2 },
];
const SHIRTS = [0x2b2d42, 0x1f9d55, 0x9a3b3b, 0x2a62a8, 0x6b6b6b, 0xd9d4c7, 0x3d2b4f, 0x8a6a3a];

const SIM_RADIUS = 420;
const SPAWN_MIN = 70;
const PED_RADIUS = 210;
const LOOKAHEAD = 90;

export class NetTraffic {
  group = new THREE.Group();
  nearbyVehicles = 0;
  /** Seconds since start: the clock every traffic light runs on. */
  time = 0;
  cars: Car[] = [];
  peds: Ped[] = [];
  private vMeshes: THREE.InstancedMesh[] = [];
  private wMeshes: THREE.InstancedMesh[] = [];
  private rand = mulberry32(Date.now() & 0xffff);
  private spawnLanes: Lane[];
  private footLanes: Lane[];
  /** Footpath/crossing lane -> walking area at its start / end (-1 if none). */
  private startW: Int32Array;
  private endW: Int32Array;
  /** Walking area -> lanes touching it, and whether they start there. */
  private waAttach = new Map<number, { lane: Lane; atStart: boolean }[]>();
  /** Crossing lane -> the link that leads onto it (signal and request). */
  private crossingLink = new Map<number, Link>();
  // Per-frame occupancy.
  private onLane = new Map<number, Car[]>();
  private approach = new Map<number, number>(); // link id -> soonest arrival (s)
  private pedsOn = new Map<number, number>(); // crossing lane -> pedestrians on it
  private player: PlayerState = { x: 1e9, z: 1e9, yaw: 0, speed: 0, driving: false };
  private playerLane = -1;
  private playerApproach: { lane: Lane; t: number } | null = null;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 1, 0);
  private p3 = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);
  private pt = { x: 0, z: 0, dx: 0, dz: 1 };

  constructor(readonly net: RoadNet, private ev: TrafficEvents, budget: { vehicles: number; walkers: number }) {
    const mat = createVertexColorMaterial(0.55, 0.15);
    const total = KINDS.reduce((s, k) => s + k.n, 0);
    KINDS.forEach((k, kind) => {
      const n = Math.max(1, Math.round((k.n / total) * budget.vehicles));
      const mesh = new THREE.InstancedMesh(templateGeometry(k.tpl()), mat, n);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      this.vMeshes.push(mesh);
      this.group.add(mesh);
      for (let i = 0; i < n; i++) this.cars.push(this.blankCar(kind));
    });
    SHIRTS.forEach((c) => {
      for (const step of [0, 1]) {
        const mesh = new THREE.InstancedMesh(templateGeometry(walkerTemplate(c, step)), mat, budget.walkers);
        mesh.count = 0;
        mesh.frustumCulled = false;
        mesh.castShadow = true;
        this.wMeshes.push(mesh);
        this.group.add(mesh);
      }
    });
    for (let i = 0; i < budget.walkers; i++) this.peds.push(this.blankPed(i % SHIRTS.length));

    this.spawnLanes = net.lanes.filter((l) => l.kind === LaneKind.Road && l.allow & ALLOW_CAR && !(l.allow & ALLOW_SERVICE) && l.length > 12 && l.out.length);
    this.footLanes = net.lanes.filter((l) => l.kind === LaneKind.Footpath && l.length > 6);
    this.startW = new Int32Array(net.lanes.length).fill(-1);
    this.endW = new Int32Array(net.lanes.length).fill(-1);
    for (const k of net.links) {
      const from = net.lanes[k.from], to = net.lanes[k.to];
      if (to.kind === LaneKind.WalkingArea && (from.kind === LaneKind.Footpath || from.kind === LaneKind.Crossing)) this.endW[from.id] = to.id;
      if (from.kind === LaneKind.WalkingArea && (to.kind === LaneKind.Footpath || to.kind === LaneKind.Crossing)) this.startW[to.id] = from.id;
      if (to.kind === LaneKind.Crossing) this.crossingLink.set(to.id, k);
    }
    for (const l of net.lanes) {
      if (l.kind !== LaneKind.Footpath && l.kind !== LaneKind.Crossing) continue;
      for (const [w, atStart] of [[this.startW[l.id], true], [this.endW[l.id], false]] as const) {
        if (w < 0) continue;
        let a = this.waAttach.get(w);
        if (!a) this.waAttach.set(w, (a = []));
        a.push({ lane: l, atStart });
      }
    }
  }

  private blankCar(kind: number): Car {
    const k = KINDS[kind];
    return {
      kind, len: k.len, w: k.w, active: false, lane: this.net?.lanes[0] as Lane, s: 0, v: 0, link: null, via: -1,
      v0f: 1, T: 1.4, a: 1.6, b: 2.6, stopDone: 0, go: true, wait: 0, blockedByPlayer: 0, honk: 0, x: 1e9, z: 1e9, yaw: 0,
    };
  }
  private blankPed(kind: number): Ped {
    return { kind, active: false, lane: null as unknown as Lane, s: 0, dir: 1, off: 0, v: 1.3, area: null, waiting: 0, knocked: 0, x: 1e9, z: 1e9, yaw: 0, phase: 0 };
  }

  // ------------------------------------------------------------ public --

  update(dt: number, px: number, pz: number, player?: PlayerState) {
    dt = Math.min(dt, 0.1);
    this.time += dt;
    this.player = player ?? { x: px, z: pz, yaw: 0, speed: 0, driving: false };
    this.locatePlayer();
    this.buildOccupancy();
    this.nearbyVehicles = 0;
    for (const c of this.cars) {
      if (!c.active || (c.x - px) ** 2 + (c.z - pz) ** 2 > SIM_RADIUS * SIM_RADIUS) this.spawnCar(c, px, pz);
      if (!c.active) continue;
      this.stepCar(c, dt);
      if ((c.x - px) ** 2 + (c.z - pz) ** 2 < 60 * 60) this.nearbyVehicles++;
    }
    for (const p of this.peds) {
      if (!p.active || (p.x - px) ** 2 + (p.z - pz) ** 2 > PED_RADIUS * PED_RADIUS) this.spawnPed(p, px, pz);
      if (!p.active) continue;
      this.stepPed(p, dt);
    }
    this.render();
  }

  /** Push a circle (the player's car) out of traffic and people. */
  collide(x: number, z: number, r: number): { nx: number; nz: number; depth: number; kind: string } | null {
    let best: { nx: number; nz: number; depth: number; kind: string } | null = null;
    for (const c of this.cars) {
      if (!c.active) continue;
      const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
      const ar = c.w / 2;
      const n = Math.max(2, Math.round(c.len / c.w));
      for (let i = 0; i < n; i++) {
        const o = -(c.len / 2 - ar) + ((c.len - 2 * ar) * i) / (n - 1);
        const cx = c.x + fx * o, cz = c.z + fz * o;
        const dx = x - cx, dz = z - cz;
        const d = Math.hypot(dx, dz);
        const depth = r + ar - d;
        if (depth > 0 && (!best || depth > best.depth)) {
          best = { nx: dx / (d || 1), nz: dz / (d || 1), depth, kind: "car" };
          c.v = Math.min(c.v, 0.5);
        }
      }
    }
    for (const p of this.peds) {
      if (!p.active) continue;
      const dx = x - p.x, dz = z - p.z;
      const d = Math.hypot(dx, dz);
      const depth = r + 0.3 - d;
      if (depth > 0) {
        best = { nx: dx / (d || 1), nz: dz / (d || 1), depth, kind: "person" };
        p.knocked = 6;
      }
    }
    return best;
  }

  /** Is anyone on (or stepping onto) this crossing lane? */
  pedOnCrossing(lane: number) {
    return (this.pedsOn.get(lane) ?? 0) > 0;
  }

  /** Pedestrians within r of (x, z). */
  pedsNear(x: number, z: number, r: number) {
    let n = 0;
    for (const p of this.peds) if (p.active && (p.x - x) ** 2 + (p.z - z) ** 2 < r * r) n++;
    return n;
  }

  // ------------------------------------------------------------- cars --

  private spawnCar(c: Car, px: number, pz: number) {
    c.active = false;
    for (let tries = 0; tries < 25; tries++) {
      const l = this.spawnLanes[Math.floor(this.rand() * this.spawnLanes.length)];
      if (!l) return;
      const s = 3 + this.rand() * Math.max(0.1, l.length - 6);
      const p = this.net.at(l, s, this.pt);
      const d2 = (p.x - px) ** 2 + (p.z - pz) ** 2;
      if (d2 > (SIM_RADIUS * 0.9) ** 2 || d2 < SPAWN_MIN * SPAWN_MIN) continue;
      if ((this.onLane.get(l.id) ?? []).some((o) => Math.abs(o.s - s) < 14)) continue;
      // Buses only on bigger roads.
      if (KINDS[c.kind].len > 8 && l.speed < 13) continue;
      c.lane = l;
      c.s = s;
      c.via = -1;
      c.v0f = 0.88 + this.rand() * 0.2;
      c.T = 1.1 + this.rand() * 0.7;
      c.a = KINDS[c.kind].len > 8 ? 1.0 : 1.4 + this.rand() * 0.6;
      c.b = 2.4 + this.rand() * 0.8;
      c.v = l.speed * c.v0f * 0.7;
      c.link = this.pickLink(l);
      c.stopDone = 0;
      c.wait = 0;
      c.go = true;
      c.blockedByPlayer = 0;
      c.active = true;
      this.place(c);
      let arr = this.onLane.get(l.id);
      if (!arr) this.onLane.set(l.id, (arr = []));
      arr.push(c);
      return;
    }
  }

  private pickLink(l: Lane): Link | null {
    const opts: Link[] = [];
    let turnaround: Link | null = null;
    for (const k of l.out) {
      const link = this.net.links[k];
      const to = this.net.lanes[link.to];
      if (!(to.allow & ALLOW_CAR) || to.kind !== LaneKind.Road) continue;
      if (to.allow & ALLOW_SERVICE && !(l.allow & ALLOW_SERVICE)) continue;
      if (link.dir === "t" || link.dir === "T") {
        turnaround = link;
        continue;
      }
      opts.push(link);
      if (link.dir === "s") opts.push(link, link); // straight on is more common
    }
    if (!opts.length) return turnaround;
    return opts[Math.floor(this.rand() * opts.length)];
  }

  private buildOccupancy() {
    this.onLane.clear();
    this.approach.clear();
    this.pedsOn.clear();
    for (const c of this.cars) {
      if (!c.active) continue;
      let arr = this.onLane.get(c.lane.id);
      if (!arr) this.onLane.set(c.lane.id, (arr = []));
      arr.push(c);
      if (c.via === -1 && c.link && c.go) {
        const t = (c.lane.length - c.s) / Math.max(c.v, 1.5);
        if (t < 8) this.approach.set(c.link.id, Math.min(this.approach.get(c.link.id) ?? 99, t));
      }
    }
    for (const p of this.peds) {
      if (!p.active || p.lane?.kind !== LaneKind.Crossing || p.area) continue;
      this.pedsOn.set(p.lane.id, (this.pedsOn.get(p.lane.id) ?? 0) + 1);
    }
  }

  /** Where the player is on the network, for right-of-way decisions. */
  private locatePlayer() {
    this.playerLane = -1;
    this.playerApproach = null;
    const pl = this.player;
    if (!pl.driving) return;
    const hit = this.net.locate(pl.x, pl.z, pl.yaw, ALLOW_CAR);
    if (!hit || hit.along < 0.3) return;
    this.playerLane = hit.lane.id;
    if (hit.lane.kind === LaneKind.Road && hit.lane.out.length) {
      this.playerApproach = { lane: hit.lane, t: (hit.lane.length - hit.s) / Math.max(pl.speed, 0.5) };
    }
  }

  /** Is some vehicle (or the player) inside, or about to enter, link k? */
  private linkBusy(k: Link, horizon: number) {
    for (const v of k.vias) {
      if ((this.onLane.get(v)?.length ?? 0) > 0 || this.playerLane === v) return true;
    }
    if ((this.approach.get(k.id) ?? 99) < horizon) return true;
    // The player could take any movement from their lane.
    const pa = this.playerApproach;
    if (pa && pa.lane.id === k.from && pa.t < horizon && this.player.speed > 0.5) return true;
    return false;
  }

  /** Can car c enter its junction now? */
  private canGo(c: Car, dist: number): boolean {
    const L = c.link!;
    const net = this.net;
    let minor = L.state === "m" || L.state === "s";
    if (L.tl >= 0) {
      const st = net.signalState(L.tl, L.li, this.time);
      if (st === "r" || st === "u") return false;
      if (st === "y" || st === "Y") {
        // Stop on amber unless too close to stop comfortably.
        const need = (c.v * c.v) / (2 * c.b) + 1;
        if (dist - c.len / 2 > need) return false;
        return true;
      }
      minor = st === "g" || st === "o";
    } else {
      const e = c.lane.edge >= 0 ? net.edges[c.lane.edge] : null;
      if (e && e.flags & EDGE_STOP && c.stopDone < 0.8) return false;
    }
    if (L.j < 0 || L.req < 0) return true;
    const J = net.junctions[L.j];
    for (let k = 0; k < J.links.length; k++) {
      if (k === L.req) continue;
      const other = J.links[k];
      if (other < 0) continue;
      const ol = net.links[other];
      const crossing = net.lanes[ol.to].kind === LaneKind.Crossing;
      const mustYield = net.yieldsTo(L.j, L.req, k);
      const conflict = mustYield || net.foes(L.j, L.req, k);
      if (!conflict) continue;
      if (crossing) {
        // Never drive into someone already on a crossing in our path.
        if (this.pedOnCrossing(ol.to)) return false;
        continue;
      }
      // Major movements still wait for a foe already inside the junction.
      if (mustYield && minor ? this.linkBusy(ol, 4.5) : ol.vias.some((v) => (this.onLane.get(v)?.length ?? 0) > 0 || this.playerLane === v)) return false;
    }
    return true;
  }

  private stepCar(c: Car, dt: number) {
    const net = this.net;
    const lane = c.lane;
    const v0 = Math.max(2, lane.speed * c.v0f);
    let gap = Infinity, leadV = 0;

    // Leader on the same lane.
    for (const o of this.onLane.get(lane.id) ?? []) {
      if (o === c || o.s <= c.s) continue;
      const g = o.s - c.s - (o.len + c.len) / 2;
      if (g < gap) {
        gap = g;
        leadV = o.v;
      }
    }
    // Leaders further along the path.
    if (gap === Infinity) {
      let acc = lane.length - c.s;
      const path = this.pathAfter(c);
      for (const id of path) {
        if (acc > LOOKAHEAD) break;
        let nearest: Car | null = null;
        for (const o of this.onLane.get(id) ?? []) if (o !== c && (!nearest || o.s < nearest.s)) nearest = o;
        if (nearest) {
          gap = acc + nearest.s - (nearest.len + c.len) / 2;
          leadV = nearest.v;
          break;
        }
        acc += net.lanes[id].length;
      }
    }
    // The player's car in the corridor ahead.
    const pl = this.player;
    if (pl.driving || pl.speed >= 0) {
      const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
      const rx = pl.x - c.x, rz = pl.z - c.z;
      const ahead = rx * fx + rz * fz;
      const side = Math.abs(rx * fz - rz * fx);
      if (ahead > 0 && ahead < 60 && side < (pl.driving ? 1.9 : 1.2)) {
        const g = ahead - c.len / 2 - (pl.driving ? 2.3 : 0.6);
        if (g < gap) {
          gap = g;
          leadV = pl.driving ? pl.speed : 0;
        }
        c.blockedByPlayer = g < 6 && c.v < 0.5 ? c.blockedByPlayer + dt : 0;
      } else c.blockedByPlayer = 0;
    }

    // Junction ahead: a virtual stopped car at the stop line if we may not go.
    if (c.via === -1 && c.link) {
      const dist = lane.length - c.s;
      if (dist < 70) {
        const e = lane.edge >= 0 ? net.edges[lane.edge] : null;
        if (e && e.flags & EDGE_STOP && dist - c.len / 2 < 3.5 && c.v < 0.3) c.stopDone += dt;
        c.go = this.canGo(c, dist);
        if (!c.go) {
          const g = dist - c.len / 2 - 0.8;
          if (g < gap) {
            gap = g;
            leadV = 0;
          }
        }
        // Slow for turns: the internal lane's speed is the safe turning speed.
        if (c.link.vias.length) {
          const turnV = net.lanes[c.link.vias[0]].speed;
          if (c.v > turnV) {
            const need = (c.v * c.v - turnV * turnV) / (2 * c.b);
            if (dist < need + 5) gap = Math.min(gap, Math.max(0.5, dist - c.len / 2) + (turnV * turnV) / (c.b * 0.5));
          }
        }
      }
    }

    // Intelligent Driver Model.
    const s0 = 2.2;
    const dv = c.v - leadV;
    const sStar = s0 + Math.max(0, c.v * c.T + (c.v * dv) / (2 * Math.sqrt(c.a * c.b)));
    let acc = c.a * (1 - Math.pow(c.v / v0, 4));
    if (gap < Infinity) acc -= c.a * Math.pow(sStar / Math.max(0.1, gap), 2);
    acc = Math.max(-9, acc);
    c.v = Math.max(0, c.v + acc * dt);
    if (gap < 0.3 && leadV < 0.5) c.v = Math.min(c.v, Math.max(0, gap));
    c.s += c.v * dt;
    c.wait = c.v < 0.2 ? c.wait + dt : 0;

    if (c.blockedByPlayer > 4 && c.honk <= 0) {
      this.ev.honk(c.x, c.z, "car");
      c.honk = 7;
    }
    c.honk -= dt;

    // Move on to the next lane(s).
    while (c.s > c.lane.length) {
      c.s -= c.lane.length;
      if (c.via === -1) {
        if (!c.link) {
          c.active = false;
          return;
        }
        if (c.link.vias.length) {
          c.via = 0;
          c.lane = net.lanes[c.link.vias[0]];
        } else this.enterRoad(c, net.lanes[c.link.to]);
      } else {
        c.via++;
        if (c.via < c.link!.vias.length) c.lane = net.lanes[c.link!.vias[c.via]];
        else this.enterRoad(c, net.lanes[c.link!.to]);
      }
    }
    // Hopelessly stuck (gridlock, or the player parked in the way): vanish like SUMO's teleport.
    if (c.wait > 50 && c.blockedByPlayer === 0) c.active = false;
    this.place(c);
  }

  private enterRoad(c: Car, l: Lane) {
    c.lane = l;
    c.via = -1;
    c.link = this.pickLink(l);
    c.stopDone = 0;
  }

  private pathAfter(c: Car): number[] {
    if (!c.link) return [];
    const L = c.link;
    if (c.via === -1) return [...L.vias, L.to];
    return [...L.vias.slice(c.via + 1), L.to];
  }

  private place(c: Car) {
    const p = this.net.at(c.lane, c.s, this.pt);
    c.x = p.x;
    c.z = p.z;
    const yaw = Math.atan2(p.dx, p.dz);
    let d = yaw - c.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    c.yaw += Math.abs(d) > 1.2 ? d : d * 0.35;
  }

  // ---------------------------------------------------------- people --

  private spawnPed(p: Ped, px: number, pz: number) {
    p.active = false;
    for (let tries = 0; tries < 20; tries++) {
      const l = this.footLanes[Math.floor(this.rand() * this.footLanes.length)];
      if (!l) return;
      const s = this.rand() * l.length;
      const q = this.net.at(l, s, this.pt);
      const d2 = (q.x - px) ** 2 + (q.z - pz) ** 2;
      if (d2 > (PED_RADIUS * 0.9) ** 2 || d2 < 25 * 25) continue;
      p.lane = l;
      p.s = s;
      p.dir = this.rand() < 0.5 ? 1 : -1;
      p.off = (this.rand() * 2 - 1) * Math.max(0, l.width / 2 - 0.4);
      p.v = 1.1 + this.rand() * 0.45;
      p.area = null;
      p.waiting = 0;
      p.knocked = 0;
      p.active = true;
      this.placePed(p);
      return;
    }
  }

  /** May a pedestrian step onto this crossing now? */
  private mayCross(cross: Lane): boolean {
    const k = this.crossingLink.get(cross.id);
    if (k && k.tl >= 0) {
      const st = this.net.signalState(k.tl, k.li, this.time);
      return (st === "G" || st === "g") && this.net.signalRemaining(k.tl, k.li, this.time) > cross.length / 1.2 + 2;
    }
    const mid = this.net.at(cross, cross.length / 2, this.pt);
    const mx = mid.x, mz = mid.z;
    // Zebra: approaching drivers must stop, so only wait for those too close to.
    const horizon = cross.allow & MARKED ? 1.6 : 6;
    const threat = (x: number, z: number, yaw: number, v: number) => {
      const dx = mx - x, dz = mz - z;
      const d = Math.hypot(dx, dz);
      if (d > 50) return false;
      if (d < 5) return true;
      const closing = v * ((Math.sin(yaw) * dx + Math.cos(yaw) * dz) / (d || 1));
      return closing > 0.5 && d / closing < horizon;
    };
    for (const c of this.cars) if (c.active && threat(c.x, c.z, c.yaw, c.v)) return false;
    const pl = this.player;
    if (pl.driving && threat(pl.x, pl.z, pl.yaw, pl.speed)) return false;
    return true;
  }

  private stepPed(p: Ped, dt: number) {
    if (p.knocked > 0) {
      p.knocked -= dt;
      return;
    }
    if (p.area) {
      const a = p.area;
      // About to step onto a crossing: wait at the kerb until it's safe.
      if (a.t >= a.len - 0.05 && a.next.kind === LaneKind.Crossing && !this.mayCross(a.next)) {
        p.waiting += dt;
        if (p.waiting > 90) p.active = false; // gave up
        this.placePed(p);
        return;
      }
      p.waiting = 0;
      a.t += p.v * dt;
      if (a.t >= a.len) {
        p.lane = a.next;
        p.dir = a.nextDir;
        p.s = p.dir > 0 ? 0 : p.lane.length;
        p.off = p.lane.kind === LaneKind.Crossing ? (this.rand() * 2 - 1) * Math.max(0, p.lane.width / 2 - 0.6) : (this.rand() * 2 - 1) * Math.max(0, p.lane.width / 2 - 0.4);
        p.area = null;
      }
      this.placePed(p);
      return;
    }
    p.s += p.v * dt * p.dir;
    if (p.s < 0 || p.s > p.lane.length) {
      const atEnd = p.s > p.lane.length;
      const w = atEnd ? this.endW[p.lane.id] : this.startW[p.lane.id];
      const opts = w >= 0 ? (this.waAttach.get(w) ?? []).filter((o) => o.lane !== p.lane) : [];
      // Crossings less often than carrying on along the footpath.
      const pool = opts.flatMap((o) => (o.lane.kind === LaneKind.Crossing ? [o] : [o, o]));
      if (!pool.length) {
        // Dead end: turn around.
        p.dir = p.dir > 0 ? -1 : 1;
        p.s = Math.max(0, Math.min(p.lane.length, p.s));
      } else {
        const o = pool[Math.floor(this.rand() * pool.length)];
        const from = this.net.at(p.lane, Math.max(0, Math.min(p.lane.length, p.s)), this.pt);
        const fx = from.x + from.dz * p.off, fz = from.z - from.dx * p.off;
        const to = this.net.at(o.lane, o.atStart ? 0 : o.lane.length, this.pt);
        const len = Math.hypot(to.x - fx, to.z - fz);
        p.area = { ax: fx, az: fz, bx: to.x, bz: to.z, len: Math.max(0.01, len), t: 0, next: o.lane, nextDir: o.atStart ? 1 : -1 };
      }
    }
    this.placePed(p);
  }

  private placePed(p: Ped) {
    let x: number, z: number, dx: number, dz: number;
    if (p.area) {
      const a = p.area;
      const t = Math.min(1, a.t / a.len);
      x = a.ax + (a.bx - a.ax) * t;
      z = a.az + (a.bz - a.az) * t;
      dx = (a.bx - a.ax) / a.len;
      dz = (a.bz - a.az) / a.len;
    } else {
      const q = this.net.at(p.lane, p.s, this.pt);
      x = q.x + q.dz * p.off;
      z = q.z - q.dx * p.off;
      dx = q.dx * p.dir;
      dz = q.dz * p.dir;
    }
    p.x = x;
    p.z = z;
    if (Math.abs(dx) + Math.abs(dz) > 0.01) {
      const yaw = Math.atan2(dx, dz);
      let d = Math.atan2(Math.sin(yaw - p.yaw), Math.cos(yaw - p.yaw));
      p.yaw += Math.abs(d) > 2 ? d : d * 0.25;
    }
  }

  // ----------------------------------------------------------- render --

  private render() {
    const vc = this.vMeshes.map(() => 0);
    for (const c of this.cars) {
      if (!c.active) continue;
      const mesh = this.vMeshes[c.kind];
      if (vc[c.kind] >= mesh.instanceMatrix.count) continue;
      this.m.compose(this.p3.set(c.x, 0.03, c.z), this.q.setFromAxisAngle(this.up, c.yaw), this.one);
      mesh.setMatrixAt(vc[c.kind]++, this.m);
    }
    this.vMeshes.forEach((mesh, i) => {
      mesh.count = vc[i];
      mesh.instanceMatrix.needsUpdate = true;
    });
    const wc = this.wMeshes.map(() => 0);
    for (const p of this.peds) {
      if (!p.active) continue;
      const moving = p.knocked <= 0 && p.waiting === 0;
      if (moving) p.phase += 0.016 * p.v * 6;
      const mi = p.kind * 2 + (moving && Math.sin(p.phase) > 0 ? 1 : 0);
      const y = p.lane?.kind === LaneKind.Footpath || p.area ? 0.15 : 0.03;
      if (p.knocked > 0) {
        // Knocked down: lying in the road.
        this.q.setFromEuler(new THREE.Euler(Math.PI / 2, p.yaw, 0, "YXZ"));
        this.m.compose(this.p3.set(p.x, 0.2, p.z), this.q, this.one);
      } else this.m.compose(this.p3.set(p.x, y + (moving ? Math.abs(Math.sin(p.phase)) * 0.04 : 0), p.z), this.q.setFromAxisAngle(this.up, p.yaw), this.one);
      this.wMeshes[mi].setMatrixAt(wc[mi]++, this.m);
    }
    this.wMeshes.forEach((mesh, i) => {
      mesh.count = wc[i];
      mesh.instanceMatrix.needsUpdate = true;
    });
  }
}
