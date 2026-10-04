import * as THREE from "three/webgpu";
import { createVertexColorMaterial } from "./facade";
import { templateGeometry, makeTemplate } from "./props";
import { carTemplate, danfoTemplate } from "./traffic";
import type { DriveInput } from "./wheel";
import type { World } from "./world";

// Arcade-sim car physics tuned to feel good on a wheel: a bicycle model with
// engine/brake/drag forces, speed-sensitive steering, lateral grip that breaks
// away under the handbrake, and wall collisions against real Yaba buildings.

export type VehicleKind = "car" | "danfo";

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
    this.cockpitGroup.visible = false;
    this.root.add(this.cockpitGroup);
    this.sync();
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

    // Longitudinal: throttle drives forward; brake slows, then reverses when stopped.
    let force = 0;
    if (inp.throttle > 0) force += inp.throttle * s.engine * (speed < 0 ? 1.6 : 1) * (1 - Math.max(0, speed) / (s.gears[s.gears.length - 1] * 1.05));
    if (inp.brake > 0) {
      if (speed > 0.5) force -= inp.brake * s.brake;
      else force -= inp.brake * s.engine * 0.45 * (1 + speed / 8); // reverse
    }
    if (inp.handbrake) force -= Math.sign(speed) * s.brake * 0.35;
    force -= s.drag * speed * Math.abs(speed) + s.roll * speed;
    this.vf += (force / s.mass) * h;
    if (inp.throttle === 0 && inp.brake === 0 && Math.abs(this.vf) < 0.15) this.vf = 0;

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
    let g = 0;
    while (g < s.gears.length - 1 && v > s.gears[g] * 0.95) g++;
    this.gear = g + 1;
    const lo = g === 0 ? 0 : s.gears[g - 1] * 0.6;
    this.rpm = Math.min(1, Math.max(0.12, (v - lo) / (s.gears[g] - lo)) * 0.85 + inp.throttle * 0.15);
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
