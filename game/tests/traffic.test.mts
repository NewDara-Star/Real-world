// AI traffic and pedestrians on the real Finglas network, simulated headless
// for three minutes of game time: they obey signals, people stay off car lanes,
// cars don't drive through each other.
import { check, done, loadNet, within } from "./check";
import { LaneKind } from "../src/client/roadnet";
import { NetTraffic } from "../src/client/trafficnet";

const net = await loadNet("finglas");
const t = new NetTraffic(net, { honk() {} }, { vehicles: 70, walkers: 110 });
const dt = 1 / 30;
let redRuns = 0, entries = 0, pedSamples = 0, pedOnRoad = 0, overlaps = 0, moving = 0, samples = 0;
const prevVia = new Map<object, number>();
for (let i = 0; i < 30 * 180; i++) {
  t.update(dt, 0, 0, { x: 0, z: 0, yaw: 0, speed: 0, driving: false });
  for (const c of t.cars) {
    if (!c.active) continue;
    // Entering a junction (first via lane): was the light red?
    if (c.via === 0 && prevVia.get(c) === -1 && c.link && c.link.tl >= 0) {
      entries++;
      if (net.signalState(c.link.tl, c.link.li, t.time) === "r") redRuns++;
    }
    prevVia.set(c, c.via);
  }
  for (const p of t.peds) {
    if (!p.active || p.area || !p.lane) continue;
    pedSamples++;
    if (p.lane.kind !== LaneKind.Footpath && p.lane.kind !== LaneKind.Crossing) pedOnRoad++;
  }
  if (i % 150 === 0) {
    const act = t.cars.filter((c) => c.active);
    for (let a = 0; a < act.length; a++) for (let b = a + 1; b < act.length; b++) if (Math.hypot(act[a].x - act[b].x, act[a].z - act[b].z) < 1.5) overlaps++;
    moving += act.filter((c) => c.v > 1).length / (act.length || 1);
    samples++;
  }
}
check("cars went through signalled junctions", entries > 20, `${entries} entries`);
check("no car ran a red light", redRuns === 0, `${redRuns} of ${entries}`);
within("pedestrians stay on footpaths and crossings", pedOnRoad / (pedSamples || 1), 0, 0.001);
check("cars don't drive through each other", overlaps <= 2, `${overlaps} close pairs over ${samples} samples`);
within("traffic keeps moving (share of cars above walking pace)", moving / samples, 0.3, 1);
done();
