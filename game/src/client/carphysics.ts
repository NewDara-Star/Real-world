import RAPIER from "@dimforge/rapier3d-compat";

// Car physics the way driving simulators do it (research/08-vehicle-physics.md):
// a rigid-body chassis in a physics engine (Rapier) with raycast spring-damper
// suspension at each wheel, Pacejka Magic Formula tyres with combined slip and
// relaxation-length slip lag, a dual-clutch automatic, brakes, and the front
// tyres' self-aligning moment for force feedback. Collisions with buildings
// and traffic come from the engine.
//
// Frames: world x east, y up, z south. Car local: +z forward, +x LEFT, +y up.

export interface CarSpec {
  mass: number;
  /** Distance from the centre of gravity forward to the front axle / back to the rear axle (m). */
  cgToFront: number;
  cgToRear: number;
  track: number;
  cgHeight: number;
  inertia: [number, number, number]; // roll (x), yaw (y), pitch (z), kg m²
  wheelRadius: number;
  wheelInertia: number;
  springRate: [number, number]; // front, rear (N/m)
  damping: [number, number]; // N s/m
  suspensionTravel: number; // maximum spring length (m)
  antiRoll: [number, number]; // N/m of compression difference
  maxSteer: number; // road-wheel angle at full lock (rad)
  mu: number; // tyre friction coefficient (dry)
  brakeTorque: [number, number]; // per wheel at full pedal, front/rear (N m)
  handbrakeTorque: number; // per rear wheel
  ratios: number[]; // forward gears
  reverse: number;
  finalDrive: number;
  idleRpm: number;
  redline: number;
  /** Drag area Cd·A (m²) and rolling resistance coefficient. */
  cdA: number;
  crr: number;
  /** Collision box half extents (x, y, z) around the CG. */
  half: [number, number, number];
}

/** A typical Irish automatic test car (VW Polo 1.0 TSI DSG class). */
export const HATCH_AUTO: CarSpec = {
  mass: 1210,
  cgToFront: 1.05,
  cgToRear: 1.5,
  track: 1.5,
  cgHeight: 0.55,
  inertia: [480, 1900, 1750],
  wheelRadius: 0.31,
  wheelInertia: 1.2,
  springRate: [24000, 22000],
  damping: [1800, 1600],
  suspensionTravel: 0.36,
  antiRoll: [9000, 5000],
  maxSteer: 0.56,
  mu: 1.0,
  brakeTorque: [1800, 650],
  handbrakeTorque: 1400,
  ratios: [3.765, 2.273, 1.531, 1.122, 0.893, 0.744, 0.634],
  reverse: 3.99,
  finalDrive: 4.06,
  idleRpm: 800,
  redline: 6200,
  cdA: 0.7,
  crr: 0.012,
  half: [0.86, 0.45, 2.0],
};

/** Pacejka Magic Formula, normalised (peak about 1). */
function magic(s: number, B: number, C: number, E: number): number {
  const bs = B * s;
  return Math.sin(C * Math.atan(bs - E * (bs - Math.atan(bs))));
}

/** 1.0 TSI 110 torque curve (N m). */
function engineTorque(rpm: number): number {
  if (rpm < 1000) return 110;
  if (rpm < 2000) return 110 + (rpm - 1000) * 0.09;
  if (rpm <= 3500) return 200;
  if (rpm >= 6300) return 0;
  return Math.min(200, 81000 / ((rpm * Math.PI) / 30)); // power-limited
}

interface Wheel {
  local: { x: number; y: number; z: number }; // suspension mount, car frame
  front: boolean;
  driven: boolean;
  omega: number; // spin (rad/s), + rolling forward
  len: number; // current spring length
  kappa: number; // lagged slip ratio
  alpha: number; // lagged slip angle
  load: number;
  fy: number;
  contact: boolean;
  ground: number; // ground height under the wheel (refreshed per frame)
}

export interface PhysicsInput {
  throttle: number;
  brake: number;
  handbrake: boolean;
  /** Road-wheel steer: -1 left .. +1 right (fraction of full lock). */
  steer: number;
  selector: "P" | "R" | "N" | "D";
  parkBrake: boolean;
}

export type GroundFn = (x: number, z: number) => number;

/** Physics step (s): 240 Hz, in the range sims use (AC 333, Forza 360). */
const STEP = 1 / 240;

let ready: Promise<void> | null = null;
let loaded = false;
/** Load the physics engine (WebAssembly). Safe to call more than once. */
export function initPhysics(): Promise<void> {
  ready ??= RAPIER.init().then(() => {
    loaded = true;
  });
  return ready;
}
export const physicsReady = () => loaded;

export class CarPhysics {
  world: RAPIER.World;
  body: RAPIER.RigidBody;
  wheels: Wheel[];
  /** Spring length at rest per wheel, for drawing suspension travel. */
  staticLen: number[];
  gear = 1;
  rpm = 800;
  /** Rack torque from the front tyres (N m at the steering wheel, + turns the wheel right). */
  steerTorque = 0;
  /** Biggest tyre slip this step (0..1+), for squeal. */
  slip = 0;
  /** Speed change from a collision this frame (m/s). */
  impact = 0;
  /** Traction control torque factor (0..1) and whether ABS is working this frame, for the dash lamps. */
  tcs = 1;
  absActive = false;
  private shiftTimer = 0;
  private acc = 0;
  private prevT = { x: 0, y: 0, z: 0 };
  private prevQ = { x: 0, y: 0, z: 0, w: 1 };
  private hasPrev = false;
  private walls = new Map<number, RAPIER.Collider[]>();
  private traffic = new Map<unknown, RAPIER.RigidBody>();
  private bGrid = new Map<number, number[]>();
  private bBoxes: Float32Array;
  private lastStream = { x: 1e9, z: 1e9 };

  constructor(readonly spec: CarSpec, x: number, z: number, yaw: number, private buildings: Float32Array[]) {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const s = spec;
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, s.cgHeight + 0.05, z)
      .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
      .setAdditionalMassProperties(s.mass, { x: 0, y: 0, z: 0 }, { x: s.inertia[0], y: s.inertia[1], z: s.inertia[2] }, { x: 0, y: 0, z: 0, w: 1 })
      .setCanSleep(false)
      .setCcdEnabled(true);
    this.body = this.world.createRigidBody(desc);
    // Body shell: mass comes from the explicit properties above, so density 0.
    const col = RAPIER.ColliderDesc.cuboid(s.half[0], s.half[1], s.half[2]).setTranslation(0, 0.15, 0.2).setDensity(0).setFriction(0.3).setRestitution(0.1);
    this.world.createCollider(col, this.body);

    const r = s.wheelRadius;
    // Mount the springs so the static ride height puts the CG at cgHeight.
    const mountY = (front: boolean) => {
      const load = (s.mass * 9.81 * (front ? s.cgToRear : s.cgToFront)) / (s.cgToFront + s.cgToRear) / 2;
      const k = front ? s.springRate[0] : s.springRate[1];
      const staticLen = s.suspensionTravel - load / k;
      return -s.cgHeight + r + staticLen;
    };
    this.wheels = [
      [s.track / 2, s.cgToFront, true],
      [-s.track / 2, s.cgToFront, true],
      [s.track / 2, -s.cgToRear, false],
      [-s.track / 2, -s.cgToRear, false],
    ].map(([wx, wz, front]) => ({
      local: { x: wx as number, y: mountY(front as boolean), z: wz as number },
      front: front as boolean,
      driven: front as boolean, // front-wheel drive
      omega: 0,
      len: s.suspensionTravel,
      kappa: 0,
      alpha: 0,
      load: 0,
      fy: 0,
      contact: false,
      ground: 0.03,
    }));

    this.staticLen = this.wheels.map((w) => {
      const load = (s.mass * 9.81 * (w.front ? s.cgToRear : s.cgToFront)) / (s.cgToFront + s.cgToRear) / 2;
      return s.suspensionTravel - load / (w.front ? s.springRate[0] : s.springRate[1]);
    });

    // Building footprints on a 50 m grid for streaming walls in and out.
    this.bBoxes = new Float32Array(buildings.length * 4);
    buildings.forEach((p, i) => {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (let k = 0; k < p.length; k += 2) {
        x0 = Math.min(x0, p[k]);
        x1 = Math.max(x1, p[k]);
        z0 = Math.min(z0, p[k + 1]);
        z1 = Math.max(z1, p[k + 1]);
      }
      this.bBoxes.set([x0, z0, x1, z1], i * 4);
      const key = Math.floor((x0 + x1) / 100) * 10000 + Math.floor((z0 + z1) / 100);
      let cell = this.bGrid.get(key);
      if (!cell) this.bGrid.set(key, (cell = []));
      cell.push(i);
    });
  }

  dispose() {
    this.world.free();
  }

  /** Walls around the edge of the baked map. */
  addBounds(hx: number, hz: number) {
    for (const [x, z, ex, ez] of [[hx, 0, 1, hz], [-hx, 0, 1, hz], [0, hz, hx, 1], [0, -hz, hx, 1]]) {
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(ex, 4, ez).setTranslation(x, 4, z));
    }
  }

  /** Put the car back on its wheels at a spot, at rest (after a roll, or a teleport). */
  reset(x: number, z: number, yaw: number, ground = 0.03) {
    const b = this.body;
    b.setTranslation({ x, y: ground + this.spec.cgHeight + 0.05, z }, true);
    b.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    b.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    for (const w of this.wheels) w.omega = w.kappa = w.alpha = 0;
    this.lastStream = { x: 1e9, z: 1e9 };
  }

  /** Car-frame up vector in the world (y < 0.3 means it's on its side or roof). */
  get upY() {
    const q = this.body.rotation();
    return 1 - 2 * (q.x * q.x + q.z * q.z);
  }

  private savePrev() {
    const t = this.body.translation(), q = this.body.rotation();
    this.prevT = { x: t.x, y: t.y, z: t.z };
    this.prevQ = { x: q.x, y: q.y, z: q.z, w: q.w };
    this.hasPrev = true;
  }

  /**
   * Pose to draw: between the last two physics steps by the time left over in
   * the accumulator, so motion is smooth at any frame rate.
   */
  renderPose() {
    const t = this.body.translation(), q = this.body.rotation();
    if (!this.hasPrev) return { t, q };
    const a = Math.min(1, this.acc / STEP), p = this.prevT, pq = this.prevQ;
    const pos = { x: p.x + (t.x - p.x) * a, y: p.y + (t.y - p.y) * a, z: p.z + (t.z - p.z) * a };
    // Normalised lerp is fine for the tiny rotation between two 240 Hz steps.
    const sgn = pq.x * q.x + pq.y * q.y + pq.z * q.z + pq.w * q.w < 0 ? -1 : 1;
    const r = { x: pq.x + (q.x * sgn - pq.x) * a, y: pq.y + (q.y * sgn - pq.y) * a, z: pq.z + (q.z * sgn - pq.z) * a, w: pq.w + (q.w * sgn - pq.w) * a };
    const n = Math.hypot(r.x, r.y, r.z, r.w) || 1;
    return { t: pos, q: { x: r.x / n, y: r.y / n, z: r.z / n, w: r.w / n } };
  }

  /** World point from a point in the car's frame (relative to the centre of gravity). */
  toWorld(l: { x: number; y: number; z: number }) {
    const q = this.body.rotation(), t = this.body.translation();
    return rotate(q, l, t);
  }

  // ------------------------------------------------------------ queries --

  get position() {
    return this.body.translation();
  }
  get yaw() {
    const q = this.body.rotation();
    // Heading of the car's +z axis in the ground plane.
    const fx = 2 * (q.x * q.z + q.w * q.y), fz = 1 - 2 * (q.x * q.x + q.y * q.y);
    return Math.atan2(fx, fz);
  }
  /** Velocity in the car's frame: forward, and toward the car's right. */
  localVelocity() {
    const v = this.body.linvel();
    const yaw = this.yaw;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    return { vf: v.x * fx + v.z * fz, vr: v.x * -fz + v.z * fx, yawRate: this.body.angvel().y };
  }

  // ---------------------------------------------------------- the world --

  /** Keep walls of nearby buildings as static colliders; drop far ones. */
  streamWalls() {
    const p = this.body.translation();
    if (Math.hypot(p.x - this.lastStream.x, p.z - this.lastStream.z) < 15) return;
    this.lastStream = { x: p.x, z: p.z };
    const near = new Set<number>();
    const cx = Math.floor(p.x / 50), cz = Math.floor(p.z / 50);
    for (let gx = cx - 2; gx <= cx + 2; gx++) {
      for (let gz = cz - 2; gz <= cz + 2; gz++) {
        for (const i of this.bGrid.get(gx * 10000 + gz) ?? []) {
          const b = this.bBoxes;
          const dx = Math.max(b[i * 4] - p.x, 0, p.x - b[i * 4 + 2]);
          const dz = Math.max(b[i * 4 + 1] - p.z, 0, p.z - b[i * 4 + 3]);
          if (dx * dx + dz * dz < 90 * 90) near.add(i);
        }
      }
    }
    for (const [i, cols] of this.walls) {
      if (near.has(i)) continue;
      const b = this.bBoxes;
      const dx = Math.max(b[i * 4] - p.x, 0, p.x - b[i * 4 + 2]);
      const dz = Math.max(b[i * 4 + 1] - p.z, 0, p.z - b[i * 4 + 3]);
      if (dx * dx + dz * dz < 140 * 140) continue;
      for (const c of cols) this.world.removeCollider(c, false);
      this.walls.delete(i);
    }
    for (const i of near) {
      if (this.walls.has(i)) continue;
      const pts = this.buildings[i];
      const n = pts.length / 2;
      const cols: RAPIER.Collider[] = [];
      for (let k = 0; k < n; k++) {
        const ax = pts[k * 2], az = pts[k * 2 + 1];
        const bx = pts[((k + 1) % n) * 2], bz = pts[((k + 1) % n) * 2 + 1];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.2) continue;
        const ang = Math.atan2(bx - ax, bz - az);
        // A 30 cm thick wall slab, 6 m tall, along the edge.
        const d = RAPIER.ColliderDesc.cuboid(0.15, 3, len / 2 + 0.1)
          .setTranslation((ax + bx) / 2, 3, (az + bz) / 2)
          .setRotation({ x: 0, y: Math.sin(ang / 2), z: 0, w: Math.cos(ang / 2) })
          .setFriction(0.4)
          .setRestitution(0.05);
        cols.push(this.world.createCollider(d));
      }
      this.walls.set(i, cols);
    }
  }

  /** Mirror AI vehicles near the player as kinematic boxes the car can hit. */
  syncTraffic(cars: { key: unknown; x: number; z: number; yaw: number; len: number; w: number }[]) {
    const seen = new Set<unknown>();
    for (const c of cars) {
      seen.add(c.key);
      let b = this.traffic.get(c.key);
      const rot = { x: 0, y: Math.sin(c.yaw / 2), z: 0, w: Math.cos(c.yaw / 2) };
      if (!b) {
        b = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(c.x, 0.8, c.z).setRotation(rot));
        this.world.createCollider(RAPIER.ColliderDesc.cuboid(c.w / 2, 0.75, c.len / 2).setFriction(0.3).setRestitution(0.1), b);
        this.traffic.set(c.key, b);
      }
      b.setNextKinematicTranslation({ x: c.x, y: 0.8, z: c.z });
      b.setNextKinematicRotation(rot);
    }
    for (const [k, b] of this.traffic) {
      if (seen.has(k)) continue;
      this.world.removeRigidBody(b);
      this.traffic.delete(k);
    }
  }

  // ---------------------------------------------------------- simulate --

  /** Advance dt seconds in fixed sub-steps; ground(x, z) gives the surface height. */
  step(dt: number, inp: PhysicsInput, ground: GroundFn) {
    // Ground under each wheel, once per frame (it's a lookup into the road network).
    for (const w of this.wheels) {
      const p = this.toWorld(w.local);
      w.ground = ground(p.x, p.z);
    }
    const v0 = this.body.linvel();
    // Fixed 240 Hz steps with an accumulator, as sims do: the same step size
    // every time, whatever the frame rate. A long hitch is dropped rather than
    // replayed in a burst; the leftover fraction interpolates the drawn pose.
    this.acc = Math.min(this.acc + dt, 0.1);
    const steps = Math.floor(this.acc / STEP);
    this.acc -= steps * STEP;
    this.world.timestep = STEP;
    this.slip = 0;
    this.absActive = false;
    let torque = 0;
    for (let i = 0; i < steps; i++) {
      if (i === steps - 1) this.savePrev();
      this.substep(STEP, inp);
      torque += this.steerTorque;
      this.world.step();
    }
    // Force feedback gets the frame's average, not the last sub-step's value.
    if (steps) this.steerTorque = torque / steps;
    const v1 = this.body.linvel();
    // A collision shows up as a sudden velocity change no tyre could produce.
    const dv = Math.hypot(v1.x - v0.x, v1.z - v0.z);
    this.impact = dv > 9.81 * 1.6 * Math.max(dt, STEP) + 0.8 ? dv : 0;
    this.automatic(dt, inp);
  }

  private substep(h: number, inp: PhysicsInput) {
    const s = this.spec;
    const body = this.body;
    const q = body.rotation(), t = body.translation();
    const v = body.linvel(), w = body.angvel();
    const up = rotate(q, { x: 0, y: 1, z: 0 });
    const steerAngle = inp.steer * s.maxSteer; // + is right
    const r = s.wheelRadius;

    // Drive torque at the front wheels from the gearbox (open differential: equal split).
    const ratio = this.currentRatio(inp.selector);
    let driveTorque = 0;
    if (ratio !== 0) {
      // Torque dips briefly while the clutches hand over during a shift.
      const handover = this.shiftTimer > 0.2 ? 0.4 : 1;
      const tq = engineTorque(this.rpm) * inp.throttle * this.tcs * handover;
      driveTorque = (tq * ratio * s.finalDrive * 0.92) / 2;
      // Creep: a dual-clutch box slips its clutch to roll the car at walking pace.
      const vf = this.localVelocity().vf * Math.sign(ratio);
      if (inp.throttle < 0.05 && inp.brake < 0.05 && vf < 1.8) driveTorque += Math.sign(ratio) * 110 * (1 - Math.max(0, vf) / 1.8);
      // Engine braking off throttle.
      if (inp.throttle < 0.05 && vf > 2) driveTorque -= Math.sign(ratio) * 18 * Math.abs(ratio) * s.finalDrive / 2 * (this.rpm / 3000);
    }

    let rackTorque = 0;
    const comp: number[] = [];
    for (const wh of this.wheels) {
      const mount = rotate(q, wh.local, t);
      // Spring length along the car's up axis to the ground.
      const dist = (mount.y - wh.ground) / Math.max(0.5, up.y);
      wh.len = Math.min(s.suspensionTravel, dist - r);
      wh.contact = dist - r < s.suspensionTravel;
      comp.push(wh.contact ? s.suspensionTravel - wh.len : 0);
    }
    // Anti-roll bars: extra load on the more compressed side.
    const arb = [s.antiRoll[0] * (comp[0] - comp[1]), s.antiRoll[1] * (comp[2] - comp[3])];

    this.wheels.forEach((wh, i) => {
      const front = wh.front;
      const k = front ? s.springRate[0] : s.springRate[1];
      const c = front ? s.damping[0] : s.damping[1];
      // Steering geometry: Ackermann, the inside wheel turns more.
      let delta = 0;
      if (front && Math.abs(steerAngle) > 1e-4) {
        const L = s.cgToFront + s.cgToRear;
        const R = L / Math.tan(Math.abs(steerAngle));
        const inside = (steerAngle > 0 && wh.local.x < 0) || (steerAngle < 0 && wh.local.x > 0);
        delta = Math.sign(steerAngle) * Math.atan(L / (R + (inside ? -1 : 1) * (s.track / 2)));
      }
      // Wheel heading in the car frame: + steer (right) rotates toward -x.
      const fwd = rotate(q, { x: -Math.sin(delta), y: 0, z: Math.cos(delta) });
      fwd.y = 0;
      normalize(fwd);
      const lat = { x: fwd.z, y: 0, z: -fwd.x }; // left of the wheel heading

      if (!wh.contact) {
        wh.load = 0;
        wh.fy = 0;
        // Spinning freely in the air.
        wh.omega += ((wh.driven ? driveTorque : 0) / s.wheelInertia) * h;
        wh.omega *= 1 - 0.5 * h;
        return;
      }
      const compression = s.suspensionTravel - wh.len;
      const mount = rotate(q, wh.local, t);
      const contact = { x: mount.x - up.x * (wh.len + r), y: wh.ground, z: mount.z - up.z * (wh.len + r) };
      const rel = { x: contact.x - t.x, y: contact.y - t.y, z: contact.z - t.z };
      const pv = { x: v.x + w.y * rel.z - w.z * rel.y, y: v.y + w.z * rel.x - w.x * rel.z, z: v.z + w.x * rel.y - w.y * rel.x };
      const compVel = -(pv.x * up.x + pv.y * up.y + pv.z * up.z); // closing speed along the spring
      let fz = k * compression + c * compVel + (i < 2 ? arb[0] : arb[1]) * (i % 2 === 0 ? 1 : -1);
      if (wh.len < 0.04) fz += 60000 * (0.04 - wh.len); // bump stop
      fz = Math.max(0, fz);
      wh.load = fz;

      const vx = pv.x * fwd.x + pv.z * fwd.z;
      const vy = pv.x * lat.x + pv.z * lat.z;
      const speed = Math.abs(vx);
      // Instantaneous slips, then lagged over the relaxation length (stable at standstill).
      const denom = Math.max(speed, 0.6);
      const kappaInst = Math.max(-1.5, Math.min(1.5, (wh.omega * r - vx) / denom));
      const alphaInst = Math.atan2(vy, denom);
      const lag = Math.min(1, ((speed + 0.6) * h) / 0.4);
      wh.kappa += (kappaInst - wh.kappa) * lag;
      wh.alpha += (alphaInst - wh.alpha) * lag;

      // Combined slip (similarity method) through the Magic Formula.
      const sx = wh.kappa, sy = Math.tan(wh.alpha);
      const sMag = Math.hypot(sx, sy);
      // Mild load sensitivity: grip per newton falls a little as load rises.
      const mu = s.mu * (1 - 0.06 * (fz / 3500 - 1));
      let fx = 0, fy = 0;
      if (sMag > 1e-6) {
        // Tyres grip a little harder in braking/traction than in cornering.
        const fxMag = magic(sMag, 14, 1.6, 0.3) * mu * 1.08 * fz;
        const fyMag = magic(sMag, 12, 1.3, -1) * mu * 0.92 * fz;
        fx = (fxMag * sx) / sMag;
        fy = (-fyMag * sy) / sMag;
      }
      // Rolling resistance.
      fx -= Math.sign(vx) * Math.min(1, speed * 4) * s.crr * fz;
      wh.fy = fy;
      this.slip = Math.max(this.slip, Math.min(1.5, Math.abs(wh.alpha) * 4 + Math.max(0, Math.abs(wh.kappa) - 0.1) * 3));

      // Wheel spin: drive, road reaction, then brakes (which can't reverse the spin).
      let tq = (wh.driven ? driveTorque : 0) - fx * r;
      wh.omega += (tq / s.wheelInertia) * h;
      let brakeT = inp.brake ** 1.3 * (front ? s.brakeTorque[0] : s.brakeTorque[1]);
      // ABS: dump pressure on a wheel that's starting to lock (above walking pace).
      if (brakeT > 0 && speed > 2 && wh.kappa * Math.sign(vx) < -0.14) {
        brakeT *= 0.25;
        this.absActive = true;
      }
      if (!front && (inp.handbrake || inp.parkBrake)) brakeT += s.handbrakeTorque;
      if (inp.selector === "P" && wh.driven) brakeT += 6000; // parking pawl
      const dOmega = (brakeT / s.wheelInertia) * h;
      wh.omega = Math.abs(wh.omega) <= dOmega ? 0 : wh.omega - Math.sign(wh.omega) * dOmega;

      // Forces into the chassis at the contact patch.
      const F = { x: fwd.x * fx + lat.x * fy + up.x * fz, y: up.y * fz, z: fwd.z * fx + lat.z * fy + up.z * fz };
      body.applyImpulseAtPoint({ x: F.x * h, y: F.y * h, z: F.z * h }, contact, true);

      // Rack torque: lateral force times pneumatic + mechanical trail. The
      // pneumatic trail collapses as the tyre slides, so the wheel goes light.
      if (front) {
        const aPeak = 0.14;
        const pneumatic = 0.035 * Math.max(0, 1 - Math.abs(wh.alpha) / aPeak);
        rackTorque += fy * (pneumatic + 0.02);
      }
    });
    // Traction control: cut engine torque while a driven wheel spins up,
    // restore it smoothly once it grips again.
    const spin = Math.max(...this.wheels.filter((x) => x.driven && x.contact).map((x) => x.kappa * Math.sign(ratio || 1)), 0);
    this.tcs = spin > 0.12 ? Math.max(0.2, this.tcs - 6 * h) : Math.min(1, this.tcs + 1.5 * h);

    // Aerodynamic drag at the CG.
    const sp = Math.hypot(v.x, v.z);
    const drag = 0.5 * 1.225 * s.cdA * sp;
    body.applyImpulse({ x: -v.x * drag * h, y: 0, z: -v.z * drag * h }, true);
    // Lateral force pushes the tyres back toward straight ahead; through a
    // 14:1 rack that's this torque at the rim.
    this.steerTorque = rackTorque / 14;
  }

  private currentRatio(sel: string) {
    if (sel === "D") return this.spec.ratios[this.gear - 1];
    if (sel === "R") return -this.spec.reverse;
    return 0;
  }

  /** Dual-clutch automatic: shift on rpm with throttle-dependent points. */
  private automatic(dt: number, inp: PhysicsInput) {
    const s = this.spec;
    const driven = this.wheels.filter((w) => w.driven);
    const omega = driven.reduce((a, w) => a + w.omega, 0) / driven.length;
    const ratio = this.currentRatio(inp.selector);
    const coupled = Math.abs(omega * ratio * s.finalDrive) * (30 / Math.PI);
    // Shift decisions follow road speed, so a moment of wheelspin can't trigger an upshift.
    const roadRpm = Math.abs((this.localVelocity().vf / s.wheelRadius) * ratio * s.finalDrive) * (30 / Math.PI);
    // Below ~1,300 rpm the clutch slips (pulling away), letting the engine rev.
    const slipRpm = s.idleRpm + inp.throttle * 1800;
    const target = ratio === 0 ? s.idleRpm + inp.throttle * (s.redline - s.idleRpm) * 0.85 : Math.max(coupled, coupled < 1300 ? slipRpm : s.idleRpm);
    this.rpm += (Math.min(s.redline, target) - this.rpm) * Math.min(1, dt * 12);
    if (inp.selector !== "D") {
      this.gear = 1;
      return;
    }
    this.shiftTimer -= dt;
    if (this.shiftTimer > 0) return;
    // Light throttle shifts early (economy), full throttle holds to near the redline.
    const up = 1750 + inp.throttle ** 1.5 * 4000;
    const down = 1100 + inp.throttle ** 1.5 * 2200;
    if (roadRpm > up && this.gear < s.ratios.length) {
      this.gear++;
      this.shiftTimer = 0.35;
    } else if (roadRpm < down && this.gear > 1) {
      this.gear--;
      this.shiftTimer = 0.35;
    }
  }
}

// --- small vector helpers (no allocation-heavy math library in the hot loop) ---

type V3 = { x: number; y: number; z: number };
function rotate(q: { x: number; y: number; z: number; w: number }, v: V3, add?: V3): V3 {
  const ix = q.w * v.x + q.y * v.z - q.z * v.y;
  const iy = q.w * v.y + q.z * v.x - q.x * v.z;
  const iz = q.w * v.z + q.x * v.y - q.y * v.x;
  const iw = -q.x * v.x - q.y * v.y - q.z * v.z;
  const out = {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  };
  if (add) {
    out.x += add.x;
    out.y += add.y;
    out.z += add.z;
  }
  return out;
}
function normalize(v: V3) {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  v.x /= l;
  v.y /= l;
  v.z /= l;
}
