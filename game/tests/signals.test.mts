// Signal placement (roadsigns.ts signalPlacement), shared by the plain boxes
// and the Irish signal models: the head faces the traffic it controls, red is
// on top, the lit lamps sit on the lenses, and the boxes are where they were.
import * as THREE from "three/webgpu";
import { signalPlacement } from "../src/client/roadsigns";
import { check, done, within } from "./check";

const pos = (m: THREE.Matrix4) => new THREE.Vector3().setFromMatrixPosition(m);
const facing = (m: THREE.Matrix4) => new THREE.Vector3(0, 0, 1).transformDirection(m);

// Traffic travelling +Z (yaw 0) at the kerb point (10, 5): it approaches from -Z.
const MODEL = { mount: 2.5, lensZ: 0.371, lensY: [0.76, 0.5, 0.24] };
const at = signalPlacement(10, 5, 0, MODEL);
check("the pole stands on the ground at the kerb point", pos(at.pole).distanceTo(new THREE.Vector3(10, 0, 5)) < 1e-6);
check("the head is at the pole's mount height", Math.abs(pos(at.head).y - 2.5) < 1e-6);
check("the head's front faces the oncoming traffic (-Z here)", facing(at.head).z < -0.999, facing(at.head).toArray().map((v) => v.toFixed(3)).join(", "));
const ys = at.lamps.map((m) => pos(m).y);
check("three lamps, red on top, then amber, then green", ys.length === 3 && ys[0] > ys[1] && ys[1] > ys[2], ys.map((y) => y.toFixed(2)).join(" > "));
within("the red lamp is at the red lens's height", ys[0], 3.259, 3.261, " m");
check("the lamps sit in front of the head, toward the traffic", at.lamps.every((m) => Math.abs(pos(m).z - (5 - 0.371)) < 1e-6));
check("and face it too", at.lamps.every((m) => facing(m).z < -0.999));

// Turning the approach turns everything with it.
const turned = signalPlacement(0, 0, Math.PI / 2, MODEL);
check("an approach heading +X gets a head facing -X", facing(turned.head).x < -0.999);
check("with its lamps on the -X side of the pole", turned.lamps.every((m) => pos(m).x < 0));

// The plain boxes keep the layout they had before the models: lamps at 3.32, 2.96, 2.60 m, 0.14 m toward the traffic.
const box = signalPlacement(0, 0, 0, { mount: 2.9, lensZ: 0.14, lensY: [0.42, 0.06, -0.3] });
const want = [3.32, 2.96, 2.6];
check("the plain boxes' lamps are where they always were", box.lamps.every((m, i) => pos(m).distanceTo(new THREE.Vector3(0, want[i], -0.14)) < 1e-6));
done();
