// The examiner (rules.ts) on a real Finglas signalled junction: a careless
// drive (too fast, no signal, no mirrors, through the red) collects faults; a
// careful one (signal, mirrors, wait for green) collects none.
import { check, done, loadNet } from "./check";
import { NetTraffic } from "../src/client/trafficnet";
import { Examiner } from "../src/client/rules";

const net = await loadNet("finglas");
const lane = net.lanes.find((l) => l.kind === 0 && l.length > 80 && l.out.some((k) => net.links[k].tl >= 0 && net.links[k].dir === "l" && net.links[k].vias.length))!;
const link = lane.out.map((k) => net.links[k]).find((L) => L.tl >= 0 && L.dir === "l")!;
const path = [lane, ...link.vias.map((v) => net.lanes[v]), net.lanes[link.to]];
const pt = { x: 0, z: 0, dx: 0, dz: 1 };
type Plan = (s: number, light: string, distLeft: number) => { v: number; ind: number; glance: boolean };

function drive(plan: Plan) {
  const traffic = new NetTraffic(net, { honk() {} }, { vehicles: 0, walkers: 0 });
  const ex = new Examiner(net, traffic);
  const faults: { grade: number; text: string }[] = [];
  ex.onFault = (f) => faults.push(f);
  let li = 0, s = 0;
  const dt = 1 / 30;
  for (let i = 0; i < 30 * 200 && li < path.length; i++) {
    const light = net.signalState(link.tl, link.li, traffic.time);
    const p = plan(s, light, li === 0 ? path[0].length - s : -1);
    s += p.v * dt;
    while (li < path.length && s > path[li].length) s -= path[li++].length;
    if (li >= path.length) break;
    net.at(path[li], s, pt);
    const yaw = Math.atan2(pt.dx, pt.dz);
    traffic.update(dt, pt.x, pt.z, { x: pt.x, z: pt.z, yaw, speed: p.v, driving: true });
    if (p.glance) ex.observe("mirror");
    ex.update(dt, { x: pt.x, z: pt.z, yaw, vf: p.v, indicator: p.ind, hazards: false, selector: "D" });
  }
  return faults;
}

const careless = drive(() => ({ v: lane.speed * 1.25, ind: 0, glance: false }));
check("a careless drive collects faults", careless.length >= 2, careless.map((f) => `G${f.grade} ${f.text}`).join("; "));
check("speeding is marked", careless.some((f) => /speed/i.test(f.text)));

const careful = drive((_s, light, dist) => {
  const stopping = dist >= 0 && dist < 25 && light !== "G" && light !== "g";
  const v = stopping ? Math.max(0, Math.min(lane.speed * 0.9, (dist - 2) * 0.6)) : lane.speed * 0.85;
  return { v, ind: dist >= 0 && dist < 90 ? -1 : 0, glance: dist >= 0 && ((dist < 40 && dist > 30) || (dist < 6 && (light === "G" || light === "g"))) };
});
check("a careful drive collects no faults", careful.length === 0, careful.map((f) => `G${f.grade} ${f.text}`).join("; ") || "none");
done();
