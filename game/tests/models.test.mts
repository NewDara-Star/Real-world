// The shipped models carry what the game reads from them (docs/blender-assets.md):
// named empties at their real positions, named lenses and lights, four named
// wheels. Bug reproduced: the build applied transforms to empties too, which
// zeroed HeadMount (signal heads would sit on the pavement) and LampHead.
import { readFileSync } from "node:fs";
import { check, done, within } from "./check";

interface Node { name?: string; translation?: number[]; mesh?: number; children?: number[] }

/** The glTF JSON chunk of a .glb in public/models. */
function gltf(file: string): { nodes: Node[]; materials?: { name?: string }[] } {
  const b = readFileSync(new URL(`../public/models/${file}.glb`, import.meta.url));
  const len = b.readUInt32LE(12);
  return JSON.parse(b.subarray(20, 20 + len).toString("utf8"));
}
const node = (g: { nodes: Node[] }, name: string) => g.nodes.find((n) => n.name === name);

const pole = gltf("traffic_signal_pole");
within("the signal pole's HeadMount is at the head's height (2.5 m)", node(pole, "HeadMount")?.translation?.[1] ?? 0, 2.45, 2.55, " m");
const lamp = gltf("lamp_post_led");
within("the lamp post's LampHead is up at the lantern (~8 m)", node(lamp, "LampHead")?.translation?.[1] ?? 0, 7.9, 8.2, " m");
within("and out over the road on the arm (+Z, ~1.5 m)", node(lamp, "LampHead")?.translation?.[2] ?? 0, 1.3, 1.7, " m");
const head = gltf("traffic_signal_head");
check("the signal head has its three lenses", ["LensRed", "LensAmber", "LensGreen"].every((n) => node(head, n)?.mesh !== undefined));

for (const f of ["car_traffic_1", "car_traffic_2", "car_traffic_3", "car_traffic_4", "car_traffic_5", "bus_dublin_dd"]) {
  const g = gltf(f);
  const wheels = ["WheelFL", "WheelFR", "WheelRL", "WheelRR"].map((n) => node(g, n));
  check(`${f}: four named wheels, pivots off the origin at the wheel centres`, wheels.every((w) => w?.mesh !== undefined && Math.hypot(...(w.translation ?? [0, 0, 0])) > 0.5));
  check(`${f}: indicators at all four corners`, ["IndicatorFL", "IndicatorFR", "IndicatorRL", "IndicatorRR"].every((n) => node(g, n)));
  // Front is +Z in glTF: the front wheels are ahead of the rear ones, the left ones on +X.
  const z = (n: string) => node(g, n)?.translation?.[2] ?? 0, x = (n: string) => node(g, n)?.translation?.[0] ?? 0;
  check(`${f}: faces +Z with its left side on +X`, z("WheelFL") > z("WheelRL") && x("WheelFL") > 0 && x("WheelFR") < 0);
}
// Paint the game can tint per car (trafficnet.ts PAINTS): every car but the black SUV.
const paintOf = (f: string) => (gltf(f).materials ?? []).map((m) => m.name ?? "").filter((n) => n.startsWith("CarPaint"));
check("cars 1-3 and the van carry tintable CarPaint", ["car_traffic_1", "car_traffic_2", "car_traffic_3", "car_traffic_5"].every((f) => paintOf(f).includes("CarPaint")));
check("the van's painted-over panels are paint too, so they take the same colour", paintOf("car_traffic_5").includes("CarPaintPanel"));
check("the black SUV keeps its own paint (it can't be told from its black trim)", paintOf("car_traffic_4").length === 0);
done();
