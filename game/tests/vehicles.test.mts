// Real vehicle models replace the traffic's boxes (NetTraffic.setVehicleModels):
// a missing or empty model keeps the box, one model can serve two kinds, and
// every part of a model is drawn at every car of its kind, a full fleet long.
import * as THREE from "three/webgpu";
import { NetTraffic, VEHICLE_MODELS } from "../src/client/trafficnet";
import { check, done, loadNet } from "./check";

const net = await loadNet("finglas");
const traffic = new NetTraffic(net, { honk() {} }, { vehicles: 70, walkers: 0, seed: 5 }, "left");
const kinds = VEHICLE_MODELS.length;
const before = Array.from({ length: kinds }, (_, k) => traffic.vehicleParts(k)[0]);

/** A stand-in model: a body and a wheel as two meshes. */
function model() {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.4, 4.3), new THREE.MeshStandardMaterial({ name: "CarPaint" })));
  const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.2), new THREE.MeshStandardMaterial());
  wheel.position.set(0.8, 0.3, 1.3);
  wheel.name = "WheelFL";
  g.add(wheel);
  const brake = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.05), new THREE.MeshStandardMaterial());
  brake.position.set(0, 0.8, -2.1);
  brake.name = "Brakelights";
  g.add(brake);
  return g;
}
const shared = model();
const models: (THREE.Object3D | null)[] = Array.from({ length: kinds }, () => model());
models[0] = null; // a file that failed to load
models[2] = new THREE.Group(); // a file with no meshes in it
models[1] = models[3] = shared; // one model for two kinds
traffic.setVehicleModels(models);

check("every kind names a model file", VEHICLE_MODELS.every((f) => typeof f === "string" && f.length > 0), VEHICLE_MODELS.join(", "));
check("a model that didn't load keeps its box", traffic.vehicleParts(0).length === 1 && traffic.vehicleParts(0)[0] === before[0]);
check("a model with no meshes keeps its box", traffic.vehicleParts(2).length === 1 && traffic.vehicleParts(2)[0] === before[2]);
const a = traffic.vehicleParts(1), b = traffic.vehicleParts(3);
check("one model can serve two kinds, each with its own meshes", a.length === 3 && b.length === 3 && a[0] !== b[0] && a[0].geometry !== b[0].geometry);
check("a model's parts keep their place on the car (the wheel's offset is in its geometry)", (() => {
  a[1].geometry.computeBoundingBox();
  return Math.abs(a[1].geometry.boundingBox!.getCenter(new THREE.Vector3()).z - 1.3) < 1e-6;
})());
check("only the paint gets per-car colours (body yes, wheel no)", !!a[0].instanceColor && !a[1].instanceColor);
check("brake lights get their own unlit material and a colour per car", a[2].material instanceof THREE.MeshBasicNodeMaterial && !!a[2].instanceColor);
check("the replaced boxes are gone from the scene", before.filter((_, k) => k !== 0 && k !== 2).every((m) => !traffic.group.children.includes(m)));

// A full fleet for a minute: every part of a kind drawn the same number of times, at the same places.
for (let i = 0; i < 60 * 30; i++) traffic.update(1 / 30, 0, 0);
let drawn = 0, partsAgree = true, withinBudget = true, sameMatrices = true, wheelsOnAxle = true, turned = 0;
const m0 = new THREE.Matrix4(), m1 = new THREE.Matrix4();
for (let k = 0; k < kinds; k++) {
  const parts = traffic.vehicleParts(k);
  drawn += parts[0].count;
  for (const p of parts) {
    if (p.count !== parts[0].count) partsAgree = false;
    if (p.count > p.instanceMatrix.count) withinBudget = false;
  }
  // The body and the brake lights move together; a wheel turns about its own centre.
  for (let i = 0; i < parts[0].count && parts.length > 2; i++) {
    parts[0].getMatrixAt(i, m0);
    parts[2].getMatrixAt(i, m1);
    if (!m0.equals(m1)) sameMatrices = false;
    parts[1].getMatrixAt(i, m1);
    const hub = new THREE.Vector3(0.8, 0.3, 1.3);
    if (hub.clone().applyMatrix4(m1).distanceTo(hub.clone().applyMatrix4(m0)) > 1e-4) wheelsOnAxle = false;
    if (!m1.equals(m0)) turned++;
  }
}
const active = traffic.cars.filter((c) => c.active).length;

// Each car keeps one colour while others come and go and its draw slot moves:
// the slot is the count of active cars of its kind before it in the fleet.
const painted = traffic.vehicleParts(1)[0];
const colourOf = new Map<number, string>();
let moved = 0, changed = 0;
const lastSlot = new Map<number, number>();
const c = new THREE.Color();
for (let f = 0; f < 90 * 30; f++) {
  traffic.update(1 / 30, 0, 0);
  if (f % 15) continue;
  let slot = 0;
  traffic.cars.forEach((car, i) => {
    if (!car.active || car.kind !== 1) return;
    painted.getColorAt(slot, c);
    const key = c.getHexString();
    if (colourOf.has(i) && colourOf.get(i) !== key) changed++;
    colourOf.set(i, key);
    if (lastSlot.has(i) && lastSlot.get(i) !== slot) moved++;
    lastSlot.set(i, slot);
    slot++;
  });
}
check("every active car is drawn once", drawn === active && active > 20, `${drawn} drawn, ${active} active`);
check("all parts of a kind draw the same number of cars", partsAgree);
check("no kind draws more cars than it has room for", withinBudget);
check("a car's body and lights are drawn at the same place", sameMatrices);
check("its wheels turn about their own hubs (the hub stays put on the car)", wheelsOnAxle);
check("and they do turn: rolled wheels aren't square with the body", turned > 0, `${turned} turned`);
// Service vehicles wear their fleet's colour, not a private car's: every one of a livery kind the same.
const white = new THREE.Color(0xeeeeec);
const van = VEHICLE_MODELS.indexOf("car_service_van"), vanPaint = traffic.vehicleParts(van)[0];
const vans = Array.from({ length: vanPaint.count }, (_, i) => vanPaint.getColorAt(i, new THREE.Color()));
check("service vans are all the fleet's white", vans.length > 0 && vans.every((v) => Math.abs(v.r - white.r) + Math.abs(v.g - white.g) + Math.abs(v.b - white.b) < 1e-4), `${vans.length} vans`);
check("each car keeps its colour as cars come and go (its draw slot moved " + moved + " times)", moved > 0 && changed === 0, `${changed} changes over ${colourOf.size} cars`);
done();
