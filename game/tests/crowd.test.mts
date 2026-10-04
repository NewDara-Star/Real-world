// The human pedestrians' stride logic and loading (crowd.ts), headless.
// The drawing itself needs a GPU; everything that decides who a pedestrian is,
// which clip they play and how far through it, is tested here.
import { readFileSync } from "node:fs";
import { Strides, hash, isFarDetail, type Clip, type ClipSet, type CrowdPed } from "../src/client/crowd";
import { check, done, within } from "./check";

const clip = (row: number, duration: number, speed: number): Clip => ({ row, frames: Math.round(duration * 30), duration, speed });
const person = (): ClipSet => ({
  walk: [clip(0, 1.2, 1.0), clip(36, 1.1, 1.3), clip(69, 1.5, 0.82)],
  idle: [clip(114, 11.7, 0), clip(290, 4.6, 0)],
});
const ped = (key: number, speed: number, lying = false): CrowdPed => ({ key, x: 0, y: 0, z: 0, yaw: 0, speed, lying });

// Bug reproduced: the build names far-detail parts "..._lod1" and the loader
// appends "_1", "_2" per material, so an endsWith check showed both levels.
check("far-detail parts are recognised with the loader's suffix", isFarDetail("f022_hipoly_81_bones_opacity_lod1_1") && isFarDetail("x_lod1"));
check("near-detail parts aren't mistaken for far ones", !isFarDetail("f022_hipoly_81_bones_opacity_1"));

// Bug reproduced: the hash is a full 32-bit number; a signed shift made the
// clip index negative for about half of all keys and crashed the frame loop.
{
  const s = new Strides([person(), person(), person()]);
  let bad = 0;
  for (let key = 0; key < 5000; key++) {
    const r = s.step(ped(key, 1.2), 1 / 60);
    if (!r || r.model < 0 || r.model > 2 || !r.clip) bad++;
  }
  check("every pedestrian key picks a real person and clip (no negative indices)", bad === 0, `${bad} of 5000 failed`);
  check("keys with the high bit set exist in that range (the case that crashed)", [...Array(5000).keys()].some((k) => hash(k) >= 2 ** 31));
}

// Happy path: stride matches speed.
{
  const s = new Strides([person()]);
  const walk = (speed: number, seconds: number) => {
    let cycles = 0, last = s.step(ped(1, speed), 0)!.phase;
    for (let t = 0; t < seconds; t += 1 / 60) {
      const r = s.step(ped(1, speed), 1 / 60)!;
      if (r.phase < last) cycles++;
      last = r.phase;
    }
    return cycles;
  };
  const c1 = walk(1.0, 12), c2 = walk(2.0, 12);
  within("walking twice as fast takes about twice as many strides", c2 / Math.max(1, c1), 1.7, 2.3);
}
{
  const s = new Strides([person()]);
  const r = s.step(ped(5, 0.6), 1 / 60)!;
  check("a slow walker uses the slow walk", r.clip.row === 69, `row ${r.clip.row}`);
  const idle = s.step(ped(5, 0), 1 / 60)!;
  check("standing plays an idle, not a walk", idle.clip.speed === 0);
  const down = s.step(ped(5, 1.4, true), 1 / 60)!;
  check("a knocked-down person isn't walking", down.clip.speed === 0);
}

// Idiot-proof: silly speeds and time steps stay sane.
{
  const s = new Strides([person()]);
  const phases = [s.step(ped(9, 1e6), 1 / 60)!, s.step(ped(9, -3), 1 / 60)!, s.step(ped(9, NaN), 1 / 60)!, s.step(ped(9, 1.2), 10)!].map((r) => r.phase);
  check("absurd speeds and long frames keep the stride between 0 and 1", phases.every((p) => Number.isFinite(p) && p >= 0 && p < 1), phases.map((p) => p.toFixed(2)).join(", "));
}

// Sad path: a person whose clips failed to load, or no people at all.
{
  const broken: ClipSet = { walk: [], idle: [] };
  const s = new Strides([broken]);
  check("a person with no clips is skipped, not a crash", s.step(ped(1, 1.2), 1 / 60) === null);
  check("no people at all is skipped, not a crash", new Strides([]).step(ped(1, 1.2), 1 / 60) === null);
  const onlyIdle = new Strides([{ walk: [], idle: [clip(0, 4, 0)] }]);
  check("a person with only an idle still stands there when asked to walk", onlyIdle.step(ped(1, 1.2), 1 / 60) !== null);
}

// Tragedy path: a full street of 110 for a long time, people coming and going.
{
  const s = new Strides(Array.from({ length: 33 }, person));
  let bad = 0;
  for (let f = 0; f < 60 * 60 * 5; f++) { // five minutes at 60 fps
    const seen = new Set<number>();
    for (let i = 0; i < 110; i++) {
      const key = (i + Math.floor(f / 600) * 7) % 400; // a few come and go every 10 s
      seen.add(key);
      const r = s.step(ped(key, (i % 5) * 0.4), 1 / 60);
      if (!r || !Number.isFinite(r.phase)) bad++;
    }
    s.keep(seen);
  }
  check("110 people for five minutes, coming and going: no failures", bad === 0, `${bad} bad steps`);
  check("forgotten pedestrians don't pile up in memory", (s as unknown as { walkers: Map<number, unknown> }).walkers.size <= 110);
}

// The shipped manifest is consistent with the files and the house rules.
{
  const base = new URL("../public/models/humans/", import.meta.url);
  const man = JSON.parse(readFileSync(new URL("people.json", base), "utf8"));
  const missing = man.avatars.filter((a: { name: string }) => { try { readFileSync(new URL(`${a.name}.glb`, base)); return false; } catch { return true; } });
  check("every person in people.json has a model file", missing.length === 0, missing.map((a: { name: string }) => a.name).join(", ") || `${man.avatars.length} people`);
  const clips = ["m", "f"].flatMap((sx) => [...man.clips[sx].walk, ...man.clips[sx].idle]);
  const noClip = clips.filter((c: string) => { try { readFileSync(new URL(`clips/${c}.glb`, base)); return false; } catch { return true; } });
  check("every clip in people.json has a file", noClip.length === 0, noClip.join(", ") || `${clips.length} clips`);
  check("both places have people", ["finglas", "yaba"].every((p) => man.avatars.some((a: { places: string[] }) => a.places.includes(p))));
  check("no police, military or fire uniforms (owner's decision)", !man.avatars.some((a: { name: string }) => /Police|Military|Fire/i.test(a.name)));
  within("walk speeds are human walking speeds", Math.min(...Object.values(man.walkSpeed) as number[]), 0.6, 1.6, " m/s");
}

// Sad path: an old world with no people.json; the game keeps its simple walkers.
{
  (globalThis as { fetch?: unknown }).fetch = async () => ({ ok: false, json: async () => ({}) });
  const { Crowd } = await import("../src/client/crowd");
  check("no people.json: no crowd, so the simple walkers stay", (await Crowd.load("finglas", 110)) === null);
}
done();
