// Walkers' legs keep pace with how far they actually walk, whatever the frame
// rate: the stride phase gained per metre is the same at 30 and 120 fps, and
// one huge frame (alt-tab, a stall) doesn't spin the legs.
import { check, done, loadNet, within } from "./check";
import { NetTraffic } from "../src/client/trafficnet";

const net = await loadNet("finglas");
const STRIDE_PER_METRE = 6; // trafficnet.ts: phase += dt * v * 6

/** Stride phase gained per metre actually walked, over `seconds` at `fps`. */
function phasePerMetre(fps: number, seconds: number) {
  const t = new NetTraffic(net, { honk() {} }, { vehicles: 0, walkers: 60 });
  const dt = 1 / fps;
  let phase = 0, metres = 0;
  for (let i = 0; i < fps * seconds; i++) {
    const before = t.peds.map((p) => ({ x: p.x, z: p.z, phase: p.phase, active: p.active }));
    t.update(dt, 0, 0, { x: 0, z: 0, yaw: 0, speed: 0, driving: false });
    t.peds.forEach((p, k) => {
      const b = before[k];
      const step = Math.hypot(p.x - b.x, p.z - b.z);
      // Skip spawns and respawns (a jump across the map) and frames standing still.
      if (!b.active || !p.active || step > 1 || p.phase === b.phase) return;
      phase += p.phase - b.phase;
      metres += step;
    });
  }
  return { ratio: phase / (STRIDE_PER_METRE * metres), metres };
}

for (const fps of [30, 60, 120]) {
  const r = phasePerMetre(fps, 20);
  check(`walkers covered ground at ${fps} fps`, r.metres > 100, `${r.metres.toFixed(0)} m`);
  within(`legs keep pace with distance walked at ${fps} fps (phase per metre / expected)`, r.ratio, 0.9, 1.1);
}

// Tragedy: one 2-second frame after alt-tab. The sim caps a frame at 0.1 s, so
// no walker's stride jumps by more than 0.1 s worth of walking.
const t = new NetTraffic(net, { honk() {} }, { vehicles: 0, walkers: 60 });
for (let i = 0; i < 60; i++) t.update(1 / 60, 0, 0);
const before = t.peds.map((p) => p.phase);
t.update(2, 0, 0);
const worst = Math.max(...t.peds.map((p, k) => (p.active ? (p.phase - before[k]) / (STRIDE_PER_METRE * p.v * 0.1) : 0)));
check("a 2 s stall advances no stride by more than one capped frame", worst <= 1.0001, `worst ${worst.toFixed(3)} of the cap`);
check("walker positions stay finite after a stall", t.peds.every((p) => Number.isFinite(p.x) && Number.isFinite(p.z)));
done();
