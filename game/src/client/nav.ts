import * as THREE from "three/webgpu";
import { ALLOW_CAR, ALLOW_SERVICE, LaneKind, type Lane, type Link, type RoadNet } from "./roadnet";

// Sat-nav on the real road network: shortest-time routes over SUMO edges
// (so one-way streets and banned turns are respected), turn-by-turn
// instructions with street names, rerouting when you leave the route, and
// chevrons painted on the road ahead like a game GPS.

export interface Instruction {
  /** Distance along the route (m) where the manoeuvre happens. */
  at: number;
  kind: "left" | "right" | "slight-left" | "slight-right" | "straight" | "uturn" | "arrive";
  text: string;
  road: string;
}

interface Step {
  edge: number;
  /** Link used to leave this edge (null on the last). */
  link: Link | null;
  /** Distance along the route where this edge starts. */
  start: number;
  length: number;
}

export class Navigator {
  dest: { x: number; z: number; name: string } | null = null;
  steps: Step[] = [];
  instructions: Instruction[] = [];
  /** Polyline of the route (x, z pairs) and cumulative distance at each point. */
  path: number[] = [];
  pathCum: number[] = [];
  /** How far along the route the car is (m). */
  progress = 0;
  total = 0;
  arrived = false;
  onReroute: () => void = () => {};
  private offRouteT = 0;
  private succ: Map<number, { edge: number; link: Link; cost: number }[]> = new Map();
  private edgeLen: Float32Array;
  private edgeSpeed: Float32Array;
  private edgeLane: Int32Array; // a representative car lane per edge
  readonly arrows: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();

  constructor(private net: RoadNet) {
    const n = net.edges.length;
    this.edgeLen = new Float32Array(n);
    this.edgeSpeed = new Float32Array(n);
    this.edgeLane = new Int32Array(n).fill(-1);
    net.edges.forEach((e, i) => {
      const cars = net.carLanes(e);
      if (!cars.length) return;
      this.edgeLane[i] = cars[0].id;
      this.edgeLen[i] = cars[0].length;
      this.edgeSpeed[i] = Math.max(3, cars[0].speed) * (cars[0].allow & ALLOW_SERVICE ? 0.35 : 1);
      const out: { edge: number; link: Link; cost: number }[] = [];
      const seen = new Set<number>();
      for (const l of cars) {
        for (const k of l.out) {
          const link = net.links[k];
          const to = net.lanes[link.to];
          if (to.kind !== LaneKind.Road || !(to.allow & ALLOW_CAR) || to.edge < 0 || seen.has(to.edge)) continue;
          seen.add(to.edge);
          const turn = link.dir === "s" ? 0 : link.dir === "t" || link.dir === "T" ? 40 : link.dir === "l" || link.dir === "r" ? 7 : 3;
          const via = link.vias.reduce((s, v) => s + net.lanes[v].length, 0);
          out.push({ edge: to.edge, link, cost: turn + via / 6 });
        }
      }
      this.succ.set(i, out);
    });

    // Ground chevrons: a flat arrow shape, glowing, drawn over the road.
    const shape = new THREE.Shape();
    shape.moveTo(-0.9, -0.5);
    shape.lineTo(0, 0.6);
    shape.lineTo(0.9, -0.5);
    shape.lineTo(0.55, -0.5);
    shape.lineTo(0, 0.15);
    shape.lineTo(-0.55, -0.5);
    shape.closePath();
    const geo = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(0.25, 1.4, 2.2), transparent: true, opacity: 0.85, depthWrite: false });
    this.arrows = new THREE.InstancedMesh(geo, mat, 60);
    this.arrows.count = 0;
    this.arrows.frustumCulled = false;
    this.arrows.renderOrder = 3;
  }

  clear() {
    this.dest = null;
    this.steps = [];
    this.instructions = [];
    this.path = [];
    this.pathCum = [];
    this.arrows.count = 0;
    this.arrived = false;
  }

  /** Set a destination and route to it from (x, z) heading yaw. Returns false if unreachable. */
  route(x: number, z: number, yaw: number, dest: { x: number; z: number; name: string }): boolean {
    this.dest = dest;
    this.arrived = false;
    const net = this.net;
    const here = net.locate(x, z, yaw, ALLOW_CAR);
    let startEdge = -1, startS = 0;
    if (here) {
      if (here.lane.edge >= 0) {
        startEdge = here.lane.edge;
        startS = here.s;
      } else {
        // Inside a junction: start on the road the movement leads to.
        const link = net.links.find((k) => k.vias.includes(here.lane.id));
        if (link) startEdge = net.lanes[link.to].edge;
      }
    }
    if (startEdge < 0) startEdge = this.nearestEdge(x, z);
    // Either side of the street will do: aiming for one direction only sent
    // routes to the end of a cul-de-sac to turn round (onto the kerb).
    const goals = this.nearestEdges(dest.x, dest.z, 4);
    let goal = goals.size ? goals.values().next().value! : -1;
    if (startEdge < 0 || goal < 0) return false;

    // A* over edges, cost in seconds.
    const n = net.edges.length;
    const g = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const prevLink: (Link | null)[] = new Array(n).fill(null);
    const open: [number, number][] = [];
    const gx = dest.x, gz = dest.z;
    const h = (e: number) => {
      const j = net.junctions[net.edges[e].to];
      return j ? Math.hypot(j.x - gx, j.z - gz) / 30 : 0;
    };
    g[startEdge] = (this.edgeLen[startEdge] - startS) / this.edgeSpeed[startEdge];
    push(open, [g[startEdge] + h(startEdge), startEdge]);
    const closed = new Uint8Array(n);
    while (open.length) {
      const [, e] = pop(open);
      if (closed[e]) continue;
      closed[e] = 1;
      if (goals.has(e)) {
        goal = e;
        break;
      }
      for (const s of this.succ.get(e) ?? []) {
        const c = g[e] + s.cost + this.edgeLen[s.edge] / this.edgeSpeed[s.edge];
        if (c < g[s.edge]) {
          g[s.edge] = c;
          prev[s.edge] = e;
          prevLink[s.edge] = s.link;
          push(open, [c + h(s.edge), s.edge]);
        }
      }
    }
    if (!closed[goal]) return false;
    const chain: number[] = [];
    for (let e = goal; e !== -1; e = prev[e]) chain.unshift(e);
    this.steps = [];
    let at = 0;
    chain.forEach((e, i) => {
      const len = i === 0 ? this.edgeLen[e] - startS : this.edgeLen[e];
      this.steps.push({ edge: e, link: i + 1 < chain.length ? prevLink[chain[i + 1]] : null, start: at, length: len });
      at += len;
      const l = i + 1 < chain.length ? prevLink[chain[i + 1]] : null;
      if (l) at += l.vias.reduce((s, v) => s + net.lanes[v].length, 0);
    });
    this.total = at;
    this.progress = 0;
    this.buildPath(startS);
    this.buildInstructions();
    return true;
  }

  /** Edges whose car lanes come within `slack` m of the nearest one to (x, z), nearest first. */
  private nearestEdges(x: number, z: number, slack: number): Set<number> {
    const d = new Map<number, number>();
    for (const l of this.net.lanes) {
      if (l.kind !== LaneKind.Road || !(l.allow & ALLOW_CAR) || l.edge < 0) continue;
      for (let k = 0; k + 3 < l.pts.length; k += 2) {
        const v = segDist(x, z, l.pts[k], l.pts[k + 1], l.pts[k + 2], l.pts[k + 3]) + (l.allow & ALLOW_SERVICE ? 15 : 0);
        if (v < (d.get(l.edge) ?? Infinity)) d.set(l.edge, v);
      }
    }
    const best = Math.min(...d.values());
    return new Set([...d].filter(([, v]) => v <= best + slack).sort((a, b) => a[1] - b[1]).map(([e]) => e));
  }

  private nearestEdge(x: number, z: number): number {
    let best = -1, bd = Infinity;
    for (const l of this.net.lanes) {
      if (l.kind !== LaneKind.Road || !(l.allow & ALLOW_CAR) || l.edge < 0) continue;
      for (let k = 0; k + 3 < l.pts.length; k += 2) {
        const d = segDist(x, z, l.pts[k], l.pts[k + 1], l.pts[k + 2], l.pts[k + 3]) + (l.allow & ALLOW_SERVICE ? 15 : 0);
        if (d < bd) {
          bd = d;
          best = l.edge;
        }
      }
    }
    return best;
  }

  /** Concatenate the lanes and junction curves the route drives along. */
  private buildPath(startS: number) {
    const net = this.net;
    const pts: number[] = [];
    const at = { x: 0, z: 0, dx: 0, dz: 0 };
    const add = (l: Lane, from = 0) => {
      // Start exactly where the car is: a straight lane has points only at its
      // ends, and skipping to the next one started the route up to a lane's
      // length ahead (the car looked off-route and it rerouted every 1.5 s).
      if (from > 0) {
        net.at(l, from, at);
        pts.push(at.x, at.z);
      }
      for (let k = 0; k < l.pts.length; k += 2) {
        if (from > 0 && l.cum[k / 2] <= from) continue;
        pts.push(l.pts[k], l.pts[k + 1]);
      }
    };
    this.steps.forEach((s, i) => {
      const lane = s.link ? net.lanes[s.link.from] : net.lanes[this.edgeLane[s.edge]];
      add(lane, i === 0 ? startS : 0);
      if (s.link) for (const v of s.link.vias) add(net.lanes[v]);
    });
    if (this.dest) pts.push(this.dest.x, this.dest.z);
    this.path = pts;
    this.pathCum = [0];
    for (let k = 2; k < pts.length; k += 2) this.pathCum.push(this.pathCum[this.pathCum.length - 1] + Math.hypot(pts[k] - pts[k - 2], pts[k + 1] - pts[k - 1]));
    this.total = this.pathCum[this.pathCum.length - 1] ?? 0;
  }

  private roadName(edge: number) {
    const e = this.net.edges[edge];
    return e && e.name !== 0xffff ? this.net.names[e.name] ?? "" : "";
  }

  private buildInstructions() {
    const out: Instruction[] = [];
    for (let i = 0; i + 1 < this.steps.length; i++) {
      const s = this.steps[i];
      const d = s.link!.dir;
      const next = this.roadName(this.steps[i + 1].edge);
      const cur = this.roadName(s.edge);
      const at = this.pathCum.length ? this.pathAt(s.link!) : s.start + s.length;
      const onto = next ? ` onto ${next}` : "";
      // Crossing between the two halves of a dual carriageway isn't a real turn.
      if (cur && cur === next && d !== "t" && d !== "T") continue;
      if (d === "l") out.push({ at, kind: "left", text: `Turn left${onto}`, road: next });
      else if (d === "r") out.push({ at, kind: "right", text: `Turn right${onto}`, road: next });
      else if (d === "L") out.push({ at, kind: "slight-left", text: `Bear left${onto}`, road: next });
      else if (d === "R") out.push({ at, kind: "slight-right", text: `Bear right${onto}`, road: next });
      else if (d === "t" || d === "T") out.push({ at, kind: "uturn", text: "Make a U-turn when safe", road: next });
      else if (next && next !== cur && cur) out.push({ at, kind: "straight", text: `Continue onto ${next}`, road: next });
    }
    out.push({ at: this.total, kind: "arrive", text: `Arrive at ${this.dest?.name ?? "your destination"}`, road: "" });
    this.instructions = out;
  }

  /** Distance along the route path where `link` leaves its lane (the stop line). */
  pathAt(link: Link): number {
    const l = this.net.lanes[link.from];
    const ex = l.pts[l.pts.length - 2], ez = l.pts[l.pts.length - 1];
    let best = 0, bd = Infinity;
    for (let k = 0; k < this.path.length; k += 2) {
      const d = (this.path[k] - ex) ** 2 + (this.path[k + 1] - ez) ** 2;
      if (d < bd) {
        bd = d;
        best = this.pathCum[k / 2];
      }
    }
    return best;
  }

  /** Nearest point on the route between distances s0 and s1: [distance along, how far off]. */
  private nearest(x: number, z: number, s0: number, s1: number): [number, number] {
    let best = this.progress, bd = Infinity;
    for (let k = 0; k + 3 < this.path.length; k += 2) {
      // A segment counts if any of it is in the window (a straight road can be one 100 m+ segment).
      const c0 = this.pathCum[k / 2], c1 = this.pathCum[k / 2 + 1];
      if (c1 < s0 || c0 > s1) continue;
      const ax = this.path[k], az = this.path[k + 1], bx = this.path[k + 2], bz = this.path[k + 3];
      const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
      const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
      if (d < bd) {
        bd = d;
        best = c0 + Math.sqrt(len2) * t;
      }
    }
    return [best, bd];
  }

  /** Track the car along the route; reroute when it strays. Returns the next instruction. */
  update(dt: number, x: number, z: number, yaw: number): Instruction | null {
    if (!this.dest || !this.path.length) return null;
    // Project onto the route near the current progress: a short window first,
    // so a route that comes back past itself (round a block) can't make the
    // progress jump ahead; wider only when the car isn't near it.
    let [best, bd] = this.nearest(x, z, this.progress - 20, this.progress + 40);
    if (bd > 6) [best, bd] = this.nearest(x, z, this.progress - 60, this.progress + 200);
    this.progress = Math.max(this.progress, best);
    this.offRouteT = bd > 18 ? this.offRouteT + dt : 0;
    if (this.offRouteT > 1.5 && this.dest) {
      this.offRouteT = 0;
      if (this.route(x, z, yaw, this.dest)) this.onReroute();
    }
    if (Math.hypot(x - this.dest.x, z - this.dest.z) < 25 || this.total - this.progress < 12) {
      this.arrived = true;
      this.arrows.count = 0;
      return this.instructions[this.instructions.length - 1];
    }
    this.placeArrows();
    return this.instructions.find((i) => i.at > this.progress - 5) ?? null;
  }

  /** Chevrons every 7 m for the next ~180 m of route, pointing the way. */
  private placeArrows() {
    let n = 0;
    const start = Math.ceil((this.progress + 6) / 7) * 7;
    let k = 0;
    for (let s = start; s < this.progress + 180 && n < this.arrows.instanceMatrix.count; s += 7) {
      while (k + 1 < this.pathCum.length - 1 && this.pathCum[k + 1] < s) k++;
      if (k + 1 >= this.pathCum.length) break;
      const seg = this.pathCum[k + 1] - this.pathCum[k] || 1;
      const t = (s - this.pathCum[k]) / seg;
      const ax = this.path[k * 2], az = this.path[k * 2 + 1], bx = this.path[k * 2 + 2], bz = this.path[k * 2 + 3];
      this.dummy.position.set(ax + (bx - ax) * t, 0.07, az + (bz - az) * t);
      this.dummy.rotation.set(0, Math.atan2(bx - ax, bz - az), 0);
      this.dummy.updateMatrix();
      this.arrows.setMatrixAt(n++, this.dummy.matrix);
    }
    this.arrows.count = n;
    this.arrows.instanceMatrix.needsUpdate = true;
  }
}

function segDist(x: number, z: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2));
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t));
}

// Binary heap on [priority, value].
function push(h: [number, number][], v: [number, number]) {
  h.push(v);
  let i = h.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (h[p][0] <= h[i][0]) break;
    [h[p], h[i]] = [h[i], h[p]];
    i = p;
  }
}
function pop(h: [number, number][]): [number, number] {
  const top = h[0];
  const last = h.pop()!;
  if (h.length) {
    h[0] = last;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1, r = l + 1;
      let m = i;
      if (l < h.length && h[l][0] < h[m][0]) m = l;
      if (r < h.length && h[r][0] < h[m][0]) m = r;
      if (m === i) break;
      [h[m], h[i]] = [h[i], h[m]];
      i = m;
    }
  }
  return top;
}
