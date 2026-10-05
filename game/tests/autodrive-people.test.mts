// The dev autodrive stops for a person in the road anywhere on its route, not
// only on the crossing of the next junction. Bug reproduced (Mac screenshot
// runs, happy/004 and happy-medium/003): the happy driver hit people stepping
// across a business-park exit because it only asked "is anyone on the crossing
// of the link I'm about to enter?".
import { readFileSync } from "node:fs";
import { AutoDriver, pointAt } from "../src/client/autodrive";
import { CarPhysics, HATCH_AUTO, initPhysics } from "../src/client/carphysics";
import { Navigator } from "../src/client/nav";
import { mulberry32 } from "../src/client/props";
import { ALLOW_CAR, ALLOW_SERVICE, LaneKind } from "../src/client/roadnet";
import { NetTraffic } from "../src/client/trafficnet";
import { check, done, loadNet } from "./check";

await initPhysics();
const net = await loadNet("finglas");
const meta = JSON.parse(readFileSync(new URL("../public/world/finglas.json", import.meta.url), "utf8"));
const places = meta.places.filter((p: { name: string }) => p.name);

/** Drive at speed, then put one person in the road `ahead` metres along the route; how close does the car get? */
function approach(ahead: number, standing: { onFootpath: boolean; lateral: number }) {
  Math.random = mulberry32(11);
  const traffic = new NetTraffic(net, { honk() {} }, { vehicles: 0, walkers: 0, seed: 3 }, "left");
  const nav = new Navigator(net);
  const lane = net.lanes.filter((l) => l.kind === LaneKind.Road && l.allow & ALLOW_CAR && !(l.allow & ALLOW_SERVICE) && l.length > 150 && l.junction < 0)[0];
  const at = { x: 0, z: 0, dx: 0, dz: 1 };
  net.at(lane, 10, at);
  const car = new CarPhysics(HATCH_AUTO, at.x, at.z, Math.atan2(at.dx, at.dz), []);
  const ad = new AutoDriver(net, nav, traffic, "happy", places, meta.half, HATCH_AUTO.maxSteer, 3);
  ad.setDestination = (d) => nav.route(car.position.x, car.position.z, car.yaw, d);
  const dt = 1 / 30;
  let indicator = 0, placed = false, minGap = Infinity, stoppedFor = false, px = 0, pz = 0;
  const footpath = net.lanes.find((l) => l.kind === LaneKind.Footpath)!;
  for (let t = 0; t < 40; t += dt) {
    const p = car.position, yaw = car.yaw, vf = car.localVelocity().vf;
    traffic.update(dt, p.x, p.z, { x: p.x, z: p.z, yaw, speed: Math.abs(vf), driving: true });
    // The traffic step puts walkers back on their lane; this one stands still where it was put.
    if (placed) Object.assign(traffic.peds[traffic.peds.length - 1], { x: px, z: pz });
    if (nav.dest) nav.update(dt, p.x, p.z, yaw);
    if (!placed && vf > 7 && nav.path.length) {
      // Someone standing still in the road (or at the kerb), `ahead` m along the route.
      const [x, z] = pointAt(nav.path, nav.pathCum, ad.along + ahead);
      const [x2, z2] = pointAt(nav.path, nav.pathCum, ad.along + ahead + 1);
      const len = Math.hypot(x2 - x, z2 - z) || 1;
      const ox = -(z2 - z) / len * standing.lateral, oz = (x2 - x) / len * standing.lateral;
      traffic.peds.push({ kind: 0, active: true, lane: standing.onFootpath ? footpath : lane, s: 0, dir: 1, off: 0, v: 0, area: null, waiting: 0, knocked: 0, x: x + ox, z: z + oz, yaw: 0, phase: 0 } as never);
      [px, pz] = [x + ox, z + oz];
      placed = true;
    }
    const cmd = ad.step(dt, { x: p.x, z: p.z, yaw, vf, indicator });
    indicator = cmd.indicator;
    car.step(dt, { throttle: cmd.throttle, brake: cmd.brake, handbrake: cmd.handbrake, steer: cmd.steer, selector: cmd.selector, parkBrake: cmd.parkBrake }, () => 0.03);
    if (placed) {
      const w = traffic.peds[traffic.peds.length - 1];
      minGap = Math.min(minGap, Math.hypot(w.x - car.position.x, w.z - car.position.z));
      if (/someone in the road/.test(ad.status) && Math.abs(vf) < 0.3) stoppedFor = true;
    }
  }
  return { placed, minGap, stoppedFor };
}

const inRoad = approach(30, { onFootpath: false, lateral: 0 });
check("a person was put in the road ahead of the moving car", inRoad.placed);
check("it stops for someone standing in the road on its route", inRoad.stoppedFor);
check("and stops short of them (car centre stays over 3 m away)", inRoad.minGap > 3, `${inRoad.minGap.toFixed(1)} m`);
const onPath = approach(30, { onFootpath: true, lateral: 2.5 });
check("someone on the footpath beside the route doesn't stop it", !onPath.stoppedFor && onPath.minGap < 3, `closest ${onPath.minGap.toFixed(1)} m`);
done();
