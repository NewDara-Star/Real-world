import * as THREE from "three";
import { makeTemplate, mulberry32, templateGeometry } from "./props";
import type { Road, World } from "./world";

// Ambient city life around the local player: danfos, kekes, okadas, cars and
// pedestrians following the real road graph. Purely client-side (not synced)
// and only simulated within a ring around the player, so cost stays flat.

interface Edge {
  road: Road;
  /** cumulative distance at each polyline point */
  cum: Float32Array;
  len: number;
  a: string;
  b: string;
}

interface Agent {
  kind: number;
  edge: Edge;
  dir: 1 | -1;
  t: number;
  speed: number;
  cruise: number;
  offset: number;
  x: number;
  z: number;
  yaw: number;
  phase: number;
  honkCooldown: number;
}

const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);
const wheel = (x: number, z: number, r = 0.36) => new THREE.CylinderGeometry(r, r, 0.22, 8).rotateZ(Math.PI / 2).translate(x, r, z);

function danfo() {
  return makeTemplate([
    [box(1.95, 1.75, 4.6, 0, 0.35, 0), 0xf2b705],
    [box(1.97, 0.16, 4.62, 0, 1.05, 0), 0x111111], // black stripe
    [box(1.97, 0.12, 4.62, 0, 0.62, 0), 0x111111],
    [box(1.98, 0.48, 3.6, 0, 1.25, -0.3), 0x2b3238], // windows
    [box(1.8, 0.62, 0.06, 0, 1.0, 2.31), 0x2b3238], // windscreen
    [box(1.6, 0.25, 0.9, 0, 2.1, -1.2), 0x6b5a48], // roof luggage
    [wheel(-0.95, 1.5), 0x1a1a1a], [wheel(0.95, 1.5), 0x1a1a1a], [wheel(-0.95, -1.5), 0x1a1a1a], [wheel(0.95, -1.5), 0x1a1a1a],
  ]);
}
function keke() {
  return makeTemplate([
    [box(1.25, 0.75, 2.4, 0, 0.3, 0), 0x2a9d4a],
    [box(1.3, 0.08, 2.3, 0, 1.75, -0.05), 0xf2c94c], // canopy
    [box(0.06, 0.75, 0.06, -0.6, 1.0, 1.0), 0x333333], [box(0.06, 0.75, 0.06, 0.6, 1.0, 1.0), 0x333333],
    [box(0.06, 0.75, 0.06, -0.6, 1.0, -1.1), 0x333333], [box(0.06, 0.75, 0.06, 0.6, 1.0, -1.1), 0x333333],
    [box(0.9, 0.5, 0.05, 0, 1.15, 1.05), 0x2b3238],
    [wheel(0, 1.0, 0.28), 0x1a1a1a], [wheel(-0.6, -0.8, 0.28), 0x1a1a1a], [wheel(0.6, -0.8, 0.28), 0x1a1a1a],
  ]);
}
function okada() {
  return makeTemplate([
    [box(0.28, 0.45, 1.6, 0, 0.35, 0), 0xb33a3a],
    [wheel(0, 0.65, 0.32), 0x1a1a1a], [wheel(0, -0.65, 0.32), 0x1a1a1a],
    [box(0.45, 0.65, 0.3, 0, 0.95, -0.15), 0x2a62a8], // rider torso
    [box(0.26, 0.28, 0.26, 0, 1.62, -0.12), 0x5b3a29], // head
    [box(0.3, 0.1, 0.3, 0, 1.9, -0.12), 0xd62828], // cap/helmet
    [box(0.4, 0.55, 0.3, 0, 0.95, -0.6), 0xe0a030], // passenger
    [box(0.24, 0.26, 0.24, 0, 1.52, -0.6), 0x6b4430],
  ]);
}
function car(color: number) {
  return makeTemplate([
    [box(1.75, 0.6, 4.2, 0, 0.3, 0), color],
    [box(1.55, 0.5, 2.1, 0, 0.9, -0.3), color],
    [box(1.57, 0.36, 2.0, 0, 0.98, -0.3), 0x2b3238],
    [wheel(-0.85, 1.3, 0.32), 0x1a1a1a], [wheel(0.85, 1.3, 0.32), 0x1a1a1a], [wheel(-0.85, -1.3, 0.32), 0x1a1a1a], [wheel(0.85, -1.3, 0.32), 0x1a1a1a],
  ]);
}
function walker(shirt: number, step: number) {
  const s = step ? 0.32 : 0;
  return makeTemplate([
    [box(0.2, 0.86, 0.22, -0.12, 0, s * 0.6).rotateX(0), 0x2b2d42],
    [box(0.2, 0.86, 0.22, 0.12, 0, -s * 0.6), 0x2b2d42],
    [box(0.5, 0.62, 0.28, 0, 0.88, 0), shirt],
    [box(0.13, 0.58, 0.15, -0.33, 0.92, -s * 0.5), 0x5b3a29],
    [box(0.13, 0.58, 0.15, 0.33, 0.92, s * 0.5), 0x5b3a29],
    [box(0.3, 0.32, 0.3, 0, 1.55, 0), 0x5b3a29],
    [box(0.32, 0.08, 0.32, 0, 1.86, 0), 0x111111],
  ]);
}

const VEHICLE_KINDS = [
  { name: "danfo", tpl: danfo(), max: 14, speed: 8.5, w: 2.0, len: 4.8, horn: true },
  { name: "keke", tpl: keke(), max: 8, speed: 6, w: 1.3, len: 2.6, horn: true },
  { name: "okada", tpl: okada(), max: 10, speed: 9.5, w: 0.6, len: 1.8, horn: true },
  { name: "car1", tpl: car(0xf2f2f2), max: 6, speed: 9, w: 1.8, len: 4.3, horn: false },
  { name: "car2", tpl: car(0x1f3b73), max: 5, speed: 9, w: 1.8, len: 4.3, horn: false },
  { name: "car3", tpl: car(0x8b1e1e), max: 4, speed: 9, w: 1.8, len: 4.3, horn: false },
];
const SHIRTS = [0xe4572e, 0x1f9d55, 0xf3a712, 0x2a62a8, 0x8e44ad, 0xffffff];
const WALKER_KINDS = SHIRTS.flatMap((c) => [walker(c, 0), walker(c, 1)]);

const SIM_RADIUS = 220;
const SPAWN_MIN = 40;

export interface TrafficEvents {
  honk(x: number, z: number, kind: string): void;
}

export class Traffic {
  group = new THREE.Group();
  private vehicleEdges: Edge[] = [];
  private walkEdges: Edge[] = [];
  private vNodes = new Map<string, Edge[]>();
  private wNodes = new Map<string, Edge[]>();
  private vehicles: Agent[] = [];
  private walkers: Agent[] = [];
  private vMeshes: THREE.InstancedMesh[] = [];
  private wMeshes: THREE.InstancedMesh[] = [];
  private rand = mulberry32(Date.now() & 0xffff);
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 1, 0);
  private v = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);
  /** Number of vehicles within ~60 m of the player, for the traffic sound bed. */
  nearbyVehicles = 0;

  constructor(world: World, private ev: TrafficEvents, budget: { vehicles: number; walkers: number }) {
    for (const r of world.roads) {
      if (r.cls >= 1 && r.cls <= 6) this.addEdge(r, this.vehicleEdges, this.vNodes);
      if (r.cls >= 3 && r.cls <= 9) this.addEdge(r, this.walkEdges, this.wNodes);
    }
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
    const scale = budget.vehicles / VEHICLE_KINDS.reduce((s, k) => s + k.max, 0);
    VEHICLE_KINDS.forEach((k, kind) => {
      const n = Math.max(1, Math.round(k.max * scale));
      const mesh = new THREE.InstancedMesh(templateGeometry(k.tpl), mat, n);
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.vMeshes.push(mesh);
      this.group.add(mesh);
      for (let i = 0; i < n; i++) this.vehicles.push(this.blankAgent(kind));
    });
    WALKER_KINDS.forEach((tpl) => {
      const mesh = new THREE.InstancedMesh(templateGeometry(tpl), mat, budget.walkers);
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.wMeshes.push(mesh);
      this.group.add(mesh);
    });
    for (let i = 0; i < budget.walkers; i++) this.walkers.push(this.blankAgent(i % SHIRTS.length));
  }

  update(dt: number, px: number, pz: number) {
    this.nearbyVehicles = 0;
    const counts = this.vMeshes.map(() => 0);
    for (const a of this.vehicles) {
      if (!a.edge || (a.x - px) ** 2 + (a.z - pz) ** 2 > SIM_RADIUS * SIM_RADIUS) this.respawn(a, px, pz, this.vehicleEdges, true);
      if (!a.edge) continue;
      const k = VEHICLE_KINDS[a.kind];
      // Stop for the player standing in the lane ahead (and lean on the horn).
      const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
      const rx = px - a.x, rz = pz - a.z;
      const ahead = rx * fx + rz * fz;
      const side = Math.abs(rx * fz - rz * fx);
      const blocked = ahead > 0 && ahead < k.len / 2 + 4 && side < k.w / 2 + 0.6;
      const target = blocked ? 0 : a.cruise;
      a.speed += (target - a.speed) * Math.min(1, dt * (blocked ? 6 : 1.2));
      a.honkCooldown -= dt;
      if (blocked && k.horn && a.honkCooldown <= 0) {
        this.ev.honk(a.x, a.z, k.name);
        a.honkCooldown = 2.5 + this.rand() * 2;
      } else if (k.horn && a.honkCooldown <= 0 && this.rand() < dt * 0.02) {
        this.ev.honk(a.x, a.z, k.name); // Lagos drivers honk for no reason at all
        a.honkCooldown = 6;
      }
      this.advance(a, dt, this.vNodes, true);
      if ((a.x - px) ** 2 + (a.z - pz) ** 2 < 60 * 60) this.nearbyVehicles++;
      this.m.compose(this.v.set(a.x, 0.02, a.z), this.q.setFromAxisAngle(this.up, a.yaw), this.one);
      this.vMeshes[a.kind].setMatrixAt(counts[a.kind]++, this.m);
    }
    this.vMeshes.forEach((mesh, i) => {
      mesh.count = counts[i];
      mesh.instanceMatrix.needsUpdate = true;
    });

    const wc = this.wMeshes.map(() => 0);
    for (const a of this.walkers) {
      if (!a.edge || (a.x - px) ** 2 + (a.z - pz) ** 2 > (SIM_RADIUS * 0.6) ** 2) this.respawn(a, px, pz, this.walkEdges, false);
      if (!a.edge) continue;
      this.advance(a, dt, this.wNodes, false);
      a.phase += dt * a.speed * 1.6;
      const mi = a.kind * 2 + (Math.sin(a.phase) > 0 ? 1 : 0);
      this.m.compose(this.v.set(a.x, Math.abs(Math.sin(a.phase)) * 0.04, a.z), this.q.setFromAxisAngle(this.up, a.yaw), this.one);
      this.wMeshes[mi].setMatrixAt(wc[mi]++, this.m);
    }
    this.wMeshes.forEach((mesh, i) => {
      mesh.count = wc[i];
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  private addEdge(road: Road, list: Edge[], nodes: Map<string, Edge[]>) {
    const n = road.pts.length / 2;
    const cum = new Float32Array(n);
    for (let i = 1; i < n; i++) {
      cum[i] = cum[i - 1] + Math.hypot(road.pts[i * 2] - road.pts[i * 2 - 2], road.pts[i * 2 + 1] - road.pts[i * 2 - 1]);
    }
    if (cum[n - 1] < 2) return;
    const nk = (i: number) => `${Math.round(road.pts[i * 2])},${Math.round(road.pts[i * 2 + 1])}`;
    const e: Edge = { road, cum, len: cum[n - 1], a: nk(0), b: nk(n - 1) };
    list.push(e);
    for (const k of [e.a, e.b]) {
      let l = nodes.get(k);
      if (!l) nodes.set(k, (l = []));
      l.push(e);
    }
  }

  private blankAgent(kind: number): Agent {
    return { kind, edge: null as unknown as Edge, dir: 1, t: 0, speed: 0, cruise: 0, offset: 0, x: 1e9, z: 1e9, yaw: 0, phase: 0, honkCooldown: 0 };
  }

  /** Place an agent on a random edge in a ring around the player. */
  private respawn(a: Agent, px: number, pz: number, edges: Edge[], vehicle: boolean) {
    for (let tries = 0; tries < 30; tries++) {
      const e = edges[Math.floor(this.rand() * edges.length)];
      if (!e) return;
      const t = this.rand() * e.len;
      const p = pointAt(e, t);
      const d2 = (p.x - px) ** 2 + (p.z - pz) ** 2;
      const max = vehicle ? SIM_RADIUS * 0.9 : SIM_RADIUS * 0.55;
      if (d2 > max * max || d2 < SPAWN_MIN * SPAWN_MIN) continue;
      a.edge = e;
      a.t = t;
      a.dir = this.rand() < 0.5 ? 1 : -1;
      if (vehicle) {
        const k = VEHICLE_KINDS[a.kind];
        a.cruise = k.speed * (e.road.cls >= 6 ? 0.6 : 1) * (0.8 + this.rand() * 0.4);
        // Nigeria drives on the right: offset to the right of travel.
        a.offset = Math.max(1.2, e.road.w / 4);
      } else {
        a.cruise = 1.1 + this.rand() * 0.5;
        a.offset = e.road.w / 2 + 1.0 + this.rand() * 1.2;
        if (this.rand() < 0.5) a.offset = -a.offset;
      }
      a.speed = a.cruise;
      this.place(a);
      return;
    }
  }

  private advance(a: Agent, dt: number, nodes: Map<string, Edge[]>, vehicle: boolean) {
    a.t += a.speed * dt * a.dir;
    if (a.t < 0 || a.t > a.edge.len) {
      const node = a.t < 0 ? a.edge.a : a.edge.b;
      const options = (nodes.get(node) ?? []).filter((e) => e !== a.edge);
      // Prefer roads of similar size so danfos stay on the main roads.
      const similar = vehicle ? options.filter((e) => Math.abs(e.road.cls - a.edge.road.cls) <= 1) : options;
      const pool = similar.length ? similar : options;
      if (!pool.length) {
        a.dir = a.dir === 1 ? -1 : 1; // dead end: turn around
        a.t = Math.max(0, Math.min(a.edge.len, a.t));
      } else {
        const next = pool[Math.floor(this.rand() * pool.length)];
        a.edge = next;
        if (next.a === node) {
          a.dir = 1;
          a.t = 0;
        } else {
          a.dir = -1;
          a.t = next.len;
        }
        if (vehicle) a.offset = Math.max(1.2, next.road.w / 4);
      }
    }
    this.place(a);
  }

  private place(a: Agent) {
    const p = pointAt(a.edge, a.t);
    const dx = p.dx * a.dir, dz = p.dz * a.dir;
    // Right-hand side of travel direction (x right, z south): right = (-dz, dx).
    const off = a.offset;
    a.x = p.x - dz * off;
    a.z = p.z + dx * off;
    const yaw = Math.atan2(dx, dz);
    let d = yaw - a.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    a.yaw += d * 0.25;
  }
}

function pointAt(e: Edge, t: number) {
  const { cum } = e;
  const pts = e.road.pts;
  t = Math.max(0, Math.min(e.len, t));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < t) i++;
  const seg = cum[i] - cum[i - 1] || 1;
  const k = (t - cum[i - 1]) / seg;
  const ax = pts[(i - 1) * 2], az = pts[(i - 1) * 2 + 1], bx = pts[i * 2], bz = pts[i * 2 + 1];
  return { x: ax + (bx - ax) * k, z: az + (bz - az) * k, dx: (bx - ax) / seg, dz: (bz - az) / seg };
}
