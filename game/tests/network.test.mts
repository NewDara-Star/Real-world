// The baked Finglas road network carries what the driving test turns on:
// roundabouts, mini-roundabouts with give-way-to-the-right, multi-lane roads,
// signals, real speed limits. Guards against a bake silently falling back to
// the Overture rebuild, which has none of these.
import { check, done, loadNet, within } from "./check";
import { LaneKind } from "../src/client/roadnet";

const net = await loadNet("finglas");
const ring = net.junctions.filter((j) => j.roundabout).length;
const minis = net.junctions.filter((j) => j.mini);
check("Finglas has its roundabouts", ring >= 20, `${ring} roundabout junctions`);
check("Finglas has its mini-roundabouts", minis.length >= 15, `${minis.length}`);
check("mini-roundabouts are give-way-to-the-right junctions", minis.every((j) => net.junctionTypeName(net.junctions.indexOf(j)) === "right_before_left"),
  minis.map((j) => net.junctionTypeName(net.junctions.indexOf(j))).filter((t) => t !== "right_before_left").join(", ") || "all");
// The rule itself, from the junction's right-of-way matrix: at a priority
// junction the main road's approaches yield to nobody; at a mini-roundabout
// everyone gives way to the right, so at most one approach (the one with no
// road on its right, at a T) has nobody to yield to.
let freeApproachesMax = 0;
for (const j of minis) {
  const free = new Map<number, boolean>(); // approach edge -> yields to nobody so far
  j.links.forEach((lid, req) => {
    if (lid < 0) return;
    const L = net.links[lid];
    const edge = net.lanes[L.from].edge;
    const yields = j.resp[req].some((b) => b !== 0);
    free.set(edge, (free.get(edge) ?? true) && !yields);
  });
  freeApproachesMax = Math.max(freeApproachesMax, [...free.values()].filter(Boolean).length);
}
check("at mini-roundabouts no main road has right of way (at most one approach yields to nobody)", freeApproachesMax <= 1, `worst junction: ${freeApproachesMax} free approaches`);

const multi = net.edges.filter((e) => net.carLanes(e).length >= 2).length;
check("main roads have more than one lane each way", multi >= 100, `${multi} multi-lane road sections`);
const signals = new Set(net.links.filter((l) => l.tl >= 0).map((l) => l.tl)).size;
within("signalled junctions", signals, 50, 200);
const limits = new Set(net.lanes.filter((l) => l.kind === LaneKind.Road).map((l) => Math.round(l.speed * 3.6)));
check("speed limits come in Irish values (30, 50, 60, 80 km/h)", [30, 50, 60].every((v) => limits.has(v)), [...limits].sort((a, b) => a - b).join(", "));
done();
