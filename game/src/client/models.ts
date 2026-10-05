import * as THREE from "three/webgpu";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FACADE_LAMP, FACADE_PLAIN, FACADE_PROP_BRICK, FACADE_PROP_CONCRETE, FACADE_PROP_RENDER } from "./facade";
import type { Template } from "./props";

// The local Claude's Blender models (public/models, docs/blender-assets.md §4)
// as stamp templates for the city chunks: indexed, flat, one colour and one
// surface code per material. A material naming a texture set in its extras
// ("surface": brick / render / concrete) is drawn with that photo set by the
// city shader; nothing is embedded in the file. Colour variants
// (KHR_materials_variants) are read from the file's own material list.

const SURFACE: Record<string, number> = { brick: FACADE_PROP_BRICK, render: FACADE_PROP_RENDER, concrete: FACADE_PROP_CONCRETE };
/** Materials that glow at night, by name. */
const GLOW: Record<string, number> = { LampLens: FACADE_LAMP };

interface RawMaterial {
  name?: string;
  extras?: { surface?: string };
  pbrMetallicRoughness?: { baseColorFactor?: number[] };
}

/**
 * Flatten a loaded glTF into one template. `swap` replaces a material by
 * another of the file's materials (by name): a variant, e.g. a brick wall
 * instead of a rendered one, or a brown bin instead of a green one.
 */
export function gltfTemplate(gltf: GLTF, swap: Record<string, string> = {}): Template {
  const raw = ((gltf.parser.json as { materials?: RawMaterial[] }).materials ?? []);
  const byName = new Map(raw.map((m) => [m.name ?? "", m]));
  const pos: number[] = [], col: number[] = [], nrm: number[] = [], code: number[] = [], idx: number[] = [];
  const v = new THREE.Vector3(), nm = new THREE.Matrix3();
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    const name = swap[mat.name] ?? mat.name;
    const r = byName.get(name);
    const f = r?.pbrMetallicRoughness?.baseColorFactor;
    const colour = f ? new THREE.Color(f[0], f[1], f[2]) : mat.color; // linear, as glTF stores it
    const surface = r?.extras?.surface ?? (mat.userData.surface as string | undefined);
    const c = (surface ? SURFACE[surface] : undefined) ?? GLOW[name] ?? FACADE_PLAIN;
    const g = mesh.geometry;
    const p = g.getAttribute("position"), n = g.getAttribute("normal");
    nm.getNormalMatrix(mesh.matrixWorld);
    const base = pos.length / 3;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld);
      pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      nrm.push(v.x, v.y, v.z);
      col.push(colour.r, colour.g, colour.b);
      code.push(c);
    }
    const index = g.getIndex();
    if (index) for (let i = 0; i < index.count; i++) idx.push(base + index.getX(i));
    else for (let i = 0; i < p.count; i++) idx.push(base + i);
  });
  return { pos: new Float32Array(pos), col: new Float32Array(col), nrm: new Float32Array(nrm), code: new Float32Array(code), idx: new Uint32Array(idx) };
}

export interface StreetModels {
  wall: { render: Template; brick: Template };
  pier: { render: Template; brick: Template };
  /** Black (general waste), green (recycling), brown (food and garden). */
  bins: [Template, Template, Template];
  lamp: Template;
}

/** Load the street furniture used by the Dublin streets, or null if any file is missing. */
export async function loadStreetModels(base = "/models/"): Promise<StreetModels | null> {
  const loader = new GLTFLoader();
  try {
    const [wall, pier, bin, lamp] = await Promise.all(
      ["garden_wall_section_1m", "garden_wall_pier", "wheelie_bin", "lamp_post_led"].map((n) => loader.loadAsync(`${base}${n}.glb`)),
    );
    return {
      wall: { render: gltfTemplate(wall), brick: gltfTemplate(wall, { WallRender: "WallBrick" }) },
      pier: { render: gltfTemplate(pier), brick: gltfTemplate(pier, { WallRender: "WallBrick" }) },
      bins: [gltfTemplate(bin, { BinGreen: "BinBlack" }), gltfTemplate(bin), gltfTemplate(bin, { BinGreen: "BinBrown" })],
      lamp: gltfTemplate(lamp),
    };
  } catch (err) {
    console.warn("street models missing; streets drawn without them", err);
    return null;
  }
}

/**
 * Load vehicle models by file name (trafficnet.ts VEHICLE_MODELS: one per
 * traffic kind), each the glTF scene, front +Z on the ground, origin midway
 * between the axles. A file that won't load comes back null (that kind keeps
 * its box); a file named twice loads once.
 */
export async function loadVehicleModels(files: string[], base = "/models/"): Promise<(THREE.Object3D | null)[]> {
  const loader = new GLTFLoader();
  const cache = new Map<string, Promise<THREE.Object3D | null>>();
  const load = (f: string) => {
    if (!cache.has(f)) cache.set(f, loader.loadAsync(`${base}${f}.glb`).then((g) => g.scene, () => null));
    return cache.get(f)!;
  };
  return Promise.all(files.map(load));
}
