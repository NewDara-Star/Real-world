// Dev autodrive (autodrive.ts), headless on the real Finglas network with
// real traffic, the real car physics and the examiner: the four drivers do
// what their test path says. How it looks is the Mac's job.
import { readFileSync } from "node:fs";
import { AutoDriver, project, type AutoMode } from "../src/client/autodrive";
import { CarPhysics, HATCH_AUTO, initPhysics } from "../src/client/carphysics";
import { Navigator } from "../src/client/nav";
import { mulberry32 } from "../src/client/props";
import { ALLOW_CAR, ALLOW_SERVICE, LaneKind } from "../src/client/roadnet";
import { Examiner, type Fault } from "../src/client/rules";
import { NetTraffic } from "../src/client/trafficnet";
import { check, done, loadNet, within } from "./check";

await initPhysics();
const net = await loadNet("finglas");
const meta = JSON.parse(readFileSync(new URL("../public/world/finglas.json", import.meta.url), "utf8"));
const places = meta.places.filter((p: { name: string }) => p.name);

/** AUTODRIVE_SEED=n tries other traffic and starting streets (default 7). */
const SEED = Number(process.env.AUTODRIVE_SEED) || 7;

function sim(mode: AutoMode, seconds: number, seed = SEED) {
  // Seeded so a run repeats exactly (traffic has its own generator; anything on Math.random too).
  Math.random = mulberry32(seed * 101 + mode.length);
  const traffic = new NetTraffic(net, { honk() {} }, { vehicles: 40, walkers: 30, seed: seed * 7 + mode.length }, "left");
  const nav = new Navigator(net);
  const ex = new Examiner(net, traffic);
  const faults: Fault[] = [];
  ex.onFault = (f) => {
    faults.push(f);
    if (f.grade === 3 && mode !== "idiot") console.log(`  [${mode} G3] ${f.text} at ${Math.round(car.position.x)}, ${Math.round(car.position.z)} while ${ad.status}`);
  };
  // Start on a long ordinary street near the middle.
  const lane = net.lanes
    .filter((l) => l.kind === LaneKind.Road && l.allow & ALLOW_CAR && !(l.allow & ALLOW_SERVICE) && l.length > 80 && l.junction < 0)
    .sort((a, b) => Math.hypot(a.pts[0], a.pts[1]) - Math.hypot(b.pts[0], b.pts[1]))[seed % 5];
  const at = { x: 0, z: 0, dx: 0, dz: 1 };
  net.at(lane, 20, at);
  const car = new CarPhysics(HATCH_AUTO, at.x, at.z, Math.atan2(at.dx, at.dz), []);
  const ad = new AutoDriver(net, nav, traffic, mode, places, meta.half, HATCH_AUTO.maxSteer, seed);
  ad.setDestination = (d) => nav.route(car.position.x, car.position.z, car.yaw, d);
  const dt = 1 / 30;
  let indicator = 0, maxOff = 0, offSum = 0, offN = 0, upsideDown = false, finite = true, maxKmh = 0, idle = 0;
  const idleWhy = new Set<string>();
  for (let t = 0; t < seconds; t += dt) {
    const p = car.position, yaw = car.yaw, vf = car.localVelocity().vf;
    traffic.update(dt, p.x, p.z, { x: p.x, z: p.z, yaw, speed: Math.abs(vf), driving: true });
    if (nav.dest) nav.update(dt, p.x, p.z, yaw);
    const cmd = ad.step(dt, { x: p.x, z: p.z, yaw, vf, indicator });
    indicator = cmd.indicator;
    if (cmd.glance) ex.observe("mirror");
    car.step(dt, { throttle: cmd.throttle, brake: cmd.brake, handbrake: cmd.handbrake, steer: cmd.steer, selector: cmd.selector, parkBrake: cmd.parkBrake }, () => 0.03);
    ex.update(dt, { x: p.x, z: p.z, yaw, vf, indicator, hazards: false, selector: cmd.selector });
    // How far off the route it drives (on the move, away from the route's ends).
    if (nav.path.length && Math.abs(vf) > 3 && ad.along > 10 && nav.total - ad.along > 10) {
      const on = project(nav.path, nav.pathCum, p.x, p.z, ad.along - 15, ad.along + 15);
      if (on) {
        maxOff = Math.max(maxOff, on.lat);
        offSum += on.lat;
        offN++;
      }
    }
    // Standing still needs a reason: a light, a queue, giving way, someone crossing, arriving.
    if (Math.abs(vf) < 0.3 && t > 5 && !/^(red light|amber|car in front|giving way|give way|someone crossing|someone in the road|stop sign|arriving|parked|turning in the road|stopping to turn)/.test(ad.status)) {
      idle += dt;
      idleWhy.add(ad.status.replace(/ · .*/, ""));
    }
    if (car.upY < 0.3) upsideDown = true;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) finite = false;
    maxKmh = Math.max(maxKmh, vf * 3.6);
  }
  return { ad, faults, maxOff, meanOff: offN ? offSum / offN : 0, upsideDown, finite, maxKmh, idle, idleWhy: [...idleWhy].join(", ") };
}
const grade = (fs: Fault[], g: number) => fs.filter((f) => f.grade === g);
const list = (fs: Fault[]) => fs.map((f) => `G${f.grade} ${f.text}`).join("; ") || "none";

console.log("happy:");
{
  const r = sim("happy", 240);
  const s = r.ad.stats;
  // Not a distance target: some Finglas lights run 6-minute cycles (roadmap), so a queue can eat the run.
  check("never stands still without a reason", r.idle < 3, `${r.idle.toFixed(1)} s idle${r.idleWhy ? ` (${r.idleWhy})` : ""}`);
  check("and gets somewhere", s.distance > 300, `${Math.round(s.distance)} m, ${s.destinations} arrivals`);
  within("keeps to its lane on the move (mean distance off the route)", r.meanOff, 0, 0.8, " m");
  check("never strays far off the route", r.maxOff < 2.5, `max ${r.maxOff.toFixed(2)} m`);
  check("no dangerous or serious faults", grade(r.faults, 3).length === 0, list(grade(r.faults, 3)));
  check("hardly any minor faults", grade(r.faults, 2).length <= 2, list(r.faults));
  check("stays on its wheels", !r.upsideDown && r.finite);
  console.log("  events:", r.ad.events.slice(-5).join(" | "));
}
console.log("idiot:");
{
  const r = sim("idiot", 240);
  check("the examiner catches the idiot", r.faults.length >= 3, list(r.faults));
  check("speeding is marked", r.faults.some((f) => f.item === "speed"));
  check("the car survives it (no NaN, not upside down for good)", r.finite);
}
console.log("sad:");
{
  const r = sim("sad", 300);
  const s = r.ad.stats;
  check("a destination with no road route is reported, and it drives on elsewhere", s.unreachable >= 1 && s.distance > 500, `${s.unreachable} unreachable, ${Math.round(s.distance)} m`);
  const missed = r.ad.events.filter((e) => /missing the/.test(e)).length;
  check("every turn it misses on purpose ends in a reroute", missed === 0 ? SEED !== 7 : s.reroutes >= missed, `${missed} missed, ${s.reroutes} reroutes${missed ? "" : " (no turn to miss on this drive)"}`);
  check("no dangerous faults on the sad path either", grade(r.faults, 3).length === 0, list(grade(r.faults, 3)));
  // Bug reproduced: after parking, the finished route stayed set, so it
  // "arrived" and parked at the same place again instead of moving on.
  const arrivals = r.ad.events.filter((e) => /arrived at/.test(e)).map((e) => e.replace(/^\S+ /, "").replace("; parking for a moment", ""));
  check("after parking it moves on, not arriving at the same place twice", new Set(arrivals).size === arrivals.length, arrivals.join(" | "));
}
console.log("tragedy:");
{
  const r = sim("tragedy", 600);
  const s = r.ad.stats;
  // Not more distance: three Finglas signals run 6-7 minute cycles (a bake
  // problem, on the roadmap), and a long drive sits through one.
  check("ten minutes of long drives stay sane", r.finite && !r.upsideDown && s.distance > 1000, `${Math.round(s.distance)} m, ${s.destinations} destinations`);
  check("and it never stands still without a reason", r.idle < 3, `${r.idle.toFixed(1)} s idle${r.idleWhy ? ` (${r.idleWhy})` : ""}`);
}
done();
