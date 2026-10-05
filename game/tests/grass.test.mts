// Grass blades near the camera (grass.ts). What the GPU draws is checked on
// the Mac; these are the numbers and cells the shader relies on.
import { GRASS, clumpGeometry, gridCell } from "../src/client/grass";
import { check, done, within } from "./check";

check("the blade grid plus one re-mask of travel stays inside the coverage mask (no sampling past its edge)", GRASS.RADIUS + GRASS.REMASK <= GRASS.MASK / 2, `${GRASS.RADIUS} + ${GRASS.REMASK} vs ${GRASS.MASK / 2}`);
check("the grid reaches the fade-out radius", (GRASS.N * GRASS.SPACING) / 2 >= GRASS.RADIUS);

const g = clumpGeometry();
const pos = g.getAttribute("position"), blade = g.getAttribute("blade");
let reach = 0, lo = Infinity, hi = -Infinity;
for (let i = 0; i < pos.count; i++) {
  reach = Math.max(reach, Math.abs(pos.getX(i)), Math.abs(pos.getZ(i)));
  lo = Math.min(lo, blade.getX(i));
  hi = Math.max(hi, blade.getX(i));
}
// Blades are planted within the cell; a blade's width and lean may overhang it by up to 5 cm (the shader's nudge then overlaps neighbours on purpose).
within("a clump's blades reach no further than half a cell plus a blade's width and lean", reach, 0, GRASS.SPACING / 2 + 0.05, " m");
check("blades rise from the ground (0) to the tip (1)", lo === 0 && hi === 1);
check("exactly BLADES blades per clump (three triangles each)", g.getIndex()!.count === GRASS.BLADES * 9, `${g.getIndex()!.count / 9}`);
within("triangles drawn for the whole field", (GRASS.N * GRASS.N * g.getIndex()!.count) / 3, 0, 1.2e6);

// Cells are whole numbers anywhere on the map, so a clump's cell (and its look) never jumps as the grid moves.
let exact = true, close = true;
for (const base of [0, 1234.5, -987.25, 5000, -5000, 31999.9]) {
  for (let k = 0; k < 200; k++) {
    const x = base + k * 0.0731;
    const c = gridCell(x);
    if (!Number.isInteger(c)) exact = false;
    if (Math.abs(c * GRASS.SPACING - x) > GRASS.SPACING / 2 + 1e-9) close = false;
  }
}
check("a coordinate's grid cell is a whole number, even 32 km out", exact);
check("and the cell's centre is within half a cell of it", close);
done();
