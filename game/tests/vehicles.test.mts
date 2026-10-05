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
  g.add(new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.4, 4.3), new THREE.MeshStandardMaterial()));
  const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.2), new THREE.MeshStandardMaterial());
  wheel.position.set(0.8, 0.3, 1.3);
  g.add(wheel);
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
check("one model can serve two kinds, each with its own meshes", a.length === 2 && b.length === 2 && a[0] !== b[0] && a[0].geometry !== b[0].geometry);
check("a model's parts keep their place on the car (the wheel's offset is in its geometry)", (() => {
  a[1].geometry.computeBoundingBox();
  return Math.abs(a[1].geometry.boundingBox!.getCenter(new THREE.Vector3()).z - 1.3) < 1e-6;
})());
check("the replaced boxes are gone from the scene", before.filter((_, k) => k !== 0 && k !== 2).every((m) => !traffic.group.children.includes(m)));

// A full fleet for a minute: every part of a kind drawn the same number of times, at the same places.
for (let i = 0; i < 60 * 30; i++) traffic.update(1 / 30, 0, 0);
let drawn = 0, partsAgree = true, withinBudget = true, sameMatrices = true;
const m0 = new THREE.Matrix4(), m1 = new THREE.Matrix4();
for (let k = 0; k < kinds; k++) {
  const parts = traffic.vehicleParts(k);
  drawn += parts[0].count;
  for (const p of parts) {
    if (p.count !== parts[0].count) partsAgree = false;
    if (p.count > p.instanceMatrix.count) withinBudget = false;
  }
  for (let i = 0; i < parts[0].count && parts.length > 1; i++) {
    parts[0].getMatrixAt(i, m0);
    parts[1].getMatrixAt(i, m1);
    if (!m0.equals(m1)) sameMatrices = false;
  }
}
const active = traffic.cars.filter((c) => c.active).length;
check("every active car is drawn once", drawn === active && active > 20, `${drawn} drawn, ${active} active`);
check("all parts of a kind draw the same number of cars", partsAgree);
check("no kind draws more cars than it has room for", withinBudget);
check("a car's parts are drawn at the same place", sameMatrices);
done();
