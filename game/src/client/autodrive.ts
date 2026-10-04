import type { Navigator } from "./nav";
import { mulberry32 } from "./props";
import { ALLOW_CAR, LaneKind, type Link, type RoadNet } from "./roadnet";
import type { NetTraffic } from "./trafficnet";

// Dev autodrive (?autodrive=happy|sad|idiot|tragedy): the player's own car,
// physics and all, driven by a robot along sat-nav routes, so a test or the
// local Claude can watch a drive and screenshot it without anyone at the
// wheel. Four drivers, the four test paths:
//
//   happy    a careful learner: limits, signals, give way, indicators, mirrors
//   sad      normal things going wrong: missed turns (reroute), a destination
//            with no road route, stuck behind a stopped car, stopping to park
//   idiot    deliberate faults: speeding, no indicators, red lights, ignoring
//            give way, wandering onto the kerb, R at speed. The examiner and
//            the physics must cope.
//   tragedy  the long haul: the farthest places and the map's edges, forever
//
// How it decides (research/21, Autoware's behaviour planner): each situation
// ahead (the limit, a bend, the car in front, a light, a give-way line,
// someone crossing, the destination) sets a stop point or a speed cap, and the
// lowest speed wins. Each cap has a reason, shown on screen, so you can see why
// it's doing what it does. Steering is pure pursuit on the route (Coulter
// 1992), the standard path tracker in self-driving stacks.

export type AutoMode = "happy" | "sad" | "idiot" | "tragedy";
export const AUTO_MODES: AutoMode[] = ["happy", "sad", "idiot", "tragedy"];

export interface AutoCar {
  x: number;
  z: number;
  yaw: number;
  /** Forward speed, m/s (negative reversing). */
  vf: number;
  indicator: number;
}

export interface AutoCommand {
  steer: number;
  throttle: number;
  brake: number;
  handbrake: boolean;
  selector: "P" | "R" | "N" | "D";
  parkBrake: boolean;
  /** Wanted indicator: -1 left, 0 off, 1 right. */
  indicator: number;
  glance: boolean;
  look: number;
}

export interface Destination {
  x: number;
  z: number;
  name: string;
}

interface Profile {
  /** Share of the limit it cruises at. */
  limit: number;
  /** Comfortable lateral acceleration in bends (m/s²). */
  lateral: number;
  /** Comfortable braking (m/s²). */
  brake: number;
  /** Pure-pursuit lookahead multiplier (more = cuts corners). */
  look: number;
  obeySignals: number;
  obeyGiveWay: number;
  indicate: boolean;
}

const PROFILES: Record<AutoMode, Profile> = {
  happy: { limit: 0.92, lateral: 2.2, brake: 2.5, look: 1, obeySignals: 1, obeyGiveWay: 1, indicate: true },
  sad: { limit: 0.9, lateral: 2.2, brake: 2.5, look: 1, obeySignals: 1, obeyGiveWay: 1, indicate: true },
  idiot: { limit: 1.4, lateral: 4.5, brake: 5, look: 1.7, obeySignals: 0.4, obeyGiveWay: 0.3, indicate: false },
  tragedy: { limit: 0.95, lateral: 2.5, brake: 2.5, look: 1, obeySignals: 1, obeyGiveWay: 1, indicate: true },
};

const WHEELBASE = 2.55;

export class AutoDriver {
  /** One line: what it's doing and why (shown on screen). */
  status = "starting";
  /** Notable events with the drive time, newest last (kept short). */
  events: string[] = [];
  stats = { time: 0, distance: 0, destinations: 0, reroutes: 0, unreachable: 0 };
  /** Called to set a route (main.ts wires this to its sat-nav so the HUD follows). */
  setDestination: (d: Destination) => boolean;

  private p: Profile;
  private rand: () => number;
  private lastPath: number[] | null = null;
  private links: { link: Link; s: number }[] = [];
  /** Per-junction decisions (ignore the light? the give-way?), rolled once per approach. */
  private decided = new Map<number, { signal: boolean; giveWay: boolean; stopDone: boolean; mirrored: boolean }>();
  private leaders = new Map<unknown, { x: number; z: number }>();
  private stoppedT = 0;
  private blockedT = 0;
  private parkT = 0;
  private reverseT = 0;
  private kerbT = 0;
  /** Sad path: driving past a turn on purpose; where it was really going. */
  private detour: { final: Destination } | null = null;
  private nextDetour = 60;
  private nextFault = 40;
  private lastX = NaN;
  private lastZ = NaN;
  private glanceT = 0;

  constructor(
    private net: RoadNet,
    private nav: Navigator,
    private traffic: NetTraffic | null,
    readonly mode: AutoMode,
    private places: Destination[],
    private bounds: { x: number; z: number },
    private maxSteer: number,
    seed = 1,
  ) {
    this.p = PROFILES[mode];
    this.rand = mulberry32(seed);
    this.setDestination = (d) => this.nav.route(this.lastX || 0, this.lastZ || 0, 0, d);
  }

  private log(msg: string) {
    const t = this.stats.time;
    const line = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")} ${msg}`;
    this.events.push(line);
    if (this.events.length > 40) this.events.shift();
    console.info(`[autodrive ${this.mode}] ${line}`);
  }

  /** The next place to drive to, by mode. */
  private pickDestination(car: AutoCar): Destination {
    const r = this.rand;
    if (this.mode === "tragedy") {
      // Alternate: the farthest named place, then a point near a map edge.
      if (this.stats.destinations % 2 === 0 && this.places.length) {
        let best = this.places[0], bd = -1;
        for (const p of this.places) {
          const d = Math.hypot(p.x - car.x, p.z - car.z);
          if (d > bd && Math.abs(p.x) < this.bounds.x - 50 && Math.abs(p.z) < this.bounds.z - 50) [best, bd] = [p, d];
        }
        return best;
      }
      const side = Math.floor(r() * 4);
      const t = r() * 1.6 - 0.8;
      const x = side < 2 ? (side ? 1 : -1) * (this.bounds.x - 60) : t * this.bounds.x;
      const z = side >= 2 ? (side === 3 ? 1 : -1) * (this.bounds.z - 60) : t * this.bounds.z;
      return { x, z, name: "the edge of the map" };
    }
    const near = this.places.filter((p) => {
      const d = Math.hypot(p.x - car.x, p.z - car.z);
      return d > 300 && d < 1500;
    });
    const list = near.length ? near : this.places;
    return list[Math.floor(r() * list.length)] ?? { x: 0, z: 0, name: "the middle" };
  }

  step(dt: number, car: AutoCar): AutoCommand {
    const nav = this.nav;
    const p = this.p;
    if (!Number.isNaN(this.lastX)) this.stats.distance += Math.hypot(car.x - this.lastX, car.z - this.lastZ);
    this.lastX = car.x;
    this.lastZ = car.z;
    this.stats.time += dt;
    const v = car.vf;
    const out: AutoCommand = { steer: 0, throttle: 0, brake: 0, handbrake: false, selector: "D", parkBrake: false, indicator: car.indicator, glance: false, look: 0 };

    // ---- where to: a route, or a new one on arrival ----
    if (nav.arrived && this.mode === "sad" && this.parkT === 0 && !this.detour) {
      this.parkT = 6;
      this.log(`parking at ${nav.dest?.name} for a moment`);
    }
    if (this.parkT > 0) {
      this.parkT -= dt;
      out.brake = 0.6;
      out.selector = Math.abs(v) < 0.3 ? "P" : "D";
      out.parkBrake = Math.abs(v) < 0.3;
      out.indicator = 0;
      this.status = "parked";
      if (this.parkT <= 0) {
        this.parkT = -1; // done; pick the next place below
        out.glance = true;
      } else return out;
    }
    // The route's last point is the place itself, often off the road: stop at the road's end.
    const roadEnd = nav.pathCum.length > 1 ? nav.pathCum[nav.pathCum.length - 2] : nav.total;
    const here0 = nav.progress;
    if (nav.dest && !nav.arrived && here0 > roadEnd - 8 && Math.abs(v) < 0.5) nav.arrived = true;
    if (nav.arrived && this.detour) {
      // Past the missed turn: back to where it was going.
      const final = this.detour.final;
      this.detour = null;
      if (this.setDestination(final)) this.log(`rerouting to ${final.name}`);
    }
    if (!nav.dest || nav.arrived || !nav.path.length) {
      if (nav.arrived) {
        this.stats.destinations++;
        this.log(`arrived at ${nav.dest?.name}`);
        nav.clear(); // done with it: the picks below start from no route
      }
      this.parkT = 0;
      if (this.mode === "sad" && this.stats.destinations % 3 === 0) this.tryUnreachable();
      for (let tries = 0; tries < 4 && !nav.path.length; tries++) {
        const d = this.pickDestination(car);
        if (this.setDestination(d)) {
          this.log(`driving to ${d.name} (${(nav.total / 1000).toFixed(1)} km)`);
          break;
        }
        this.stats.unreachable++;
        this.stats.destinations++;
        this.nav.clear(); // a failed route leaves the old one behind
        this.log(`no road route to ${d.name}; picking another`);
      }
      if (!nav.path.length) {
        this.status = "no route anywhere";
        out.brake = 1;
        return out;
      }
    }
    if (nav.path !== this.lastPath) {
      if (this.lastPath && nav.dest) {
        this.stats.reroutes++;
        this.log("rerouted");
      }
      this.lastPath = nav.path;
      this.links = [];
      for (const st of nav.steps) if (st.link) this.links.push({ link: st.link, s: nav.pathAt(st.link) });
      this.decided.clear();
    }
    const s0 = nav.progress;

    // ---- steering: pure pursuit ----
    const look = Math.max(5, Math.min(22, 4 + Math.abs(v) * 0.6)) * p.look;
    const [tx, tz] = pointAt(nav.path, nav.pathCum, Math.min(s0 + look, roadEnd));
    const dx = tx - car.x, dz = tz - car.z;
    const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
    // Angle to the target: + to the right of travel (x east, z south: right of (fx, fz) is (-fz, fx)).
    const alpha = Math.atan2(dx * -fz + dz * fx, dx * fx + dz * fz);
    const delta = Math.atan((2 * WHEELBASE * Math.sin(alpha)) / Math.max(1, Math.hypot(dx, dz)));
    out.steer = clamp(delta / this.maxSteer, -1, 1);

    // ---- speed: every situation caps it; the lowest wins ----
    const here = this.net.locate(car.x, car.z, car.yaw, ALLOW_CAR);
    const limit = Math.max(4, here?.lane.speed ?? 8.3);
    let cap = limit * p.limit, why = `limit ${Math.round(limit * 3.6)} km/h`;
    const capTo = (vmax: number, reason: string) => {
      if (vmax < cap) [cap, why] = [vmax, reason];
    };
    // Stop points also give the deceleration they need (v²/2d), fed forward to
    // the brake like an ACC's stop-and-go: chasing the speed cap alone brakes
    // too late and crosses the line.
    let aNeed = 0;
    const need = (d: number, vTo = 0) => {
      if (v > vTo) aNeed = Math.min(aNeed, -(v * v - vTo * vTo) / (2 * Math.max(0.1, d)));
    };
    const stopAt = (s: number, reason: string) => {
      capTo(Math.sqrt(2 * p.brake * Math.max(0, s - s0 - 1.5)), reason);
      need(s - s0 - 1.5);
    };

    // Bends ahead, within braking distance.
    const horizon = (v * v) / (2 * p.brake) + 20;
    for (let d = 4; d < horizon; d += 4) {
      const k = curvature(nav.path, nav.pathCum, s0 + d);
      if (k > 0.002) {
        const vb = Math.sqrt(p.lateral / k);
        capTo(Math.sqrt(vb * vb + 2 * p.brake * Math.max(0, d - 4)), "bend ahead");
      }
    }

    // The car in front, on the route ahead.
    const seen = new Set<unknown>();
    for (const c of this.traffic?.nearCars(car.x, car.z, 70) ?? []) {
      seen.add(c.key);
      const prev = this.leaders.get(c.key);
      this.leaders.set(c.key, { x: c.x, z: c.z });
      const vx = prev ? Math.hypot(c.x - prev.x, c.z - prev.z) / Math.max(dt, 1e-3) : 0;
      const on = project(nav.path, nav.pathCum, c.x, c.z, s0, s0 + 70);
      if (!on || on.lat > 1.8 || on.s <= s0) continue;
      const gap = on.s - s0 - c.len / 2 - 2.4;
      capTo(Math.sqrt(vx * vx + 2 * p.brake * Math.max(0, gap - 2 - 1.2 * Math.abs(v))), "car in front");
      need(gap - 2, vx);
    }
    for (const k of this.leaders.keys()) if (!seen.has(k)) this.leaders.delete(k);

    // Junctions on the route: lights, give way, stop signs, people crossing.
    for (const { link, s } of this.links) {
      const dist = s - s0;
      if (dist < -2) continue;
      if (dist > 90) break;
      const id = link.id;
      let dec = this.decided.get(id);
      if (!dec) this.decided.set(id, (dec = { signal: this.rand() < p.obeySignals, giveWay: this.rand() < p.obeyGiveWay, stopDone: false, mirrored: false }));
      if (link.tl >= 0 && this.traffic) {
        const st = this.net.signalState(link.tl, link.li, this.traffic.time);
        const red = st === "r" || st === "R" || st === "u";
        const amber = st === "y" || st === "Y";
        const canStop = dist > (v * v) / (2 * 3.5) + 1;
        if ((red || (amber && canStop)) && dist > -0.5) {
          if (dec.signal) stopAt(s, red ? "red light" : "amber: stopping");
          else if (dist < 15 && Math.abs(v) > 3) this.status = "running the red";
        }
      }
      if (!this.traffic || dist < 0) continue;
      const minor = link.state === "m" || link.state === "=" || link.state === "s" || link.state === "w";
      if (link.state === "s" && !dec.stopDone && dec.giveWay) {
        stopAt(s, "stop sign");
        if (dist < 3 && Math.abs(v) < 0.2) this.stoppedT += dt;
        if (this.stoppedT > 1) [dec.stopDone, this.stoppedT] = [true, 0];
      }
      // Past the point it can still stop comfortably, it commits (no stopping in the junction).
      const committed = dist < (v * v) / (2 * p.brake * 1.6);
      if (minor && dec.giveWay && !committed && this.traffic.yieldConflict(link, 5)) stopAt(s, "giving way");
      // Careful drivers come up to a give-way slowly enough to look and still stop.
      if (minor && dec.giveWay && p.obeyGiveWay === 1 && dist < 15) capTo(4.2, "give way: slowing to look");
      // People: stop if it still can, even hard (they come first).
      if (dist > (v * v) / (2 * 6) && this.traffic.pedInPath(link)) stopAt(s, "someone crossing");
    }
    // The destination.
    if (nav.dest && !this.detour) stopAt(roadEnd, `arriving at ${nav.dest.name}`);

    // ---- mode behaviour ----
    const next = this.links.find((l) => l.s - s0 > -2) ?? null;
    if (this.mode === "sad") this.sadStep(dt, v, next);
    if (this.mode === "idiot") this.idiotStep(dt, out, v);

    // ---- indicators and mirrors (the careful drivers) ----
    // Mirror, signal, manoeuvre: signal for the next junction only (an earlier
    // one would mislead), from 60 m; mirrors when signalling and again just
    // before the turn.
    if (p.indicate) {
      const want = next && next.s - s0 < 60 ? turnOf(next.link) : 0;
      if (want !== 0 && car.indicator !== want) this.glanceT = 0.6;
      if (want !== 0 && next) {
        const dec = this.decided.get(next.link.id);
        if (dec && !dec.mirrored && next.s - s0 < 15) [dec.mirrored, this.glanceT] = [true, 0.6];
      }
      out.indicator = want;
    } else out.indicator = 0;
    if (this.glanceT > 0) {
      this.glanceT -= dt;
      out.glance = true;
    }

    // ---- pedals: track the capped speed ----
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      out.selector = "R";
    }
    // Track the cap; once a stop needs real braking, brake for what it needs.
    let aWant = clamp((cap - v) / 0.9, -8, 3);
    if (aNeed < -0.25 * p.brake) aWant = Math.min(aWant, aNeed * 1.15);
    if (cap < 0.3 && Math.abs(v) < 0.6) {
      out.brake = 0.5; // hold it still
    } else if (aWant >= 0) {
      out.throttle = clamp(0.12 + aWant / 3.2, 0, 1);
    } else {
      out.brake = clamp(-aWant / 8, 0, 1); // full pedal is about 8 m/s² on dry tarmac
    }
    // Blocked for long (a broken-down car, a jam): find another way.
    if (cap < 0.5 && why === "car in front") this.blockedT += dt;
    else this.blockedT = 0;
    if (this.blockedT > 60) {
      this.blockedT = 0;
      this.log("stuck behind a stopped car for a minute; trying somewhere else");
      nav.clear();
    }
    if (this.status !== "running the red" || Math.abs(v) < 3) this.status = `${why} · ${Math.round(Math.abs(v) * 3.6)} km/h`;
    if (this.detour) this.status = `missed a turn on purpose · ${this.status}`;
    return out;
  }

  /**
   * Sad path: a street the router can't reach (a car park with no way in, a
   * one-way trap). Tries random streets until the router says no; it must
   * say so, not hang or drive off somewhere else.
   */
  private tryUnreachable() {
    const lanes = this.net.lanes.filter((l) => l.kind === LaneKind.Road && l.allow & ALLOW_CAR && l.junction < 0);
    for (let k = 0; k < 20; k++) {
      const l = lanes[Math.floor(this.rand() * lanes.length)];
      const mid = Math.floor(l.pts.length / 4) * 2;
      const d = { x: l.pts[mid], z: l.pts[mid + 1], name: "a street with no way in" };
      if (!this.setDestination(d)) {
        this.stats.unreachable++;
        this.stats.destinations++;
        this.nav.clear(); // a failed route leaves the old one behind
        this.log(`no road route to ${d.name} at ${Math.round(d.x)}, ${Math.round(d.z)}; picking another`);
        return;
      }
    }
    this.log("every street tried was reachable");
    this.nav.clear();
  }

  /**
   * Sad path: now and then miss a turn on purpose (carry straight on), so the
   * sat-nav has to reroute. Done as a short route straight through the
   * junction, so lights and give-way still apply.
   */
  private sadStep(dt: number, v: number, next: { link: Link; s: number } | null) {
    this.nextDetour -= dt;
    if (this.detour || this.nextDetour > 0 || Math.abs(v) < 3 || !next || !this.nav.dest) return;
    const dist = next.s - this.nav.progress;
    if (dist > 70 || dist < 20 || !turnOf(next.link)) return;
    const from = this.net.lanes[next.link.from];
    const straight = from.out.map((k) => this.net.links[k]).find((L) => L.dir === "s" && this.net.lanes[L.to].kind === LaneKind.Road);
    if (!straight) return;
    const to = this.net.lanes[straight.to];
    const at = { x: 0, z: 0, dx: 0, dz: 0 };
    this.net.at(to, Math.min(to.length - 1, 50), at);
    const final = this.nav.dest;
    if (!this.setDestination({ x: at.x, z: at.z, name: "straight on (missed turn)" })) return;
    this.detour = { final };
    this.nextDetour = 120 + this.rand() * 120;
    this.log(`missing the ${turnOf(next.link) < 0 ? "left" : "right"} turn on purpose`);
  }

  /** Idiot path: weave onto the kerb now and then, and once in a while select R at speed. */
  private idiotStep(dt: number, out: AutoCommand, v: number) {
    this.nextFault -= dt;
    if (this.kerbT > 0) {
      this.kerbT -= dt;
      out.steer = clamp(out.steer - 0.25, -1, 1); // drift toward the kerb (left in Ireland)
    }
    if (this.nextFault > 0) return;
    this.nextFault = 45 + this.rand() * 60;
    if (v > 8 && this.rand() < 0.4) {
      this.reverseT = 1;
      this.log(`selected R at ${Math.round(v * 3.6)} km/h`);
    } else {
      this.kerbT = 1.2;
      this.log("wandering onto the kerb");
    }
  }

  /** Everything a screenshot needs alongside it. */
  snapshot(car: AutoCar) {
    return {
      mode: this.mode,
      status: this.status,
      x: Math.round(car.x * 10) / 10,
      z: Math.round(car.z * 10) / 10,
      kmh: Math.round(car.vf * 3.6),
      destination: this.nav.dest?.name ?? null,
      toGo: Math.round(Math.max(0, this.nav.total - this.nav.progress)),
      stats: { ...this.stats, time: Math.round(this.stats.time), distance: Math.round(this.stats.distance) },
      events: this.events.slice(-8),
    };
  }
}

/** The indicator a link needs: -1 left, 1 right, 0 straight (or a U-turn, signalled separately). */
function turnOf(L: Link): number {
  return L.dir === "l" || L.dir === "L" ? -1 : L.dir === "r" || L.dir === "R" ? 1 : 0;
}

/** Point at distance s along a polyline (clamped to its ends). */
export function pointAt(pts: number[], cum: number[], s: number): [number, number] {
  if (pts.length < 4) return [pts[0] ?? 0, pts[1] ?? 0];
  if (s <= 0) return [pts[0], pts[1]];
  let lo = 0, hi = cum.length - 1;
  if (s >= cum[hi]) return [pts[hi * 2], pts[hi * 2 + 1]];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const t = (s - cum[lo]) / (cum[hi] - cum[lo] || 1);
  return [pts[lo * 2] + (pts[hi * 2] - pts[lo * 2]) * t, pts[lo * 2 + 1] + (pts[hi * 2 + 1] - pts[lo * 2 + 1]) * t];
}

/** Curvature (1/m) of a polyline around distance s, from three points 4 m apart. */
function curvature(pts: number[], cum: number[], s: number): number {
  const [ax, az] = pointAt(pts, cum, s - 4), [bx, bz] = pointAt(pts, cum, s), [cx, cz] = pointAt(pts, cum, s + 4);
  const abx = bx - ax, abz = bz - az, bcx = cx - bx, bcz = cz - bz;
  const cross = Math.abs(abx * bcz - abz * bcx);
  const la = Math.hypot(abx, abz), lb = Math.hypot(bcx, bcz), lc = Math.hypot(cx - ax, cz - az);
  return la * lb * lc > 1e-6 ? (2 * cross) / (la * lb * lc) : 0;
}

/** Nearest point on a polyline between distances s0 and s1: its distance along, and how far off it (x, z) is. */
export function project(pts: number[], cum: number[], x: number, z: number, s0: number, s1: number): { s: number; lat: number } | null {
  let best: { s: number; lat: number } | null = null;
  for (let k = 0; k + 1 < cum.length; k++) {
    if (cum[k + 1] < s0 || cum[k] > s1) continue;
    const ax = pts[k * 2], az = pts[k * 2 + 1], bx = pts[k * 2 + 2], bz = pts[k * 2 + 3];
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz || 1;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1);
    const lat = Math.hypot(x - ax - dx * t, z - az - dz * t);
    if (!best || lat < best.lat) best = { s: cum[k] + Math.sqrt(l2) * t, lat };
  }
  return best;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
