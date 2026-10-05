// Traffic doesn't swing into the oncoming lane round a player who is waiting.
// Bug reproduced (Mac screenshot run svc/005-006, and headless: 17 times in 80
// minutes of autodrive, all while the player waited at a red light, for
// people crossing or in a queue): a car stuck 3 s behind the stopped player
// pulled out and drove up the wrong side. The rules now follow Autoware's
// static obstacle avoidance (research 21): pass a stopped car only if it's
// parked (pulled in to the kerb) or has sat in the lane for no reason, never
// near a stop line, inside a junction or in a queue, and only when the
// oncoming lane is clear.
import { EDGE_TWO_WAY, LaneKind, type Lane } from "../src/client/roadnet";
import { NetTraffic } from "../src/client/trafficnet";
import { check, done, loadNet } from "./check";

const net = await loadNet("finglas");
const pt = { x: 0, z: 0, dx: 0, dz: 1 };

/** Long, nearly straight two-way street lanes away from the middle's busy roads. */
const straight = (l: Lane) => {
  const a = net.at(l, 10, { ...pt }), b = net.at(l, l.length - 10, { ...pt });
  return Math.hypot(b.x - a.x, b.z - a.z) > (l.length - 20) * 0.97;
};
const streets = net.lanes.filter((l) => l.kind === LaneKind.Road && l.edge >= 0 && net.edges[l.edge].flags & EDGE_TWO_WAY && l.length > 160 && l.out.length && straight(l));

/**
 * The player stopped on `lane` at `s` (`lat` m toward the kerb), one car put
 * 25 m behind at 8 m/s; `oncoming` puts a car coming the other way. Returns
 * whether it went round, when, the honks, and the closest it came.
 */
function run(lane: Lane, s: number, lat: number, seconds: number, oncoming = false) {
  const honks: number[] = [];
  const t = new NetTraffic(net, { honk: () => honks.push(t.time) }, { vehicles: 14, walkers: 0, seed: 3 }, "left");
  const p = net.at(lane, s, { ...pt });
  const player = { x: p.x + p.dz * lat, z: p.z - p.dx * lat, yaw: Math.atan2(p.dx, p.dz), speed: 0, driving: true };
  t.update(1 / 30, player.x, player.z, player);
  // Everyone else out of the way; our car behind the player.
  for (const c of t.cars) c.active = false;
  const [car, foe] = t.cars;
  const place = (c: typeof car, l: Lane, at: number, v: number) => {
    Object.assign(c, { active: true, lane: l, s: at, via: -1, v, lat: 0, latTarget: 0, mode: "drive", modeT: 0, stopDone: 0, wait: 0, go: true, blockedByPlayer: 0, bumped: 0, honk: 0 });
    c.link = (t as unknown as { pickLink(l: Lane): typeof c.link }).pickLink(l);
    const q = net.at(l, at, { ...pt });
    Object.assign(c, { x: q.x, z: q.z, yaw: Math.atan2(q.dx, q.dz) });
  };
  place(car, lane, s - 25, 8);
  if (oncoming) {
    // The nearest lane running the other way beside ours.
    const back = net.lanes.filter((l) => l.kind === LaneKind.Road && l.edge >= 0 && l.length > 60).map((l) => {
      const ss = Math.min(l.length - 5, 60);
      const q = net.at(l, ss, { ...pt });
      return { l, ss, d: Math.hypot(q.x - p.x, q.z - p.z), dot: q.dx * p.dx + q.dz * p.dz };
    }).filter((o) => o.dot < -0.9).sort((a, b) => a.d - b.d)[0];
    if (back) place(foe, back.l, Math.max(0, back.ss - 50), 9);
  }
  let went = -1, closest = Infinity, wrongSide = 0;
  for (let f = 0; f < seconds * 30; f++) {
    t.update(1 / 30, player.x, player.z, player);
    for (const c of t.cars) if (c !== car && c !== foe) c.active = false;
    if (!car.active) break;
    if (car.mode === "overtake" && went < 0) went = t.time;
    if (Math.abs(car.lat) > 1) wrongSide++;
    closest = Math.min(closest, Math.hypot(car.x - player.x, car.z - player.z));
  }
  return { went, honks: honks.length, closest, wrongSide, passed: car.s > s + 5 || car.lane !== lane };
}

const pick = streets.find((l) => {
  const r = run(l, l.length / 2, 0, 40);
  return r.went > 0 && r.passed;
});
check("a long straight two-way street to test on", !!pick, `${streets.length} candidates`);
if (pick) {
  const mid = pick.length / 2;
  // Happy: stalled in the middle of the street, nothing coming: honk, wait, then go round and back in.
  const stalled = run(pick, mid, 0, 40);
  check("a car stuck behind a player stalled mid-street honks first", stalled.honks >= 1, `${stalled.honks} honks`);
  check("then goes round, after waiting (not at once)", stalled.went > 7, `went at ${stalled.went.toFixed(1)} s`);
  check("and gets past without touching the player", stalled.passed && stalled.closest > 2, `closest ${stalled.closest.toFixed(1)} m`);
  // A player pulled in to the kerb is parked: passed sooner (Autoware: stopped 3 s, 1 m off centre).
  const parked = run(pick, mid, 1.2, 40);
  check("a player parked at the kerb is passed sooner than one stalled in the lane", parked.went > 0 && parked.went < stalled.went - 2, `${parked.went.toFixed(1)} s vs ${stalled.went.toFixed(1)} s`);

  // Sad: waiting at the stop line (the end of the lane): the car behind waits, quietly, in its own lane.
  const atLine = run(pick, pick.length - 8, 0, 40);
  check("nobody overtakes a player waiting at the stop line", atLine.went < 0 && atLine.wrongSide === 0, `went ${atLine.went}, ${atLine.wrongSide} frames on the wrong side`);
  check("or honks at them", atLine.honks === 0, `${atLine.honks} honks`);
  check("the car behind stops short of the player", atLine.closest > 3, `closest ${atLine.closest.toFixed(1)} m`);
}

// Idiot: the player stops inside a junction. Nobody drives round through the junction.
const box = net.lanes.find((l) => l.kind === LaneKind.Internal && l.length > 12);
if (box && pick) {
  const t = new NetTraffic(net, { honk() {} }, { vehicles: 30, walkers: 0, seed: 9 }, "left");
  const p = net.at(box, box.length / 2, { ...pt });
  const player = { x: p.x, z: p.z, yaw: Math.atan2(p.dx, p.dz), speed: 0, driving: true };
  let overtakes = 0;
  for (let f = 0; f < 90 * 30; f++) {
    t.update(1 / 30, player.x, player.z, player);
    overtakes += t.cars.filter((c) => c.active && c.mode === "overtake" && Math.hypot(c.x - p.x, c.z - p.z) < 60).length;
  }
  check("nobody goes round a player stopped in a junction", overtakes === 0, `${overtakes} car-frames overtaking`);
}

// Tragedy: the player stalled mid-street, a car coming the other way. The car behind waits for it.
if (pick) {
  const r = run(pick, pick.length / 2, 0, 40, true);
  check("with a car coming the other way, the car behind still never touches the player", r.closest > 2, `closest ${r.closest.toFixed(1)} m`);
}
done();
