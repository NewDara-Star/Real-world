import * as THREE from "three/webgpu";
import { float, length, smoothstep, uv, vec3 } from "three/tsl";
import { nightUniform } from "./facade";

// Fake streetlight pools: one instanced, additively blended disc per lamp.
// Hundreds of real point lights would cost too much; a soft glow decal on the
// road reads the same from a car and costs one draw call for the whole city.

export function createLightPools(lamps: number[]): THREE.InstancedMesh {
  const count = lamps.length / 2;
  const geo = new THREE.CircleGeometry(7.5, 24).rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  // Radial falloff from the disc centre (uv 0.5, 0.5), sodium orange.
  const d = length(uv().sub(0.5)).mul(2);
  const falloff = smoothstep(float(1), float(0), d).pow(2.2);
  mat.colorNode = vec3(1.0, 0.6, 0.26).mul(falloff).mul(nightUniform).mul(1.3);
  mat.fog = false;
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
  const m = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    m.makeTranslation(lamps[i * 2], 0.09, lamps[i * 2 + 1]);
    mesh.setMatrixAt(i, m);
  }
  mesh.count = count;
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  return mesh;
}
