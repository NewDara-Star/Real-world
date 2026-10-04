import { ALLOW_CAR, ALLOW_PED, EDGE_GIVE_WAY, EDGE_STOP, LaneKind, type Lane, type Link, type RoadNet } from "./roadnet";
import type { NetTraffic } from "./trafficnet";

// The examiner: watches the player's driving against the road network and
// marks faults the way the RSA driving test does.
//   Grade 1: minor.  Grade 2: serious.  Grade 3: dangerous or potentially dangerous.
// The Irish test is failed by any grade 3, four grade 2s on the same item,
// six or more grade 2s in one section, or nine or more grade 2s overall.

export interface Fault {
  grade: 1 | 2 | 3;
  item: string;
  text: string;
  at: number;
}

/** What the examiner needs to know about the car each frame. */
export interface CarState {
  x: number;
  z: number;
  yaw: number;
  /** Signed forward speed (m/s); negative reversing. */
  vf: number;
  indicator: number; // -1 left, 1 right, 0 off
  hazards: boolean;
  selector: string;
}

export class Examiner {
  faults: Fault[] = [];
  onFault: (f: Fault) => void = () => {};
  /** Current speed limit (km/h), for the dash; 0 when unknown. */
  limit = 0;
  /** Name of the road you're on, for the HUD. */
  road = "";

  private t = 0;
  private approach: { lane: Lane; minSpeed: number; dist: number } | null = null;
  private indOnSince: Record<number, number> = { [-1]: -1, [1]: -1 };
  private lastIndicator = 0;
  private lastLook: Record<string, number> = { left: -99, right: -99, back: -99, mirror: -99 };
  private overT = 0;
  private wrongT = 0;
  private pathT = 0;
  private stoppedT = 0;
  private cooldown = new Map<string, number>();

  constructor(private net: RoadNet, private traffic: NetTraffic) {}

  /** The driver looked somewhere this frame (head check or mirror glance). */
  observe(kind: "left" | "right" | "back" | "mirror") {
    this.lastLook[kind] = this.t;
  }

  /** A collision the car's physics reported. */
  collision(kind: string, impact: number) {
    if (impact < 1.5) return;
    const what = kind === "person" ? "a pedestrian" : kind === "car" ? "another vehicle" : "a wall or kerb";
    this.fault(kind === "person" || impact > 4 ? 3 : 2, "collision", `Collision with ${what}`, 4);
  }

  update(dt: number, c: CarState) {
    this.t += dt;
    for (const [k, v] of this.cooldown) if (v <= this.t) this.cooldown.delete(k);
    const speed = Math.abs(c.vf);

    // Indicator history: when did the current signal come on?
    if (c.indicator !== this.lastIndicator) {
      if (c.indicator) this.indOnSince[c.indicator] = this.t;
      this.lastIndicator = c.indicator;
    }

    const hit = this.net.locate(c.x, c.z, c.yaw, ALLOW_CAR);
    const onRoad = !!hit && Math.abs(hit.lat) < hit.lane.width / 2 + 0.3;

    // Mounting the footpath.
    const foot = this.net.locate(c.x, c.z, null, ALLOW_PED);
    const onPath = !!foot && foot.lane.kind === LaneKind.Footpath && Math.abs(foot.lat) < foot.lane.width / 2 - 0.2 && !onRoad;
    this.pathT = onPath && speed > 0.5 ? this.pathT + dt : 0;
    if (this.pathT > 0.3) this.fault(3, "position", "Mounted the footpath", 6);

    if (!hit) {
      this.limit = 0;
      return;
    }
    const lane = hit.lane;
    if (lane.kind === LaneKind.Road) {
      this.limit = Math.round((lane.speed * 3.6) / 10) * 10;
      const e = lane.edge >= 0 ? this.net.edges[lane.edge] : null;
      this.road = e && e.name !== 0xffff ? this.net.names[e.name] ?? "" : "";

      // Wrong side of the road: the best-matching lane points the other way.
      this.wrongT = hit.along < -0.5 && c.vf > 1 ? this.wrongT + dt : 0;
      if (this.wrongT > 2) this.fault(this.wrongT > 4 ? 3 : 2, "position", "Driving on the wrong side of the road", 8);

      // Speed against the posted limit (2 km/h of slack for the speedo).
      const lim = lane.speed;
      this.overT = speed > lim + 0.6 ? this.overT + dt : 0;
      if (this.overT > 2) {
        const pct = speed / lim - 1;
        this.fault(pct > 0.15 ? 3 : 2, "speed", `Speeding: ${Math.round(speed * 3.6)} in a ${this.limit} zone`, 12);
      }

      // Approaching a junction: remember the slowest speed near the line.
      if (lane.out.length) {
        const dist = lane.length - hit.s;
        if (!this.approach || this.approach.lane !== lane) this.approach = { lane, minSpeed: speed, dist };
        this.approach.dist = dist;
        if (dist < 12) this.approach.minSpeed = Math.min(this.approach.minSpeed, speed);
      }

      // Moving off from the kerb: look over your right shoulder (left in
      // left-hand traffic is the kerb, the blind spot is on the road side).
      if (speed < 0.2) this.stoppedT += dt;
      else {
        if (this.stoppedT > 5 && c.vf > 0.5 && (!this.approach || this.approach.dist > 15)) {
          if (this.t - this.lastLook.right > 6) this.fault(2, "observation", "Moving off: no check over your right shoulder", 10);
          if (c.indicator !== 1 && this.t - this.indOnSince[1] > 8) this.fault(1, "signals", "Moving off: no signal", 10);
        }
        this.stoppedT = 0;
      }
    } else if (lane.kind === LaneKind.Internal && this.approach) {
      // Just crossed the line into the junction: judge the approach.
      const from = this.approach;
      this.approach = null;
      const link = from.lane.out.map((k) => this.net.links[k]).find((k) => k.vias.includes(lane.id));
      if (link && c.vf > 0) this.judgeJunction(link, from, c);
    }
  }

  private judgeJunction(L: Link, from: { lane: Lane; minSpeed: number }, c: CarState) {
    const net = this.net;
    const e = from.lane.edge >= 0 ? net.edges[from.lane.edge] : null;
    let minor = L.state === "m" || L.state === "s";
    if (L.tl >= 0) {
      const st = net.signalState(L.tl, L.li, this.traffic.time);
      if (st === "r" || st === "u") this.fault(3, "traffic lights", "Entered the junction on a red light", 3);
      else if (st === "y" || st === "Y") {
        // Amber means stop unless stopping would be unsafe.
        const amberFor = 3 - net.signalRemaining(L.tl, L.li, this.traffic.time);
        if (amberFor > 1.2) this.fault(2, "traffic lights", "Went through on amber when you could have stopped", 3);
      }
      minor = st === "g";
    } else if (e && e.flags & EDGE_STOP) {
      if (from.minSpeed > 0.5) this.fault(3, "traffic signs", "Didn't stop at the STOP sign", 3);
      minor = true;
    } else if (e && e.flags & EDGE_GIVE_WAY) minor = true;

    if (minor && this.traffic.yieldConflict(L, 3)) this.fault(3, "right of way", "Failed to yield right of way", 3);
    if (this.traffic.pedInPath(L)) this.fault(3, "right of way", "Failed to yield to a pedestrian on the crossing", 3);

    // Signals for turns.
    const want = L.dir === "l" || L.dir === "L" ? -1 : L.dir === "r" || L.dir === "R" ? 1 : 0;
    const side = want === -1 ? "left" : "right";
    if (want) {
      if (c.indicator !== want && !c.hazards) this.fault(2, "signals", `No signal turning ${side}`, 3);
      else if (this.t - this.indOnSince[want] < 2) this.fault(1, "signals", `Signalled late turning ${side}`, 3);
      // Observation: in left-hand traffic, a left turn needs the left mirror or a head check for cyclists.
      if (want === -1 && this.t - Math.max(this.lastLook.left, this.lastLook.mirror) > 8) this.fault(2, "observation", "Turning left: no check of the left mirror or blind spot", 3);
    } else if (c.indicator && L.dir === "s" && this.t - this.indOnSince[c.indicator] > 3) {
      this.fault(1, "signals", "Misleading signal going straight on", 3);
    }
  }

  private fault(grade: 1 | 2 | 3, item: string, text: string, cooldown: number) {
    if (this.cooldown.has(text)) return;
    this.cooldown.set(text, this.t + cooldown);
    const f: Fault = { grade, item, text, at: this.t };
    this.faults.push(f);
    this.onFault(f);
  }

  /** RSA pass/fail so far. */
  verdict(): { pass: boolean; g1: number; g2: number; g3: number; reason: string } {
    const g1 = this.faults.filter((f) => f.grade === 1).length;
    const g2s = this.faults.filter((f) => f.grade === 2);
    const g3 = this.faults.filter((f) => f.grade === 3).length;
    const perItem = new Map<string, number>();
    for (const f of g2s) perItem.set(f.item, (perItem.get(f.item) ?? 0) + 1);
    const worst = Math.max(0, ...perItem.values());
    let reason = "";
    if (g3) reason = "a grade 3 fault";
    else if (worst >= 4) reason = "4 grade 2 faults on one item";
    else if (g2s.length >= 9) reason = "9 or more grade 2 faults";
    return { pass: !reason, g1, g2: g2s.length, g3, reason };
  }
}
