// Street trees with a level of detail (trees.ts): the nearest are real trees
// (ez-tree), the rest low-poly crowns, nothing drawn past the draw distance,
// and every tree in range drawn exactly once, whichever way.
import { StreetTrees, type TreeSpot } from "../src/client/trees";
import { check, done } from "./check";

// ez-tree loads its leaf and bark images with a TextureLoader: give it a stub document headless.
const g = globalThis as unknown as { document?: unknown };
g.document ??= { createElementNS: () => ({ style: {}, addEventListener() {}, removeEventListener() {}, setAttribute() {} }), createElement: () => ({ style: {}, getContext: () => null }) };

// A street grid of trees every 15 m over 3 x 3 km.
const spots: TreeSpot[] = [];
for (let x = -1500; x <= 1500; x += 15) for (let z = -1500; z <= 1500; z += 150) spots.push({ x, z, rot: 0, s: 1 });
const inRange = (r: number, x = 0, z = 0) => spots.filter((s) => (s.x - x) ** 2 + (s.z - z) ** 2 <= r * r).length;

const trees = new StreetTrees(spots);
trees.update(0, 0, 600);
check("before the real trees load, every tree in range is a crown", trees.nearCount === 0 && trees.farCount === inRange(600), `${trees.farCount} crowns, ${inRange(600)} in range`);
check("nothing is drawn past the draw distance", trees.farCount < spots.length);

await trees.loadNear();
check("once loaded, the nearest become real trees, at most 160", trees.nearCount > 0 && trees.nearCount <= 160, `${trees.nearCount} real trees`);
check("every tree in range is drawn exactly once (real or crown)", trees.nearCount + trees.farCount === inRange(600), `${trees.nearCount} + ${trees.farCount} vs ${inRange(600)}`);

const before = trees.farCount;
trees.update(5, 0, 600);
check("moving less than 8 m doesn't re-lay them out", trees.farCount === before);
trees.update(400, 0, 600);
check("moving on re-lays them out around the player", trees.nearCount + trees.farCount === inRange(600, 400, 0), `${trees.nearCount} + ${trees.farCount} vs ${inRange(600, 400, 0)}`);
trees.update(400, 0, 200);
check("a shorter draw distance (fog drawn in) re-lays them out at once", trees.nearCount + trees.farCount === inRange(200, 400, 0));

// Sad: the library loads but a variant fails to generate: every tree stays a crown, nothing breaks.
const { Tree } = await import("@dgreenheck/ez-tree");
let made = 0;
class FailingTree extends Tree {
  generate() {
    if (++made === 3) throw new Error("generation failed");
    super.generate();
  }
}
const sad = new StreetTrees(spots);
const ok = await sad.loadNear(async () => ({ Tree: FailingTree as unknown as typeof Tree }));
sad.update(0, 0, 600);
check("a variant that fails to generate leaves every tree a crown", !ok && sad.nearCount === 0 && sad.farCount === inRange(600), `${sad.nearCount} real, ${sad.farCount} crowns`);
sad.update(300, 0, 600);
check("and later re-layouts still work", sad.farCount === inRange(600, 300, 0));
const gone = new StreetTrees(spots);
check("a library that won't load at all: crowns, no crash", (await gone.loadNear(async () => { throw new Error("offline"); })) === false);

// Idiot-proof: a reset or teleport far off the map, then back.
trees.update(50000, 50000, 600);
check("teleported off the map: nothing drawn", trees.nearCount === 0 && trees.farCount === 0);
trees.update(0, 0, 600);
check("and back: all in range drawn again", trees.nearCount + trees.farCount === inRange(600));

// Tragedy: Finglas's real number of trees over a 20 km drive.
const many: TreeSpot[] = [];
for (let i = 0; i < 17835; i++) many.push({ x: ((i * 7919) % 4000) - 2000, z: ((i * 104729) % 4000) - 2000, rot: i, s: 1 });
const big = new StreetTrees(many);
await big.loadNear();
let worst = 0, wrong = 0, layouts = 0;
for (let d = 0; d < 20000; d += 10) {
  const a = d / 1500, x = Math.cos(a) * 1500, z = Math.sin(a) * 1500; // 10 m steps round a 1.5 km circle
  const t0 = performance.now();
  big.update(x, z, 900);
  worst = Math.max(worst, performance.now() - t0);
  layouts++;
  const want = many.filter((s) => (s.x - x) ** 2 + (s.z - z) ** 2 <= 900 * 900).length;
  if (big.nearCount + big.farCount !== want || big.nearCount > 160) wrong++;
}
check(`17,835 trees over a 20 km drive: every layout right (${layouts} layouts)`, wrong === 0, `${wrong} wrong`);
check("and each one quick (under 15 ms)", worst < 15, `worst ${worst.toFixed(1)} ms`);
done();
