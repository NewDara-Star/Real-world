// Headless checks of the car physics against published figures
// (research/08-vehicle-physics.md). Run: npx tsx tools/physics-test.mts
import { CarPhysics, HATCH_AUTO, initPhysics, type PhysicsInput } from "../src/client/carphysics";

await initPhysics();
const flat = () => 0.03;
const dt = 1 / 60;
const base: PhysicsInput = { throttle: 0, brake: 0, handbrake: false, steer: 0, selector: "D", parkBrake: false };
const kmh = (c: CarPhysics) => c.localVelocity().vf * 3.6;

function car() {
  return new CarPhysics(HATCH_AUTO, 0, 0, 0, []);
}
function run(c: CarPhysics, inp: Partial<PhysicsInput>, seconds: number, each?: (t: number) => boolean | void) {
  for (let t = 0; t < seconds; t += dt) {
    c.step(dt, { ...base, ...inp }, flat);
    if (each?.(t)) return t;
  }
  return seconds;
}

// Settle on the springs.
{
  const c = car();
  run(c, { selector: "P" }, 3);
  const p = c.position;
  console.log(`settle: CG height ${p.y.toFixed(3)} m, drift ${Math.hypot(p.x, p.z).toFixed(4)} m, loads ${c.wheels.map((w) => w.load.toFixed(0)).join("/")}`);
}

// Creep in D, no pedals.
{
  const c = car();
  run(c, { selector: "P" }, 1);
  run(c, {}, 8);
  console.log(`creep: ${kmh(c).toFixed(1)} km/h (target 5-7), gear ${c.gear}, rpm ${c.rpm.toFixed(0)}`);
}

// Standing still in D on the brake.
{
  const c = car();
  run(c, { selector: "P" }, 1);
  run(c, { brake: 0.4 }, 5);
  const p = c.position;
  console.log(`held on brake in D: ${kmh(c).toFixed(3)} km/h, moved ${p.z.toFixed(3)} m`);
}

// 0-100 km/h, full throttle.
{
  const c = car();
  run(c, { selector: "P" }, 1);
  const t = run(c, { throttle: 1 }, 30, () => kmh(c) >= 100);
  const p = c.position;
  console.log(`0-100: ${t.toFixed(2)} s (target ~10), gear ${c.gear}, rpm ${c.rpm.toFixed(0)}, distance ${p.z.toFixed(0)} m, wander ${p.x.toFixed(3)} m`);

  // 100-0 km/h, full brake.
  const z0 = c.position.z;
  const tb = run(c, { brake: 1 }, 10, () => kmh(c) <= 0.5);
  console.log(`100-0: ${(c.position.z - z0).toFixed(1)} m in ${tb.toFixed(2)} s (target ~37 m)`);
}

// Top speed check in 20 s and a gear trace.
{
  const c = car();
  run(c, { selector: "P" }, 1);
  const trace: string[] = [];
  let last = 1;
  run(c, { throttle: 1 }, 40, (t) => {
    if (c.gear !== last) trace.push(`${last}->${c.gear}@${kmh(c).toFixed(0)}`);
    last = c.gear;
    void t;
  });
  console.log(`40 s flat out: ${kmh(c).toFixed(0)} km/h; shifts ${trace.join(" ")}`);
}

// Gentle drive away: 30 % throttle.
{
  const c = car();
  run(c, { selector: "P" }, 1);
  const trace: string[] = [];
  let last = 1;
  run(c, { throttle: 0.3 }, 20, () => {
    if (c.gear !== last) trace.push(`${last}->${c.gear}@${kmh(c).toFixed(0)}`);
    last = c.gear;
  });
  console.log(`30% throttle 20 s: ${kmh(c).toFixed(0)} km/h, rpm ${c.rpm.toFixed(0)}; shifts ${trace.join(" ")}`);
}

// Steady-state cornering: hold speed with throttle, wind on steering.
{
  const c = car();
  run(c, { selector: "P" }, 1);
  run(c, { throttle: 1 }, 30, () => kmh(c) >= 60);
  let peak = 0;
  let maxSlip = 0;
  for (let st = 0; st <= 0.6; st += 0.02) {
    run(c, { throttle: kmh(c) < 60 ? 0.6 : 0.2, steer: st }, 0.4);
    const v = c.localVelocity();
    const ay = Math.abs(v.vf * v.yawRate) / 9.81;
    peak = Math.max(peak, ay);
    maxSlip = Math.max(maxSlip, c.slip);
  }
  const v = c.localVelocity();
  console.log(`cornering at ~60: peak ${peak.toFixed(2)} g (target 0.85-0.9), end speed ${(v.vf * 3.6).toFixed(0)} km/h, slip ${maxSlip.toFixed(2)}`);
}

// Steering torque sign: steer right at 50 km/h, the wheel should want to centre (negative).
{
  const c = car();
  run(c, { selector: "P" }, 1);
  run(c, { throttle: 1 }, 30, () => kmh(c) >= 50);
  run(c, { throttle: 0.2, steer: 0.1 }, 1);
  console.log(`self-aligning at 50 km/h, steer right 0.1: ${c.steerTorque.toFixed(2)} N m at the rim (should be negative)`);
  run(c, { throttle: 0.2, steer: -0.1 }, 1);
  console.log(`steer left 0.1: ${c.steerTorque.toFixed(2)} N m (should be positive), yaw ${c.yaw.toFixed(2)}`);
}

// Reverse.
{
  const c = car();
  run(c, { selector: "P" }, 1);
  run(c, { selector: "R", throttle: 0.3 }, 6);
  console.log(`reverse 30% 6 s: ${kmh(c).toFixed(1)} km/h`);
}

// Park: try to push with throttle in P.
{
  const c = car();
  run(c, { selector: "P", throttle: 1 }, 3);
  console.log(`P with throttle: ${kmh(c).toFixed(3)} km/h, rpm ${c.rpm.toFixed(0)}`);
}

// Hit a wall at 30 km/h.
{
  const wall = new Float32Array([-10, 30, 10, 30, 10, 40, -10, 40]);
  const c = new CarPhysics(HATCH_AUTO, 0, 0, 0, [wall]);
  c.streamWalls();
  run(c, { selector: "P" }, 1);
  run(c, { throttle: 1 }, 10, () => kmh(c) >= 30);
  let impact = 0;
  run(c, { throttle: 0 }, 4, () => {
    impact = Math.max(impact, c.impact);
  });
  console.log(`wall: impact ${impact.toFixed(1)} m/s, stopped at z ${c.position.z.toFixed(2)} (wall at 30), speed ${kmh(c).toFixed(1)} km/h`);
}
