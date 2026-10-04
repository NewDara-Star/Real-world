import * as THREE from "three/webgpu";
import { createVertexColorMaterial } from "./facade";
import { templateGeometry, makeTemplate } from "./props";
import { carTemplate, danfoTemplate } from "./traffic";
import type { DriveInput } from "./wheel";
import { mirrors, type MirrorKind } from "./mirrors";
import type { World } from "./world";

// Arcade-sim car physics tuned to feel good on a wheel: a bicycle model with
// engine/brake/drag forces, speed-sensitive steering, lateral grip that breaks
// away under the handbrake, and wall collisions against real Yaba buildings.

export type VehicleKind = "car" | "danfo";
/** Automatic gear selector. */
export type Selector = "P" | "R" | "N" | "D";
const SELECTOR: Selector[] = ["P", "R", "N", "D"];
/** Reverse is geared low: about 25 km/h flat out. */
const REVERSE_TOP = 7;
/** Idle creep in D and R: an automatic rolls at walking pace with no pedals. */
const CREEP_SPEED = 1.8;

interface Spec {
  mass: number;
  engine: number; // peak drive force (N)
  brake: number; // brake force (N)
  drag: number; // aero drag coefficient (N per (m/s)^2)
  roll: number; // rolling resistance (N per m/s)
  wheelbase: number;
  maxSteer: number; // radians at the front wheels
  grip: number; // how fast lateral slip is killed (1/s)
  gears: number[]; // top speed of each gear (m/s), for engine sound
  length: number;
  width: number;
  cockpit: THREE.Vector3; // driver eye position (left-hand drive)
}

export const SPECS: Record<VehicleKind, Spec> = {
  car: {
    mass: 1250, engine: 6200, brake: 11000, drag: 0.42, roll: 14, wheelbase: 2.6, maxSteer: 0.6, grip: 9,
    gears: [9, 16, 24, 32, 40, 52], length: 4.3, width: 1.8, cockpit: new THREE.Vector3(0.38, 1.12, 0.25),
  },
  danfo: {
    mass: 2400, engine: 7600, brake: 15000, drag: 0.9, roll: 30, wheelbase: 3.0, maxSteer: 0.55, grip: 6.5,
    gears: [6, 11, 17, 23, 28], length: 4.8, width: 2.0, cockpit: new THREE.Vector3(0.48, 1.62, 1.55),
  },
};

export class PlayerVehicle {
  kind: VehicleKind;
  spec: Spec;
  x: number;
  z: number;
  yaw: number;
  /** velocity in the car's frame: forward and rightward (m/s) */
  vf = 0;
  vr = 0;
  yawRate = 0;
  steerAngle = 0;
  root = new THREE.Group();
  private body: THREE.Group;
  private cockpitGroup: THREE.Group;
  private steeringWheel: THREE.Mesh;
  /** 0..1, for the engine sound */
  rpm = 0;
  gear = 1;
  slip = 0;
  /** impact speed of a collision this frame (m/s), 0 if none */
  impact = 0;

  selector: Selector = "P";
  parkBrake = true;
  /** -1 left, +1 right, 0 off. */
  indicator = 0;
  hazards = false;
  /** 0 off, 1 dipped, 2 full beam. */
  lights = 0;
  /** 0 off, 1 intermittent, 2 normal, 3 fast. */
  wipers = 0;
  /** Indicator flasher state: true while the lamps are lit. */
  blinkOn = false;
  private blinkT = 0;
  /** How far the wheel went in the signalled direction, for self-cancelling. */
  private indPeak = 0;
  private wiperT = 0;
  private wiperPause = 0;
  private wiperArms: THREE.Object3D[] = [];
  private lamps: Record<"indL" | "indR" | "brake" | "head" | "reverse", THREE.MeshBasicNodeMaterial>;
  /** Events for the frame, for sounds: flasher relay and wiper end-of-sweep. */
  ticked: boolean | null = null;
  wiped = false;

  /** Driver's seat side: +1 left-hand drive (Lagos), -1 right-hand drive (Ireland). */
  readonly seat: number;

  constructor(kind: VehicleKind, x: number, z: number, yaw: number, drive: "right" | "left" = "right") {
    this.seat = drive === "right" ? 1 : -1;
    this.kind = kind;
    const base = SPECS[kind];
    // Mirror the cockpit for right-hand-drive cars.
    this.spec = { ...base, cockpit: base.cockpit.clone().setX(base.cockpit.x * this.seat) };
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    const mat = createVertexColorMaterial(0.55, 0.15);
    this.body = new THREE.Group();
    const bodyMesh = new THREE.Mesh(templateGeometry(kind === "danfo" ? danfoTemplate() : carTemplate(0x1f9d55)), mat);
    bodyMesh.castShadow = true;
    this.body.add(bodyMesh);
    this.root.add(this.body);

    // Minimal interior for the cockpit camera: dashboard and a steering wheel
    // that turns with the player's wheel.
    this.cockpitGroup = new THREE.Group();
    const c = this.spec.cockpit;
    const dash = makeTemplate([[new THREE.BoxGeometry(this.spec.width - 0.2, 0.22, 0.45).translate(0, c.y - 0.55, c.z + 0.95), 0x2a2522]]);
    this.cockpitGroup.add(new THREE.Mesh(templateGeometry(dash), mat));
    const wheelGeo = templateGeometry(
      makeTemplate([
        [new THREE.TorusGeometry(0.19, 0.025, 6, 18), 0x1a1a1a],
        [new THREE.BoxGeometry(0.36, 0.035, 0.03), 0x1a1a1a],
        [new THREE.BoxGeometry(0.035, 0.19, 0.03).translate(0, -0.09, 0), 0x1a1a1a],
      ]),
    );
    this.steeringWheel = new THREE.Mesh(wheelGeo, mat);
    this.steeringWheel.position.set(c.x, c.y - 0.42, c.z + 0.68);
    this.steeringWheel.rotation.x = -0.45;
    this.cockpitGroup.add(this.steeringWheel);
    this.buildCabin(mat);
    this.cockpitGroup.visible = false;
    this.lamps = this.buildLamps();
    this.root.add(this.cockpitGroup);
    this.sync();
  }

  /**
   * Pillars, roof and door tops around the driver, so the head check has
   * real blind spots, plus two wiper arms on the base of the windscreen.
   */
  private buildCabin(mat: THREE.Material) {
    const c = this.spec.cockpit;
    const w = this.spec.width;
    const trim = 0x2e2b29, roof = 0x8a857c;
    // Windscreen from the dash top (low, forward) to the roof (high, back).
    const baseY = c.y - 0.44, baseZ = c.z + 1.12, topY = c.y + 0.3, topZ = c.z + 0.45;
    const len = Math.hypot(topY - baseY, topZ - baseZ);
    const tilt = Math.atan2(baseZ - topZ, topY - baseY);
    const pillar = (x: number) => new THREE.BoxGeometry(0.09, len, 0.07).rotateX(-tilt).translate(x, (baseY + topY) / 2, (baseZ + topZ) / 2);
    const bp = (x: number) => new THREE.BoxGeometry(0.12, 0.8, 0.14).translate(x, c.y - 0.1, c.z - 0.55);
    const half = w / 2 - 0.06;
    const parts: [THREE.BufferGeometry, number][] = [
      [pillar(-half), trim], [pillar(half), trim],
      [bp(-half), trim], [bp(half), trim],
      [new THREE.BoxGeometry(w - 0.1, 0.05, 1.7).translate(0, topY + 0.02, topZ - 0.75), roof],
      [new THREE.BoxGeometry(w - 0.1, 0.07, 0.08).translate(0, topY - 0.02, topZ), trim],
      // Door tops and window sills either side.
      [new THREE.BoxGeometry(0.1, 0.06, 1.9).translate(-half, c.y - 0.4, c.z + 0.1), trim],
      [new THREE.BoxGeometry(0.1, 0.06, 1.9).translate(half, c.y - 0.4, c.z + 0.1), trim],
      [new THREE.BoxGeometry(0.06, 0.5, 1.9).translate(-half - 0.02, c.y - 0.68, c.z + 0.1), 0x3a3633],
      [new THREE.BoxGeometry(0.06, 0.5, 1.9).translate(half + 0.02, c.y - 0.68, c.z + 0.1), 0x3a3633],
    ];
    this.cockpitGroup.add(new THREE.Mesh(templateGeometry(makeTemplate(parts)), mat));

    // Mirrors: glass sampling the shared rear view, in a dark housing, each
    // turned to face the driver's eye.
    const eye = new THREE.Vector3(c.x, c.y, c.z);
    const mirror = (kind: MirrorKind, x: number, y: number, z: number, gw: number, gh: number) => {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      const d = eye.clone().sub(g.position);
      g.rotation.order = "YXZ";
      g.rotation.y = Math.atan2(d.x, d.z);
      g.rotation.x = -Math.atan2(d.y, Math.hypot(d.x, d.z));
      const housing = new THREE.Mesh(templateGeometry(makeTemplate([[new THREE.BoxGeometry(gw + 0.03, gh + 0.03, 0.05).translate(0, 0, -0.03), 0x161616]])), mat);
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(gw, gh), mirrors.materials[kind]);
      // Layer 1: the main camera sees the glass, the mirror camera never
      // does, so a mirror can't sample the image it's being drawn into.
      glass.layers.set(1);
      g.add(housing, glass);
      this.cockpitGroup.add(g);
    };
    // Rear-view hangs off the glass about 60 cm ahead of the eyes; wing
    // mirrors sit outside, just behind the A-pillar so the side window shows them.
    mirror("rear", 0, c.y + 0.12, c.z + 0.62, 0.25, 0.07);
    const wx = half + 0.16, wy = c.y - 0.3, wz = c.z + 0.8;
    mirror("left", wx, wy, wz, 0.21, 0.13);
    mirror("right", -wx, wy, wz, 0.21, 0.13);

    // Wipers: a frame lying in the glass plane, arms pivoting within it.
    const glass = new THREE.Group();
    glass.position.set(0, baseY + 0.03, baseZ - 0.03);
    glass.rotation.x = -tilt;
    const blade = templateGeometry(
      makeTemplate([
        [new THREE.BoxGeometry(0.62, 0.018, 0.018).translate(0.31, 0, 0), 0x111111],
        [new THREE.BoxGeometry(0.5, 0.028, 0.012).translate(0.36, 0.012, -0.012), 0x0c0c0c],
      ]),
    );
    for (const x of [-0.62, 0.02]) {
      const arm = new THREE.Mesh(blade, mat);
      arm.position.set(x * (w / 1.8), 0, 0);
      glass.add(arm);
      this.wiperArms.push(arm);
    }
    this.cockpitGroup.add(glass);
  }

  /** Indicator, brake, reverse and head lamps on the body, lit by colour. */
  private buildLamps() {
    // Just proud of the body box (car 4.2 m, danfo 4.6 m long).
    const L = (this.kind === "danfo" ? 2.3 : 2.1) + 0.03;
    const W = this.spec.width / 2;
    const y = this.kind === "danfo" ? 0.75 : 0.62;
    const mk = () => new THREE.MeshBasicNodeMaterial({ color: 0x000000 });
    const lamps = { indL: mk(), indR: mk(), brake: mk(), head: mk(), reverse: mk() };
    const add = (m: THREE.MeshBasicNodeMaterial, x: number, z: number, sw = 0.22, sh = 0.1) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(sw, sh, 0.05), m);
      mesh.position.set(x, y, z);
      this.body.add(mesh);
    };
    // +x is the car's left (forward is +z, right is -x).
    for (const s of [1, -1]) {
      add(s > 0 ? lamps.indL : lamps.indR, s * (W - 0.1), L, 0.14, 0.08);
      add(s > 0 ? lamps.indL : lamps.indR, s * (W - 0.1), -L, 0.14, 0.08);
      add(lamps.head, s * (W - 0.38), L, 0.3, 0.12);
      add(lamps.brake, s * (W - 0.34), -L, 0.26, 0.12);
      add(lamps.reverse, s * (W - 0.58), -L, 0.12, 0.08);
    }
    return lamps;
  }

  /** Gear selector one step toward P (-1) or D (+1). Returns why not, if refused. */
  shift(dir: -1 | 1, brake: number): string | null {
    const i = SELECTOR.indexOf(this.selector) + dir;
    if (i < 0 || i >= SELECTOR.length) return null;
    const to = SELECTOR[i];
    if (this.selector === "P" && brake < 0.15) return "Foot on the brake to shift out of P";
    if (to === "P" && Math.abs(this.vf) > 0.5) return "Stop the car before selecting P";
    if (to === "R" && this.vf > 1) return "Stop the car before selecting R";
    if (to === "D" && this.vf < -1) return "Stop the car before selecting D";
    this.selector = to;
    return null;
  }

  /** Buttons that don't touch the physics: indicators, hazards, lights, wipers, parking brake. */
  controls(inp: DriveInput, dt: number) {
    if (inp.indicatorLeft) this.setIndicator(this.indicator === -1 ? 0 : -1);
    if (inp.indicatorRight) this.setIndicator(this.indicator === 1 ? 0 : 1);
    if (inp.hazards) this.hazards = !this.hazards;
    if (inp.lights) this.lights = (this.lights + 1) % 3;
    if (inp.wipers) {
      this.wipers = (this.wipers + 1) % 4;
      this.wiperPause = 0;
    }
    if (inp.parkBrake) this.parkBrake = !this.parkBrake;
    // Drive-away release, like an electronic parking brake.
    if (this.parkBrake && inp.throttle > 0.15 && (this.selector === "D" || this.selector === "R")) this.parkBrake = false;

    // Self-cancel: once the wheel has turned well into the signalled
    // direction, straightening up switches the indicator off.
    if (this.indicator) {
      const turned = inp.steer * this.indicator; // both are + for right, - for left
      this.indPeak = Math.max(this.indPeak, turned);
      if (this.indPeak > 0.12 && turned < 0.03) this.setIndicator(0);
    }

    // Flasher relay at ~1.5 Hz.
    this.ticked = null;
    if (this.indicator || this.hazards) {
      this.blinkT += dt;
      if (this.blinkT >= 0.36) {
        this.blinkT -= 0.36;
        this.blinkOn = !this.blinkOn;
        this.ticked = this.blinkOn;
      }
    } else if (this.blinkOn) {
      this.blinkOn = false;
      this.ticked = false;
    }

    // Wipers: one sweep up and back is 1.1 s (normal), 0.7 s (fast); intermittent waits between.
    this.wiped = false;
    if (this.wipers || this.wiperT > 0) {
      if (this.wiperPause > 0) this.wiperPause -= dt;
      else {
        const period = this.wipers === 3 ? 0.7 : 1.1;
        const before = this.wiperT;
        this.wiperT += dt / period;
        if (before < 0.5 && this.wiperT >= 0.5) this.wiped = true;
        if (this.wiperT >= 1) {
          this.wiperT = this.wipers ? this.wiperT - 1 : 0;
          if (this.wipers === 1) {
            this.wiperT = 0;
            this.wiperPause = 2.4;
          }
          if (this.wipers) this.wiped = true;
        }
      }
    }
    const sweep = (1 - Math.cos(this.wiperT * Math.PI * 2)) / 2;
    for (const a of this.wiperArms) a.rotation.z = sweep * 1.55;

    // Lamps. Colours above 1 feed the bloom.
    const left = this.blinkOn && (this.indicator === -1 || this.hazards);
    const right = this.blinkOn && (this.indicator === 1 || this.hazards);
    this.lamps.indL.color.setRGB(left ? 4 : 0.25, left ? 1.6 : 0.12, left ? 0.1 : 0.02);
    this.lamps.indR.color.setRGB(right ? 4 : 0.25, right ? 1.6 : 0.12, right ? 0.1 : 0.02);
    const braking = inp.brake > 0.05;
    this.lamps.brake.color.setRGB(braking ? 5 : this.lights ? 1.4 : 0.3, braking ? 0.15 : 0.03, braking ? 0.1 : 0.03);
    const rev = this.selector === "R";
    this.lamps.reverse.color.setRGB(rev ? 3 : 0.5, rev ? 3 : 0.5, rev ? 3 : 0.5);
    const hb = this.lights === 2 ? 5 : this.lights ? 3 : 0.6;
    this.lamps.head.color.setRGB(hb, hb, hb * 0.92);
  }

  private setIndicator(v: number) {
    this.indicator = v;
    this.indPeak = 0;
    if (v && !this.blinkOn) this.blinkT = 0.36; // light on the very next frame
  }

  /** Driver's eye in world space (no head check), for the mirror camera. */
  eye(out: THREE.Vector3) {
    const c = this.spec.cockpit;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    return out.set(this.x + fx * c.z + fz * c.x, c.y, this.z + fz * c.z - fx * c.x);
  }

  get speed() {
    return Math.hypot(this.vf, this.vr);
  }

  setCockpit(on: boolean) {
    this.cockpitGroup.visible = on;
    this.body.visible = !on;
  }

  update(dt: number, inp: DriveInput, world: World) {
    // Fixed sub-steps keep the integration stable at low frame rates.
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    this.impact = 0;
    for (let i = 0; i < steps; i++) this.step(h, inp, world);
    this.sync();
    // The on-screen wheel mirrors the player's input: full lock = 1.25 turns
    // each way, like the G29's 900 degrees. Positive z turns it clockwise as
    // seen from the driver's seat.
    this.steeringWheel.rotation.z = inp.steer * Math.PI * 1.25;
  }

  private step(h: number, inp: DriveInput, world: World) {
    const s = this.spec;
    const speed = this.vf;

    // Speed-sensitive steering: full lock when parking, gentler at speed.
    const lockScale = 1 / (1 + Math.abs(speed) / 18);
    const target = inp.steer * s.maxSteer * (inp.device === "wheel" ? Math.max(0.35, lockScale * 1.2) : lockScale);
    const steerRate = inp.device === "wheel" ? 30 : 4;
    this.steerAngle += Math.max(-steerRate * h, Math.min(steerRate * h, target - this.steerAngle));

    // Longitudinal. The selector decides which way the engine pushes; the
    // brakes only ever slow the car toward zero, never push it backwards.
    const dir = this.selector === "D" ? 1 : this.selector === "R" ? -1 : 0;
    let drive = 0;
    if (dir) {
      const v = speed * dir; // speed in the selected direction
      const top = dir > 0 ? s.gears[s.gears.length - 1] * 1.05 : REVERSE_TOP;
      const pull = inp.throttle * s.engine * (dir < 0 ? 0.6 : 1) * Math.max(0, 1 - Math.max(0, v) / top);
      // Torque converter creep, fading as the pedal takes over.
      const creep = v < CREEP_SPEED ? s.engine * 0.11 * (1 - Math.max(0, v) / CREEP_SPEED) * (1 - inp.throttle) : 0;
      // Engine braking against the selected direction (e.g. rolling back in D).
      const resist = v < 0 ? -v * s.mass * 0.6 : 0;
      drive = dir * (pull + creep + resist);
    }
    drive -= s.drag * speed * Math.abs(speed) + s.roll * speed;
    this.vf += (drive / s.mass) * h;

    let stop = inp.brake * s.brake + s.mass * 0.15; // pedal + rolling resistance
    if (inp.handbrake) stop += s.brake * 0.35;
    if (this.parkBrake) stop += s.brake * 0.6;
    if (this.selector === "P") stop += s.brake * 2; // parking pawl
    const dv = (stop / s.mass) * h;
    this.vf = Math.abs(this.vf) <= dv ? 0 : this.vf - Math.sign(this.vf) * dv;

    // Yaw follows the bicycle model; lateral slip decays at the grip rate.
    // With x east and z south, increasing yaw turns the car LEFT, so a right
    // steer (positive) must drive yaw down.
    const targetYawRate = (-this.vf * Math.tan(this.steerAngle)) / s.wheelbase;
    const grip = inp.handbrake ? s.grip * 0.18 : s.grip;
    this.yawRate += (targetYawRate - this.yawRate) * Math.min(1, grip * h * 1.4);
    // Handbrake lets the rear step out: add a little extra rotation and slide.
    if (inp.handbrake && Math.abs(this.vf) > 6) this.yawRate -= Math.sign(this.steerAngle) * h * 1.2;
    // Cornering pushes the body outward (turning right slides it left).
    this.vr += this.yawRate * this.vf * h * (inp.handbrake ? 0.25 : 0.05);
    this.vr -= this.vr * Math.min(1, grip * h);
    this.yaw += this.yawRate * h;
    this.slip = Math.min(1, Math.abs(this.vr) / 4 + (inp.handbrake && Math.abs(this.vf) > 4 ? 0.5 : 0));

    // Integrate position in world space (forward is +z rotated by yaw).
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const rx = -fz, rz = fx; // right of forward in x-right / z-south space
    this.x += (fx * this.vf + rx * this.vr) * h;
    this.z += (fz * this.vf + rz * this.vr) * h;
    this.collide(world, fx, fz);

    // Gear and rpm for the engine sound.
    const v = Math.abs(this.vf);
    if (dir > 0) {
      let g = 0;
      while (g < s.gears.length - 1 && v > s.gears[g] * 0.95) g++;
      this.gear = g + 1;
      const lo = g === 0 ? 0 : s.gears[g - 1] * 0.6;
      this.rpm = Math.min(1, Math.max(0.12, (v - lo) / (s.gears[g] - lo)) * 0.85 + inp.throttle * 0.15);
    } else if (dir < 0) {
      this.gear = 1;
      this.rpm = Math.min(1, Math.max(0.12, v / REVERSE_TOP) * 0.85 + inp.throttle * 0.15);
    } else {
      // P or N: the engine revs freely.
      this.gear = 0;
      this.rpm += (0.12 + inp.throttle * 0.85 - this.rpm) * Math.min(1, h * 4);
    }
  }

  /** Three circles along the body against building walls. */
  private collide(world: World, fx: number, fz: number) {
    const s = this.spec;
    const r = s.width / 2;
    const offs = [s.length / 2 - r, 0, -(s.length / 2 - r)];
    const p = new THREE.Vector3();
    let px = 0, pz = 0, hits = 0;
    for (const o of offs) {
      const cx = this.x + fx * o, cz = this.z + fz * o;
      p.set(cx, 0, cz);
      world.collide(p, r);
      const dx = p.x - cx, dz = p.z - cz;
      if (dx || dz) {
        px += dx;
        pz += dz;
        hits++;
      }
    }
    if (!hits) return;
    this.x += px / hits;
    this.z += pz / hits;
    // Kill the velocity into the wall and bounce a little.
    const n = Math.hypot(px, pz) || 1;
    const nx = px / n, nz = pz / n;
    const vx = Math.sin(this.yaw) * this.vf + -Math.cos(this.yaw) * this.vr;
    const vz = Math.cos(this.yaw) * this.vf + Math.sin(this.yaw) * this.vr;
    const into = vx * nx + vz * nz;
    if (into < 0) {
      this.impact = Math.max(this.impact, -into);
      const nvx = vx - (1.3 * into) * nx, nvz = vz - (1.3 * into) * nz;
      const fx2 = Math.sin(this.yaw), fz2 = Math.cos(this.yaw);
      this.vf = (nvx * fx2 + nvz * fz2) * 0.75;
      this.vr = (nvx * -fz2 + nvz * fx2) * 0.5;
      this.yawRate *= 0.5;
    }
  }

  /** Bump against another vehicle or a person: bleed speed. */
  bump(nx: number, nz: number, depth: number) {
    this.x += nx * depth;
    this.z += nz * depth;
    this.impact = Math.max(this.impact, Math.abs(this.vf) * 0.6);
    this.vf *= 0.4;
    this.vr *= 0.4;
  }

  private sync() {
    this.root.position.set(this.x, 0, this.z);
    this.root.rotation.y = this.yaw;
    // A touch of body roll and pitch sells the weight, more on the danfo.
    const roll = Math.max(-0.08, Math.min(0.08, this.yawRate * this.vf * (this.kind === "danfo" ? 0.012 : 0.006)));
    this.body.rotation.z = roll;
  }
}
