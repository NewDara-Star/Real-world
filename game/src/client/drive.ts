import * as THREE from "three/webgpu";
import { createVertexColorMaterial } from "./facade";
import { templateGeometry, makeTemplate } from "./props";
import { carTemplate, danfoTemplate } from "./traffic";
import type { DriveInput } from "./wheel";
import { mirrors, type MirrorKind } from "./mirrors";
import { buildCarModel, type CarModel } from "./carmodel";

const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);
import type { World } from "./world";
import { CarPhysics, DANFO, HATCH_AUTO, rimLock, type CarSpec, type GroundFn } from "./carphysics";
import { ALLOW_PED, LaneKind } from "./roadnet";
import { PATH_Y, ROAD_Y } from "./roadrender";

/** Something that can list the AI vehicles near a point (NetTraffic). */
export interface TrafficSource {
  nearCars(x: number, z: number, r: number): { key: unknown; x: number; z: number; yaw: number; len: number; w: number }[];
}

/** The model's origin (road level, midway between the axles) in the physics body's frame (centre of gravity; +x left, +z forward). */
const originOf = (s: CarSpec) => ({ x: 0, y: -s.cgHeight, z: -(s.cgToRear - s.cgToFront) / 2 });
const tmpV = new THREE.Vector3();
function rotateAdd(q: { x: number; y: number; z: number; w: number }, v: { x: number; y: number; z: number }, t: { x: number; y: number; z: number }) {
  tmpV.set(v.x, v.y, v.z).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
  return { x: tmpV.x + t.x, y: tmpV.y + t.y, z: tmpV.z + t.z };
}

// The player's vehicle: a body and cabin drawn around the rigid-body
// simulation in carphysics.ts (Rapier, Pacejka tyres, automatic gearbox).

export type VehicleKind = "car" | "danfo";
/** Automatic gear selector. */
export type Selector = "P" | "R" | "N" | "D";
const SELECTOR: Selector[] = ["P", "R", "N", "D"];

/** What's drawn and where the driver sits, plus the physics underneath. */
interface Body {
  physics: CarSpec;
  length: number;
  width: number;
  cockpit: THREE.Vector3; // driver eye position (left-hand drive)
}

const BODIES: Record<VehicleKind, Body> = {
  car: { physics: HATCH_AUTO, length: 4.3, width: 1.8, cockpit: new THREE.Vector3(0.38, 1.12, 0.25) },
  danfo: { physics: DANFO, length: 4.8, width: 2.0, cockpit: new THREE.Vector3(0.48, 1.62, 1.55) },
};

export class PlayerVehicle {
  kind: VehicleKind;
  spec: Body;
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
  private model: CarModel | null = null;
  private steerBase: THREE.Quaternion | null = null;
  private wheelSpin = 0;
  private tmpQ = new THREE.Quaternion();
  private tmpQ2 = new THREE.Quaternion();
  /** Rigid-body simulation. */
  phys: CarPhysics;
  private origin: { x: number; y: number; z: number };
  /** Steering sent to the physics, -1..1 (rate-limited for keys and pads). */
  private steerCmd = 0;
  /** Force-feedback kick from a kerb or pothole this frame, -1..1. */
  kerbJolt = 0;
  private lastGround = [0, 0, 0, 0];
  private wheelAngle = [0, 0, 0, 0];
  private wheelRest: { pos: THREE.Vector3; up: THREE.Vector3 }[] | null = null;
  private upsideDown = 0;
  /** Events for the frame, for sounds: flasher relay and wiper end-of-sweep. */
  ticked: boolean | null = null;
  wiped = false;

  /** Driver's seat side: +1 left-hand drive (Lagos), -1 right-hand drive (Ireland). */
  readonly seat: number;

  /** Needs the physics engine loaded first (initPhysics). */
  constructor(kind: VehicleKind, x: number, z: number, yaw: number, world: World, drive: "right" | "left" = "right") {
    this.seat = drive === "right" ? 1 : -1;
    this.kind = kind;
    const base = BODIES[kind];
    // Mirror the cockpit for right-hand-drive cars.
    this.spec = { ...base, cockpit: base.cockpit.clone().setX(base.cockpit.x * this.seat) };
    // The real car model, when loaded: its own body, interior and driver's eye.
    this.model = kind === "car" ? buildCarModel(this.seat) : null;
    if (this.model) {
      this.spec = { ...this.spec, cockpit: this.model.eye.clone(), length: Math.min(4.6, this.model.length), width: 2.0 };
      this.steerBase = this.model.steering?.quaternion.clone() ?? null;
    }
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    const ps = base.physics;
    this.origin = originOf(ps);
    this.phys = new CarPhysics(ps, x - Math.sin(yaw) * this.origin.z, z - Math.cos(yaw) * this.origin.z, yaw, world.footprintList);
    if (world.meta) this.phys.addBounds(world.meta.half.x, world.meta.half.z);
    const mat = createVertexColorMaterial(0.55, 0.15);
    this.body = new THREE.Group();
    if (this.model) this.body.add(this.model.root);
    else {
      const bodyMesh = new THREE.Mesh(templateGeometry(kind === "danfo" ? danfoTemplate() : carTemplate(0x1f9d55)), mat);
      bodyMesh.castShadow = true;
      this.body.add(bodyMesh);
    }
    this.root.add(this.body);

    // Minimal interior for the cockpit camera: dashboard and a steering wheel
    // that turns with the player's wheel.
    this.cockpitGroup = new THREE.Group();
    const c = this.spec.cockpit;
    const dash = makeTemplate([[new THREE.BoxGeometry(this.spec.width - 0.2, 0.22, 0.45).translate(0, c.y - 0.55, c.z + 0.95), 0x2a2522]]);
    const dashMesh = new THREE.Mesh(templateGeometry(dash), mat);
    this.cockpitGroup.add(dashMesh);
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
    // The real model brings its own dashboard and wheel.
    dashMesh.visible = this.steeringWheel.visible = !this.model;
    this.buildCabin(mat);
    // The interior is for the driver's eyes only: the mirror camera (layer 0)
    // looks straight through it, like real mirrors outside the cabin.
    this.cockpitGroup.traverse((o) => o.layers.set(1));
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
    if (!this.model) this.cockpitGroup.add(new THREE.Mesh(templateGeometry(makeTemplate(parts)), mat));

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
    if (this.model) {
      // Glass on the back faces of the car's own mirror housings.
      const m = this.model;
      mirror("rear", 0, c.y + 0.13, c.z + 0.6, 0.24, 0.065);
      mirror("left", m.mirrorL.x - 0.02, m.mirrorL.y, m.mirrorL.z - 0.125, 0.19, 0.07);
      mirror("right", m.mirrorR.x + 0.02, m.mirrorR.y, m.mirrorR.z - 0.125, 0.19, 0.07);
    } else {
      mirror("rear", 0, c.y + 0.12, c.z + 0.62, 0.25, 0.07);
      const wx = half + 0.16, wy = c.y - 0.3, wz = c.z + 0.8;
      mirror("left", wx, wy, wz, 0.21, 0.13);
      mirror("right", -wx, wy, wz, 0.21, 0.13);
    }

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
    for (const x of this.model ? [] : [-0.62, 0.02]) {
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
    const L = this.model ? this.model.length / 2 - 0.02 : (this.kind === "danfo" ? 2.3 : 2.1) + 0.03;
    const W = this.spec.width / 2;
    const y = this.model ? 0.72 : this.kind === "danfo" ? 0.75 : 0.62;
    const mk = () => new THREE.MeshBasicNodeMaterial({ color: 0x000000 });
    const lamps = { indL: mk(), indR: mk(), brake: mk(), head: mk(), reverse: mk() };
    const add = (m: THREE.MeshBasicNodeMaterial, x: number, z: number, sw = 0.22, sh = 0.1) => {
      // The real car model lights its own lamps; indicators still need a blinking point each side.
      if (this.model && m !== lamps.indL && m !== lamps.indR) return;
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
    if (this.model) {
      const glow = (mats: THREE.Material[], r: number, g: number, b: number, k: number) => {
        for (const m of mats) {
          const sm = m as THREE.MeshStandardMaterial;
          if (sm.emissive) {
            sm.emissive.setRGB(r, g, b);
            sm.emissiveIntensity = k;
          }
        }
      };
      glow(this.model.lamps.brake, 1, 0.05, 0.03, braking ? 6 : this.lights ? 1.5 : 0);
      glow(this.model.lamps.head, 1, 0.97, 0.9, this.lights === 2 ? 6 : this.lights ? 3.5 : 0);
      glow(this.model.lamps.indL, 1, 0.45, 0.02, left || right ? 5 : 0);
    }
  }

  private setIndicator(v: number) {
    this.indicator = v;
    this.indPeak = 0;
    if (v && !this.blinkOn) this.blinkT = 0.36; // light on the very next frame
  }

  /** Driver's eye in world space (no head check), for the mirror camera. */
  eye(out: THREE.Vector3) {
    return this.root.localToWorld(out.copy(this.spec.cockpit));
  }

  get speed() {
    return Math.hypot(this.vf, this.vr);
  }

  setCockpit(on: boolean) {
    this.cockpitGroup.visible = on;
    if (this.model) {
      // Inside the real car the body stays; it moves to the driver-only layer
      // so the mirror camera looks through it, like real mirrors outside.
      this.model.root.traverse((o) => o.layers.set(on ? 1 : 0));
    } else this.body.visible = !on;
  }

  update(dt: number, inp: DriveInput, world: World, traffic?: TrafficSource) {
    this.impact = 0;
    this.stepPhysics(dt, inp, world, traffic);
    this.sync();
    // The on-screen wheel shows what the front wheels are doing, through the
    // car's steering ratio (the Polo: 450 degrees to full lock, the G29's 900
    // lock to lock). Positive z turns it clockwise from the driver's seat.
    const rim = this.steerCmd * rimLock(this.spec.physics);
    this.steeringWheel.rotation.z = rim;
    if (this.model) {
      const m = this.model;
      if (m.steering && this.steerBase) {
        // Turn about the column (the node's local Y axis).
        m.steering.quaternion.copy(this.steerBase).multiply(this.tmpQ.setFromAxisAngle(AXIS_Y, -rim));
      }
      // Road wheels: roll with speed, fronts steer (model axes: X axle, Z up).
      this.wheelSpin -= (this.vf * dt) / 0.36;
      if (!this.wheelRest) this.measureWheels();
      m.wheels.forEach((w, i) => {
        let spin = this.wheelSpin;
        const pw = this.phys.wheels[this.physWheel(w.obj.name)];
        if (pw && this.wheelRest) {
          // Each wheel spins at its own rate (a locked or spinning wheel shows)
          // and rides up and down on its spring relative to the body.
          const k = this.physWheel(w.obj.name);
          this.wheelAngle[k] -= pw.omega * dt;
          spin = this.wheelAngle[k];
          const rest = this.wheelRest[i];
          const travel = Math.max(-0.12, Math.min(0.12, this.phys.staticLen[k] - pw.len));
          w.obj.position.copy(rest.pos).addScaledVector(rest.up, travel);
        }
        w.obj.quaternion.copy(this.tmpQ.setFromAxisAngle(AXIS_Z, w.front ? this.steerAngle : 0)).multiply(this.tmpQ2.setFromAxisAngle(AXIS_X, spin)).multiply(w.base);
      });
    }
  }

  /** Physics wheel index for a model wheel node: 0 FL, 1 FR, 2 RL, 3 RR. */
  private physWheel(name: string) {
    return (name.includes("Rear") ? 2 : 0) + (name.endsWith("R") ? 1 : 0);
  }

  /** Each model wheel's rest position, and the car's up axis in its parent's frame. */
  private measureWheels() {
    if (!this.model) return;
    this.root.updateMatrixWorld(true);
    this.wheelRest = this.model.wheels.map((w) => {
      const toParent = new THREE.Matrix4().copy(w.obj.parent!.matrixWorld).invert().multiply(this.root.matrixWorld);
      return { pos: w.obj.position.clone(), up: new THREE.Vector3(0, 1, 0).transformDirection(toParent) };
    });
  }

  /** Rigid-body car: feed the controls in, read the state back out. */
  private stepPhysics(dt: number, inp: DriveInput, world: World, traffic?: TrafficSource) {
    const p = this.phys;
    const ps = this.spec.physics;
    // A real wheel is the steering wheel, 1:1 through the steering ratio. Keys
    // and pads get less lock at speed, capped near the tyres' grip limit, as in
    // every driving game.
    if (inp.device === "wheel") this.steerCmd = inp.steer;
    else {
      const v = Math.max(1, Math.abs(this.vf));
      const lock = Math.min(1, Math.atan(((ps.cgToFront + ps.cgToRear) * 0.8 * 9.81) / (v * v)) / ps.maxSteer);
      // The keys already ease in and out (wheel.ts); pads get a light rate limit.
      const target = inp.steer * lock;
      const rate = inp.device === "gamepad" ? 6 : 50;
      this.steerCmd += Math.max(-rate * dt, Math.min(rate * dt, target - this.steerCmd));
    }
    const net = world.net;
    const ground: GroundFn = (x, z) => {
      if (!net) return ROAD_Y;
      const hit = net.locate(x, z, null, ALLOW_PED);
      return hit && hit.lane.kind === LaneKind.Footpath && Math.abs(hit.lat) < hit.lane.width / 2 ? PATH_Y : ROAD_Y;
    };
    p.streamWalls();
    const cg = p.position;
    if (traffic) p.syncTraffic(traffic.nearCars(cg.x, cg.z, 40));
    p.step(dt, { throttle: inp.throttle, brake: inp.brake, handbrake: inp.handbrake, steer: this.steerCmd, selector: this.selector, parkBrake: this.parkBrake }, ground);

    const o = p.toWorld(this.origin);
    this.x = o.x;
    this.z = o.z;
    this.yaw = p.yaw;
    const lv = p.localVelocity();
    this.vf = lv.vf;
    this.vr = lv.vr;
    this.yawRate = lv.yawRate;
    this.steerAngle = this.steerCmd * ps.maxSteer;
    this.slip = Math.min(1, p.slip);
    this.impact = Math.max(this.impact, p.impact);
    this.rpm = p.rpm / (ps.redline + 300); // 0..1 for the engine sound
    this.gear = this.selector === "D" ? p.gear : this.selector === "R" ? 1 : 0;
    // Kerb strikes: a front wheel's ground height jumping, one side more than the other.
    const g = p.wheels.map((w) => w.ground);
    const dl = g[0] - this.lastGround[0], dr = g[1] - this.lastGround[1];
    this.kerbJolt = Math.abs(dl - dr) > 0.05 && Math.abs(this.vf) > 0.5 ? Math.sign(dr - dl) * 0.6 : 0;
    this.lastGround = g;
    // On its side or roof for a few seconds: put it back on its wheels.
    this.upsideDown = p.upY < 0.3 ? this.upsideDown + dt : 0;
    if (this.upsideDown > 3) {
      p.reset(o.x, o.z, this.yaw);
      this.upsideDown = 0;
    }
  }

  // Driver's head: sims hang the cockpit camera on a spring rather than bolting
  // it to the body (Rigs of Rods, Stunt Rally; Forza/AC "head movement").
  private head = { x: 0, z: 0, vx: 0, vz: 0, y: 0, pitch: 0, roll: 0, lastVf: 0, init: false };
  private camE = new THREE.Euler(0, 0, 0, "YXZ");
  private camQ = new THREE.Quaternion();
  private lookQ = new THREE.Quaternion();

  /**
   * Place a camera at the driver's eye (a point in the car's frame), looking
   * `look` radians left of ahead. The head keeps a level-ish horizon (35 % of
   * the body's pitch and roll, smoothed), rides out bumps, and sways against
   * acceleration, braking and cornering on a damped spring.
   */
  placeCamera(cam: THREE.Camera, ex: number, ey: number, ez: number, look: number, dt = 1 / 60) {
    this.root.updateMatrixWorld();
    const h = this.head;
    dt = Math.min(dt, 0.05);
    // Accelerations in the car's frame (m/s²): forward, and toward the left.
    const ax = dt > 0 ? (this.vf - h.lastVf) / dt : 0;
    h.lastVf = this.vf;
    const ay = this.vf * this.yawRate;
    // Spring-damper neck, about 1.3 Hz with damping ratio ~0.6; the head lags
    // behind the car: back under acceleration, forward under braking, outward in bends.
    const k = 70, c = 10;
    const tz = -Math.max(-12, Math.min(12, ax)) * 0.004, tx = -Math.max(-12, Math.min(12, ay)) * 0.003;
    h.vz += (k * (tz - h.z) - c * h.vz) * dt;
    h.vx += (k * (tx - h.x) - c * h.vx) * dt;
    h.z += h.vz * dt;
    h.x += h.vx * dt;
    const p = this.root.localToWorld(new THREE.Vector3(ex + h.x, ey, ez + h.z));
    // Smooth vertical jolts (kerbs, bumps) a little; the body still moves the eye.
    if (!h.init) h.y = p.y;
    h.y += (p.y - h.y) * Math.min(1, dt * 18);
    p.y = h.y;
    this.camE.setFromQuaternion(this.root.quaternion, "YXZ");
    const yaw = this.camE.y;
    h.pitch += (this.camE.x * 0.35 - h.pitch) * Math.min(1, dt * 8);
    h.roll += (this.camE.z * 0.35 - h.roll) * Math.min(1, dt * 8);
    h.init = true;
    this.camQ.setFromEuler(this.camE.set(h.pitch, yaw, h.roll, "YXZ"));
    // In that frame the camera faces forward (+z, so turned half a circle from
    // a camera's -z), turned by the look angle and tilted 2 degrees down.
    this.lookQ.setFromEuler(this.camE.set(-0.035, look + Math.PI, 0, "YXZ"));
    cam.position.copy(p);
    cam.quaternion.copy(this.camQ).multiply(this.lookQ);
  }

  /** Free the physics world (on getting out). */
  dispose() {
    this.phys.dispose();
  }

  /**
   * Hit a person. Vehicles are solid in the physics world; people aren't, so
   * this is the only contact handled here. A person barely slows a car.
   */
  hitPerson() {
    const v = this.phys.body.linvel();
    this.phys.body.setLinvel({ x: v.x * 0.92, y: v.y, z: v.z * 0.92 }, true);
    this.impact = Math.max(this.impact, Math.abs(this.vf) * 0.6);
  }

  /** Draw the car where the physics has it: the whole body pitches, rolls and rides on its springs. */
  private sync() {
    const { t, q } = this.phys.renderPose();
    const o = rotateAdd(q, this.origin, t);
    this.root.position.set(o.x, o.y, o.z);
    this.root.quaternion.set(q.x, q.y, q.z, q.w);
  }
}
