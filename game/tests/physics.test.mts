// The car physics against published figures (research/08-vehicle-physics.md):
// a VW Polo 1.0 TSI DSG for the test car, and a loaded HiAce-class danfo.
import { CarPhysics, DANFO, HATCH_AUTO, type CarSpec, type PhysicsInput } from "../src/client/carphysics";
import { initPhysics } from "../src/client/carphysics";
import { check, done, within } from "./check";

await initPhysics();
const flat = () => 0.03;
const dt = 1 / 60;
const base: PhysicsInput = { throttle: 0, brake: 0, handbrake: false, steer: 0, selector: "D", parkBrake: false };
const kmh = (c: CarPhysics) => c.localVelocity().vf * 3.6;

function car(spec: CarSpec = HATCH_AUTO, walls: Float32Array[] = []) {
  const c = new CarPhysics(spec, 0, 0, 0, walls);
  run(c, { selector: "P" }, 1); // settle on the springs
  return c;
}
/** Drive with these controls for up to `seconds`; stops early when `until` says so. Returns the time taken. */
function run(c: CarPhysics, inp: Partial<PhysicsInput>, seconds: number, until?: () => boolean) {
  for (let t = 0; t < seconds; t += dt) {
    c.step(dt, { ...base, ...inp }, flat);
    if (until?.()) return t + dt;
  }
  return seconds;
}

console.log("Polo (test car):");
{
  const c = car();
  run(c, { selector: "P" }, 2);
  within("sits at its ride height when parked", c.position.y, 0.55, 0.62, " m");
  within("doesn't drift when parked", Math.hypot(c.position.x, c.position.z), 0, 0.005, " m");
}
{
  const c = car();
  run(c, {}, 8);
  within("creeps in D with no pedals at walking pace", kmh(c), 4, 8, " km/h");
}
{
  const c = car();
  run(c, { brake: 0.4 }, 5);
  within("stays put in D with the brake held", Math.abs(c.position.z), 0, 0.01, " m");
}
{
  const c = car();
  run(c, { selector: "P", throttle: 1 }, 3);
  within("won't move in P, even flat out", Math.abs(kmh(c)), 0, 0.1, " km/h");
}
{
  const c = car();
  const t = run(c, { throttle: 1 }, 30, () => kmh(c) >= 100);
  within("0-100 km/h like a Polo DSG (published 10.2 s)", t, 8.5, 11.5, " s");
  check("drives straight under full throttle", Math.abs(c.position.x) < 0.05, `${c.position.x.toFixed(3)} m sideways`);
  const z0 = c.position.z;
  run(c, { brake: 1 }, 10, () => kmh(c) <= 0.5);
  within("stops from 100 km/h in a modern car's distance", c.position.z - z0, 34, 41, " m");
}
{
  const c = car();
  const shifts: number[] = [];
  let last = 1;
  run(c, { throttle: 0.3 }, 20, () => {
    if (c.gear !== last) shifts.push(c.gear > last ? kmh(c) : -1);
    last = c.gear;
    return false;
  });
  check("only shifts up when pulling away gently", shifts.every((v) => v > 0), shifts.map((v) => v.toFixed(0)).join(", "));
  within("first upshift comes early at light throttle", shifts[0] ?? 99, 10, 25, " km/h");
}
{
  const c = car();
  run(c, { throttle: 1 }, 30, () => kmh(c) >= 60);
  let peak = 0;
  for (let st = 0; st <= 0.6; st += 0.02) {
    run(c, { throttle: kmh(c) < 60 ? 0.6 : 0.2, steer: st }, 0.4);
    const v = c.localVelocity();
    peak = Math.max(peak, Math.abs(v.vf * v.yawRate) / 9.81);
  }
  within("grips about 0.9 g in a corner", peak, 0.82, 1.0, " g");
}
{
  const c = car();
  run(c, { throttle: 1 }, 30, () => kmh(c) >= 50);
  run(c, { throttle: 0.2, steer: 0.1 }, 1);
  check("steering right, the wheel pulls back toward centre", c.steerTorque < -1, `${c.steerTorque.toFixed(2)} N m`);
  run(c, { throttle: 0.2, steer: -0.1 }, 1);
  check("steering left, the wheel pulls back toward centre", c.steerTorque > 1, `${c.steerTorque.toFixed(2)} N m`);
}
{
  const c = car();
  run(c, { selector: "R", throttle: 0.3 }, 3);
  check("R drives backwards", kmh(c) < -3, `${kmh(c).toFixed(1)} km/h`);
}
{
  const wall = new Float32Array([-10, 30, 10, 30, 10, 40, -10, 40]);
  const c = car(HATCH_AUTO, [wall]);
  c.streamWalls();
  run(c, { throttle: 1 }, 10, () => kmh(c) >= 30);
  let impact = 0;
  run(c, {}, 4, () => {
    impact = Math.max(impact, c.impact);
    return false;
  });
  check("a wall stops the car at the wall", c.position.z < 29 && c.position.z > 26, `front stopped at z ${c.position.z.toFixed(2)}, wall at 30`);
  within("the crash is reported at about the speed it hit", impact, 6, 11, " m/s");
}
{
  // A front garden wall (0.9 m, from gardens.ts via World.gardenColliders) belongs to
  // a house far behind it; it streams in with that house and stops the car.
  const house = new Float32Array([-5, 40, 5, 40, 5, 48, -5, 48]);
  const c = new CarPhysics(HATCH_AUTO, 0, 0, 0, [house], (i) => (i === 0 ? [-6, 25, 6, 25, 0.9, 0.3] : []));
  run(c, { selector: "P" }, 1);
  c.streamWalls();
  run(c, { throttle: 0.5 }, 10, () => kmh(c) >= 20);
  run(c, {}, 4);
  check("a low garden wall stops the car", c.position.z < 25 && c.position.z > 21, `stopped at z ${c.position.z.toFixed(2)}, wall at 25`);
  check("and the car stays on its wheels", c.upY > 0.9, `up ${c.upY.toFixed(2)}`);
}
{
  // Tragedy path: a long drive (10 minutes of game time) mustn't blow up or drift.
  const c = car();
  run(c, { throttle: 0.4, steer: 0.15 }, 600);
  const p = c.position;
  check("ten minutes of driving in circles stays sane", Number.isFinite(p.x) && Number.isFinite(p.z) && p.y > 0.3 && p.y < 1 && c.upY > 0.9, `y ${p.y.toFixed(2)}, up ${c.upY.toFixed(2)}`);
}
{
  // Idiot path: R selected at 50 km/h going forward. The box must not explode the car.
  const c = car();
  run(c, { throttle: 1 }, 30, () => kmh(c) >= 50);
  run(c, { selector: "R", throttle: 1 }, 5);
  check("R at speed slows the car instead of flipping or launching it", c.upY > 0.9 && Math.abs(kmh(c)) < 60, `${kmh(c).toFixed(0)} km/h`);
}

console.log("Danfo:");
{
  const c = car(DANFO);
  run(c, { selector: "P" }, 2);
  within("sits at its ride height when parked", c.position.y, 0.75, 0.9, " m");
  const d = car(DANFO);
  run(d, {}, 8);
  within("creeps in D", kmh(d), 3, 8, " km/h");
  const e = car(DANFO);
  const t = run(e, { throttle: 1 }, 40, () => kmh(e) >= 60);
  within("0-60 km/h like a loaded old minibus", t, 7, 16, " s");
  const z0 = e.position.z;
  run(e, { brake: 1 }, 10, () => kmh(e) <= 0.5);
  within("stops from 60 km/h", e.position.z - z0, 12, 22, " m");
}

done();
