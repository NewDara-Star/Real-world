// The sat-nav (nav.ts) on real Finglas, headless.
import { Navigator } from "../src/client/nav";
import { ALLOW_CAR, ALLOW_SERVICE, LaneKind } from "../src/client/roadnet";
import { check, done, loadNet, within } from "./check";

const net = await loadNet("finglas");
const nav = new Navigator(net);

// Bug reproduced (found by the autodrive): starting part-way along a straight
// lane, the route began at the lane's far end, up to its whole length ahead,
// so the car looked off-route and it rerouted every 1.5 s.
const lanes = net.lanes.filter((l) => l.kind === LaneKind.Road && l.allow & ALLOW_CAR && !(l.allow & ALLOW_SERVICE) && l.junction < 0 && l.length > 80 && l.pts.length === 4);
const at = { x: 0, z: 0, dx: 0, dz: 0 };
let worst = 0, routed = 0;
for (const l of lanes.slice(0, 30)) {
  net.at(l, 20, at);
  const yaw = Math.atan2(at.dx, at.dz);
  const far = lanes[(lanes.indexOf(l) + 15) % lanes.length];
  if (!nav.route(at.x, at.z, yaw, { x: far.pts[0], z: far.pts[1], name: "test" })) continue;
  routed++;
  worst = Math.max(worst, Math.hypot(nav.path[0] - at.x, nav.path[1] - at.z));
  // A few seconds stood still at the start mustn't count as off the route.
  let rerouted = false;
  nav.onReroute = () => (rerouted = true);
  for (let i = 0; i < 90; i++) nav.update(1 / 30, at.x, at.z, yaw);
  if (rerouted) worst = Math.max(worst, 99);
}
check("routes were found", routed >= 20, `${routed} of 30`);
within("the route starts where the car is (worst of them)", worst, 0, 1, " m");
// Bug reproduced (found by the autodrive): the goal was one direction of the
// destination's street, so routes went to the end of a cul-de-sac to turn
// round onto the other side, over the kerb. Either side will do now.
const { readFileSync } = await import("node:fs");
const places = JSON.parse(readFileSync(new URL("../public/world/finglas.json", import.meta.url), "utf8")).places as { x: number; z: number; name: string }[];
const central = [...lanes].sort((a, b) => Math.hypot(a.pts[0], a.pts[1]) - Math.hypot(b.pts[0], b.pts[1]))[0];
net.at(central, 20, at);
let endTurns = 0, tried = 0;
for (const p of places.filter((_, i) => i % 4 === 0)) {
  if (!nav.route(at.x, at.z, Math.atan2(at.dx, at.dz), p)) continue;
  tried++;
  const last = nav.steps.length >= 2 ? nav.steps[nav.steps.length - 2].link : null;
  if (last && (last.dir === "t" || last.dir === "T")) endTurns++;
}
// Bug reproduced (found by the autodrive): a route that comes back past
// itself (round a block) made the progress jump up to ~140 m ahead, so the
// distance to the next turn was wrong. Drive each route in 2 m steps.
const { pointAt } = await import("../src/client/autodrive");
let worstJump = 0, drives = 0;
for (const p of places.filter((_, i) => i % 6 === 0)) {
  if (!nav.route(at.x, at.z, Math.atan2(at.dx, at.dz), p)) continue;
  drives++;
  const end = nav.pathCum[nav.pathCum.length - 2] ?? 0;
  for (let s = 0; s < end - 15; s += 2) {
    const [x, z] = pointAt(nav.path, nav.pathCum, s);
    const [x2, z2] = pointAt(nav.path, nav.pathCum, s + 1);
    nav.update(1 / 15, x, z, Math.atan2(x2 - x, z2 - z));
    if (nav.dest === null || nav.arrived) break;
    worstJump = Math.max(worstJump, nav.progress - s);
  }
}
within("progress follows the car along every route (worst lead)", worstJump, 0, 3, " m");
check("those were real drives", drives > 20, `${drives}`);
check("routes don't end with a U-turn to reach the other side of the street", tried > 30 && endTurns === 0, `${endTurns} of ${tried}`);
done();
