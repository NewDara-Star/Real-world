// Front gardens on the real Finglas map (gardens.ts), headless: where the
// walls, hedges, driveways and bins go, and that nothing lands somewhere a
// car or a house already is. How it looks is checked on the owner's Mac.
import { readFileSync } from "node:fs";
import { CITIES } from "../src/client/cities";
import { GardenPlanner, plotPieces, WALL_H } from "../src/client/gardens";
import { ALLOW_CAR } from "../src/client/roadnet";
import { World } from "../src/client/world";
import { check, done, loadNet, within } from "./check";

const net = await loadNet("finglas");
const world = new World(CITIES.finglas);
const bin = readFileSync(new URL("../public/world/finglas.bin", import.meta.url));
world.parse(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
const g = new GardenPlanner(world.buildings, net, (x, z) => world.insideBuilding(x, z));

// A sample spread over the whole map keeps the test quick.
const sample: number[] = [];
for (let i = 0; i < world.buildings.length; i += 4) sample.push(i);
let houses = 0, plots = 0, drives = 0, onLane = 0, inHouse = 0, walls = 0, frontOk = 0, planned = 0, kept = 0, keptIfDropped = 0;
const runLen = (q: { kind: string; ax?: number; az?: number; bx?: number; bz?: number }) => (q.kind === "wall" || q.kind === "hedge" ? Math.hypot(q.bx! - q.ax!, q.bz! - q.az!) : 0);
const depths: number[] = [];
for (const i of sample) {
  const b = world.buildings[i];
  if (b.h <= 12 && b.pts.length >= 6) houses++;
  const p = g.plot(i);
  if (!p) continue;
  plots++;
  if (p.drive) drives++;
  depths.push((p.dA + p.dB) / 2);
  // The garden's outer edge sits at the back of a footpath or road edge: one more step out is street.
  const mid = p.len / 2, d = (p.dA + p.dB) / 2;
  const sx = p.ax + p.ux * mid + p.nx * (d + 0.6), sz = p.az + p.uz * mid + p.nz * (d + 0.6);
  const on = net.locate(sx, sz, null, ALLOW_CAR | 2);
  if (on && Math.abs(on.lat) < on.lane.width / 2 + 0.2) frontOk++;
  const pieces = g.pieces(i);
  for (const q of plotPieces(p)) {
    planned += runLen(q);
    // The old rule: a run with any blocked point was dropped whole.
    const survivors = pieces.filter((r) => r.kind === q.kind && "ax" in r && "ax" in q && Math.abs(runLen(r) - runLen(q)) < 1e-6 && Math.hypot(r.ax - q.ax, r.az - q.az) < 1e-6);
    if (survivors.length) keptIfDropped += runLen(q);
  }
  for (const q of pieces) kept += runLen(q);
  for (const q of pieces) {
    if (q.kind !== "wall" && q.kind !== "hedge") continue;
    walls++;
    for (let t = 0; t <= 1; t += 0.25) {
      const x = q.ax + (q.bx - q.ax) * t, z = q.az + (q.bz - q.az) * t;
      const l = net.locate(x, z, null, ALLOW_CAR);
      if (l && Math.abs(l.lat) < l.lane.width / 2) onLane++;
      if (world.insideBuilding(x, z)) inHouse++;
    }
  }
}
depths.sort((a, b) => a - b);
within("most Finglas houses get a front garden", plots / houses, 0.6, 1);
within("median front garden depth, house to footpath (Dublin estates: ~6-10 m)", depths[depths.length >> 1], 5, 11, " m");
within("share of gardens paved as a driveway", drives / plots, 0.3, 0.6);
check("the garden's outer edge meets a footpath or road", frontOk / plots > 0.9, `${((frontOk / plots) * 100).toFixed(1)}% of ${plots}`);
check("no garden wall or hedge stands on a car lane", onLane === 0, `${onLane} points on lanes, ${walls} walls`);
check("no garden wall or hedge stands inside a building", inHouse === 0, `${inHouse} points`);
// Bug reproduced: lanes crossing the ends of plots made the filter drop whole
// walls (4.6% of them); runs are now cut back to the clear part instead.
check("walls are cut back where a lane crosses, not dropped", kept > keptIfDropped + 1, `${(kept / planned * 100).toFixed(1)}% of planned length kept, ${(keptIfDropped / planned * 100).toFixed(1)}% by dropping`);

// One plot in detail: the opening is in the front wall, the bins are clear of it.
const one = sample.map((i) => g.plot(i)).find((p) => p && p.bins > 1 && p.gap1 > p.gap0)!;
const parts = plotPieces(one);
const front = parts.filter((q) => q.kind === "wall" && q.h === WALL_H);
check("a plot with a gate has two front wall runs either side of it", front.length >= 2 || one.boundary === "hedge");
const binS = parts.filter((q) => q.kind === "bin").map((q) => (q.kind === "bin" ? (q.x - one.ax) * one.ux + (q.z - one.az) * one.uz : 0));
check("bins stand clear of the gate or driveway", binS.every((s) => s + 0.31 <= one.gap0 || s - 0.31 >= one.gap1), binS.map((s) => s.toFixed(2)).join(", "));
// The Blender modules as stamp templates (models.ts): variants and surface codes survive.
const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
const { gltfTemplate } = await import("../src/client/models");
const { FACADE_LAMP, FACADE_PROP_BRICK, FACADE_PROP_CONCRETE, FACADE_PROP_RENDER } = await import("../src/client/facade");
const glb = async (n: string) => {
  const b = readFileSync(new URL(`../public/models/${n}.glb`, import.meta.url));
  return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), "");
};
const wallG = await glb("garden_wall_section_1m");
const codes = (t: { code?: Float32Array }) => new Set(t.code);
const render = gltfTemplate(wallG), brick = gltfTemplate(wallG, { WallRender: "WallBrick" });
check("the wall module draws rendered blockwork with a concrete coping", codes(render).has(FACADE_PROP_RENDER) && codes(render).has(FACADE_PROP_CONCRETE) && !codes(render).has(FACADE_PROP_BRICK));
check("its brick variant swaps the blockwork for brick", codes(brick).has(FACADE_PROP_BRICK) && !codes(brick).has(FACADE_PROP_RENDER));
within("the wall module is 1 m long", Math.max(...render.pos.filter((_, i) => i % 3 === 0)) - Math.min(...render.pos.filter((_, i) => i % 3 === 0)), 0.99, 1.01, " m");
const binG = await glb("wheelie_bin");
const binCol = (swap: Record<string, string>) => gltfTemplate(binG, swap).col.slice(0, 3).join();
check("black, green and brown bins differ", new Set([binCol({ BinGreen: "BinBlack" }), binCol({}), binCol({ BinGreen: "BinBrown" })]).size === 3);
check("the LED lamp's lens glows at night", codes(gltfTemplate(await glb("lamp_post_led"))).has(FACADE_LAMP));
// Bug reproduced (push review): a place without the street models (Yaba) had
// mapped walls the car hit but nobody could see.
const bare = new World(CITIES.yaba);
bare.barriers = [{ kind: 0, h: 1.8, pts: [0, 0, 10, 0] }];
check("mapped walls aren't solid where they aren't drawn", bare.detail === null && bare.barrierColliders().length === 0);
check("the same house gets the same garden every time", JSON.stringify(new GardenPlanner(world.buildings, net, (x, z) => world.insideBuilding(x, z)).plot(one.b)) === JSON.stringify(one));
done();
