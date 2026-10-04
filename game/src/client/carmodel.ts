import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// The player's car: a full glTF model with exterior and interior (CC BY 4.0,
// credits in public/models/CREDITS.md). The source is a central-seat concept
// car; for driving practice the steering wheel, binnacle and pedals are moved
// to the real driver's side, and the eye sits there.

export interface CarModel {
  root: THREE.Group;
  /** Rotate .rotation.z (radians) to turn the steering wheel. */
  steering: THREE.Object3D | null;
  wheels: { obj: THREE.Object3D; front: boolean; base: THREE.Quaternion }[];
  /** Nodes that only matter from inside: shown in cockpit view. */
  interior: THREE.Object3D[];
  /** Lamp materials to light up: brake, indicators (L/R), head. */
  lamps: { brake: THREE.Material[]; indL: THREE.Material[]; indR: THREE.Material[]; head: THREE.Material[] };
  /** Driver's eye in the car's frame (x left, y up, z forward). */
  eye: THREE.Vector3;
  /** Wing-mirror glass centres in the car frame. */
  mirrorL: THREE.Vector3;
  mirrorR: THREE.Vector3;
  length: number;
  width: number;
}

let source: THREE.Group | null = null;
let loading: Promise<THREE.Group | null> | null = null;

/** Start loading early; resolves to null if the file is missing. */
export function preloadCarModel(): Promise<THREE.Group | null> {
  loading ??= new GLTFLoader()
    .loadAsync("/models/car_concept.glb")
    .then((g) => (source = g.scene as unknown as THREE.Group))
    .catch(() => null);
  return loading;
}

export function carModelReady() {
  return !!source;
}

/** A fresh car, with the driver's controls on the side `seat` (+1 left, -1 right). */
export function buildCarModel(seat: number): CarModel | null {
  if (!source) return null;
  const scene = source.clone(true);
  const byName = new Map<string, THREE.Object3D>();
  scene.traverse((o) => byName.set(o.name, o));

  // Trademarked logos stay hidden.
  for (const n of ["InteriorSteeringEmblem", "License Plate", "License_Plate"]) {
    const o = byName.get(n);
    if (o) o.visible = false;
  }
  // Driver's controls to the driver's side. The model's +X is the car's left.
  const shift = 0.4 * seat;
  for (const n of ["InteriorPedalAccel", "InteriorPedalAccelArm", "InteriorPedalBrake", "InteriorPedalBrakeArm", "InteriorSteeringBase", "InteriorSteeringCylinder", "InteriorSteeringDash", "InteriorSteeringDashColumn", "InteriorSteeringHandleL", "InteriorSteeringHandleR"]) {
    const o = byName.get(n);
    if (o) o.position.x += shift;
  }

  const lamps = { brake: [] as THREE.Material[], indL: [] as THREE.Material[], indR: [] as THREE.Material[], head: [] as THREE.Material[] };
  const glass = new THREE.MeshPhysicalNodeMaterial({ color: 0x9fb4c0, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false });
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.receiveShadow = true;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const fixed = mats.map((mat) => {
      const name = mat.name ?? "";
      // Transmission glass needs an extra full-screen pass; plain alpha glass reads the same in a car.
      if (name === "Glass" || (mat as THREE.MeshPhysicalMaterial).transmission > 0) return glass;
      const own = mat.clone();
      if (name === "Brakelight") lamps.brake.push(own);
      if (name === "Headlight") lamps.head.push(own);
      if (name === "Signallight") (o.name.includes("Front") || o.parent?.name.includes("Hood") ? lamps.head : seatSide(o) > 0 ? lamps.indL : lamps.indR).push(own);
      return own;
    });
    m.material = Array.isArray(m.material) ? fixed : fixed[0];
  });

  // The asset's root part already turns its Z-up modelling space to Y-up,
  // with the nose toward +Z: use it as is.
  const root = new THREE.Group();
  root.add(scene);
  root.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(byName.get("BodyPanelsColor2") ?? scene);
  const steering = byName.get("InteriorSteeringCylinder") ?? null;
  const wheels = ["WheelFrontL", "WheelFrontR", "WheelRearL", "WheelRearR"]
    .map((n) => byName.get(n))
    .filter((o): o is THREE.Object3D => !!o)
    .map((obj) => ({ obj, front: obj.name.includes("Front"), base: obj.quaternion.clone() }));
  const interior: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if (o.name.startsWith("Interior")) interior.push(o);
  });
  const centre = (n: string) => {
    const o = byName.get(n);
    return o ? new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()) : new THREE.Vector3();
  };
  return {
    root,
    steering,
    wheels,
    interior,
    lamps,
    eye: driverEye(byName.get("InteriorSteeringCylinder"), root, shift),
    mirrorL: centre("BodyDoorLMirror"),
    mirrorR: centre("BodyDoorRMirror"),
    length: box.max.z - box.min.z,
    width: box.max.x - box.min.x,
  };
}

/** Driver's eye: ~0.7 m behind the steering wheel hub and 0.4 m above it. */
function driverEye(steer: THREE.Object3D | undefined, root: THREE.Object3D, shift: number): THREE.Vector3 {
  if (!steer) return new THREE.Vector3(shift, 1.0, 0.3);
  const c = new THREE.Box3().setFromObject(steer).getCenter(new THREE.Vector3());
  root.worldToLocal(c);
  return new THREE.Vector3(shift, c.y + 0.4, c.z - 0.72);
}

/** +1 if a node sits on the car's left (model +X), -1 on the right. */
function seatSide(o: THREE.Object3D): number {
  const p = new THREE.Vector3();
  o.getWorldPosition(p);
  return p.x >= 0 ? 1 : -1;
}
