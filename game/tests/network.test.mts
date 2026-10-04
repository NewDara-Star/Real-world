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
// Who gives way to whom, measured from geometry: for every pair of links
// where A must yield to B, is B coming from A's right or A's left? In left-hand
// traffic everyone at a roundabout gives way to the right. (This caught the
// bake giving Finglas yield-to-the-LEFT: 248 pairs to 11.)
const pt = { x: 0, z: 0, dx: 0, dz: 1 };
function yieldSides(want: (j: (typeof net.junctions)[number]) => boolean) {
  let right = 0, left = 0;
  net.junctions.forEach((J, j) => {
    if (!want(J)) return;
    for (let a = 0; a < J.links.length; a++) for (let b = 0; b < J.links.length; b++) {
      if (a === b || J.links[a] < 0 || J.links[b] < 0 || !net.yieldsTo(j, a, b)) continue;
      const A = net.links[J.links[a]], B = net.links[J.links[b]];
      const la = net.lanes[A.from], lb = net.lanes[B.from];
      if (la.edge === lb.edge || net.lanes[A.to].kind !== net.lanes[B.to].kind) continue;
      const pa = { ...net.at(la, la.length, pt) }, pb = { ...net.at(lb, lb.length, pt) };
      // A's right in x-east/z-south is (-dz, dx).
      const onRight = (pb.x - pa.x) * -pa.dz + (pb.z - pa.z) * pa.dx;
      const crossing = pb.dx * pa.dz - pb.dz * pa.dx; // B heading toward A's left
      if (crossing > 0.5 && onRight > 0) right++;
      else if (crossing < -0.5 && onRight < 0) left++;
    }
  });
  return { right, left };
}
const mini = yieldSides((j) => j.mini);
within("at mini-roundabouts, drivers give way to the right (share of yields)", mini.right / Math.max(1, mini.right + mini.left), 0.9, 1);
const ringYields = yieldSides((j) => j.roundabout);
within("on roundabouts, entering drivers give way to the right", ringYields.right / Math.max(1, ringYields.right + ringYields.left), 0.9, 1);
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
