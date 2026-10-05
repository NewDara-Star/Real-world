// Finding a car's paint in its body texture (tools/assets/paintmask.py, run by
// build_traffic_cars.py): the paint is tinted per car in the game, so getting
// it wrong tints trim, decals or nothing. Synthetic textures, real code.
import { spawnSync } from "node:child_process";
import { check, done } from "./check";

const tool = new URL("../../tools/assets/", import.meta.url).pathname;
const py = `
import json, sys
import numpy as np
sys.path.insert(0, ${JSON.stringify(tool)})
from paintmask import paint_mask
def tex(*parts):  # (rgb, count) pairs -> (N, 3) texels
    return np.concatenate([np.tile(np.array(c, dtype=np.float32), (n, 1)) for c, n in parts])
def share(mask, lo, hi): return None if mask is None else float(mask[lo:hi].mean())
yellow, grey, black, red, blue, green = (0.9, 0.75, 0.1), (0.4, 0.4, 0.42), (0.03, 0.03, 0.035), (0.8, 0.1, 0.1), (0.1, 0.2, 0.8), (0.1, 0.7, 0.2)
out = {}
m = paint_mask(tex((yellow, 700), (grey, 300)))
out["yellow"] = [share(m, 0, 700), share(m, 700, 1000)]
out["black"] = paint_mask(tex((black, 800), (grey, 200))) is None
m = paint_mask(tex((yellow, 600), (red, 250), (grey, 150)))
out["decal"] = [share(m, 0, 600), share(m, 600, 850)]
out["threeway"] = paint_mask(tex((red, 340), (blue, 330), (green, 330))) is None
print(json.dumps(out))
`;
const r = spawnSync("python3", ["-c", py], { encoding: "utf8" });
check("the paint finder runs (python3 with numpy)", r.status === 0, r.stderr.trim().split("\n").pop() ?? "");
const out = r.status === 0 ? JSON.parse(r.stdout) : {};
check("a yellow car: all the yellow is paint, none of the grey trim", out.yellow?.[0] === 1 && out.yellow?.[1] === 0, JSON.stringify(out.yellow));
check("a black car can't be separated from its trim: left untinted", out.black === true);
check("a red decal beside dominant yellow paint is left alone", out.decal?.[0] === 1 && out.decal?.[1] === 0, JSON.stringify(out.decal));
check("no single dominant hue (three equal colours): left untinted", out.threeway === true);
done();
