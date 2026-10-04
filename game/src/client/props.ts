import * as THREE from "three/webgpu";
import type { World } from "./world";
import { pointInPoly } from "./world";

// Low-poly street furniture as tiny vertex-coloured templates. Static props are
// stamped straight into the city chunks (no extra draw calls); vehicles and
// pedestrians reuse the same template format for their instanced meshes.

export interface Template {
  pos: Float32Array;
  col: Float32Array;
  nrm: Float32Array;
  /** Optional per-vertex facade code (e.g. glowing lamp heads); plain if absent. */
  code?: Float32Array;
  /** Triangle indices (models from glTF); absent = every three vertices are a triangle. */
  idx?: Uint32Array;
}

type Part = [THREE.BufferGeometry, number] | [THREE.BufferGeometry, number, number];

/** Merge coloured parts into one template (flat-shaded normals; lit by the real sun). */
export function makeTemplate(parts: Part[]): Template {
  const pos: number[] = [];
  const col: number[] = [];
  const nrm: number[] = [];
  const codes: number[] = [];
  let anyCode = false;
  const n = new THREE.Vector3();
  const c = new THREE.Color();
  for (const part of parts) {
    const [geo, hex] = part;
    const code = part[2] ?? -1;
    if (part[2] !== undefined) anyCode = true;
    const g = geo.index ? geo.toNonIndexed() : geo;
    // Keep smooth normals that rounded shapes (spheres, detail>0 icosahedra) bring.
    if (!g.getAttribute("normal")) g.computeVertexNormals();
    const p = g.getAttribute("position");
    const nm = g.getAttribute("normal");
    c.setHex(hex);
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      n.fromBufferAttribute(nm, i);
      nrm.push(n.x, n.y, n.z);
      col.push(c.r, c.g, c.b);
      codes.push(code);
    }
  }
  return { pos: new Float32Array(pos), col: new Float32Array(col), nrm: new Float32Array(nrm), code: anyCode ? new Float32Array(codes) : undefined };
}

export function templateGeometry(t: Template): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(t.pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(t.col, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(t.nrm, 3));
  g.computeBoundingSphere();
  return g;
}

const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);

/**
 * Rounded puff of foliage: a 20-face icosahedron (cheap) with sphere normals,
 * so lighting reads soft and round rather than faceted.
 */
const puff = (r: number, x: number, y: number, z: number, squash = 0.85) => {
  const g = new THREE.IcosahedronGeometry(r, 0);
  const p = g.getAttribute("position");
  const n: number[] = [];
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    n.push(v.x, v.y, v.z);
  }
  g.setAttribute("normal", new THREE.Float32BufferAttribute(n, 3));
  return g.scale(1, squash, 1).translate(x, y, z);
};

/** Neem: a full, round, puffy crown on a short trunk. */
function shadeTree(): Template {
  const trunk = new THREE.CylinderGeometry(0.18, 0.28, 3.6, 7).translate(0, 1.8, 0);
  return makeTemplate([
    [trunk, 0x6b4a32],
    [puff(2.1, 0, 4.6, 0), 0x4c7f30],
    [puff(1.6, 1.3, 4.3, 0.6), 0x5a9038],
    [puff(1.5, -1.2, 4.4, -0.5), 0x467a2c],
    [puff(1.4, 0.2, 5.6, -0.9), 0x62993f],
    [puff(1.2, -0.4, 5.5, 1.1), 0x548a35],
  ]);
}

/** Almond (Terminalia): flat, layered tiers, the classic Lagos compound shade tree. */
function almondTree(): Template {
  const trunk = new THREE.CylinderGeometry(0.16, 0.26, 5.2, 7).translate(0, 2.6, 0);
  return makeTemplate([
    [trunk, 0x5e4330],
    [puff(2.6, 0, 3.6, 0, 0.32), 0x3f7a2c],
    [puff(2.1, 0.2, 4.6, 0.1, 0.32), 0x4f8a33],
    [puff(1.5, -0.1, 5.5, -0.1, 0.36), 0x5f9a3c],
  ]);
}

function palm(): Template {
  // Slightly leaning trunk, ten fronds that arch up then droop, coconuts.
  const parts: Part[] = [[new THREE.CylinderGeometry(0.15, 0.25, 7.2, 7).translate(0, 3.6, 0).rotateZ(0.05), 0x7a6249]];
  const top = new THREE.Vector3(0.36, 7.15, 0);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + (i % 2) * 0.2;
    const green = i % 3 === 0 ? 0x5f8f37 : i % 3 === 1 ? 0x4c7a2e : 0x6a9a3c;
    const inner = new THREE.BoxGeometry(1.7, 0.05, 0.62).translate(0.85, 0, 0).rotateZ(0.18).rotateY(a).translate(top.x, top.y, top.z);
    const tip = new THREE.Vector3(1.7 * Math.cos(0.18), 1.7 * Math.sin(0.18), 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
    const outer = new THREE.BoxGeometry(1.8, 0.05, 0.48).translate(0.9, 0, 0).rotateZ(-0.75).rotateY(a).translate(top.x + tip.x, top.y + tip.y, top.z + tip.z);
    parts.push([inner, green], [outer, green]);
  }
  for (let k = 0; k < 4; k++) {
    const a = k * 1.7;
    parts.push([new THREE.IcosahedronGeometry(0.17, 1).translate(top.x + Math.cos(a) * 0.25, top.y - 0.35, Math.sin(a) * 0.25), 0x6b5a2a]);
  }
  return makeTemplate(parts);
}

function pole(): Template {
  return makeTemplate([
    [box(0.2, 8.6, 0.2), 0x7d6a55],
    [box(1.7, 0.12, 0.12, 0, 7.9, 0), 0x5c5248],
    [box(0.45, 0.6, 0.45, 0.45, 7.0, 0), 0x6f7478], // transformer box
  ]);
}

function umbrellaSeller(variant: number): Template {
  const parts: Part[] = [[new THREE.CylinderGeometry(0.04, 0.04, 2.3, 4).translate(0, 1.15, 0), 0x444444]];
  // Alternating panel colours like the big branded street umbrellas.
  const colors = [[0xd62828, 0xf4f1de], [0x1d6fd6, 0xffd23f], [0x2a9d4a, 0xf4f1de], [0xffd23f, 0xd62828]][variant % 4];
  for (let i = 0; i < 8; i++) {
    const cone = new THREE.ConeGeometry(1.7, 0.6, 8, 1, true, (i / 8) * Math.PI * 2, Math.PI / 4).translate(0, 2.5, 0);
    parts.push([cone, colors[i % 2]]);
  }
  parts.push([box(1.1, 0.75, 0.7, 0.2, 0, 0.3), 0x8a6a4a]); // table
  parts.push([box(0.9, 0.12, 0.6, 0.2, 0.75, 0.3), 0xe8b04b]); // goods
  parts.push([box(0.5, 0.45, 0.5, -0.8, 0, -0.3), 0x2b6cb0]); // stool / cooler
  parts.push([box(0.38, 0.6, 0.28, -0.8, 0.45, -0.3), 0xc0392b]); // seated seller torso
  parts.push([box(0.24, 0.26, 0.24, -0.8, 1.05, -0.3), 0x6b4430]); // head
  return makeTemplate(parts);
}

function kiosk(variant: number): Template {
  const body = [0x2f80ed, 0x27ae60, 0xf2c94c, 0xeb5757, 0x9b51e0][variant % 5];
  return makeTemplate([
    [box(2.6, 2.5, 1.9), body],
    [box(2.9, 0.12, 2.4, 0, 2.5, 0.2), 0x7c7f83], // zinc overhang
    [box(1.8, 1.0, 0.05, 0, 1.0, 0.96), 0x2b2522], // open hatch
    [box(1.9, 0.08, 0.5, 0, 1.0, 1.15), 0x8a6a4a], // counter
    [box(2.0, 0.5, 0.04, 0, 1.95, 0.97), 0xffffff], // sign
  ]);
}

function wireSpan(): Template {
  // A unit-length sagging wire along +x, scaled per span when stamped.
  const parts: Part[] = [];
  const segs = 6;
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs;
    const y0 = -0.06 * Math.sin(t0 * Math.PI), y1 = -0.06 * Math.sin(t1 * Math.PI);
    const len = Math.hypot(t1 - t0, y1 - y0);
    const g = new THREE.BoxGeometry(len, 0.0009, 0.0009).rotateZ(Math.atan2(y1 - y0, t1 - t0)).translate((t0 + t1) / 2, (y0 + y1) / 2, 0);
    parts.push([g, 0x222222]);
  }
  return makeTemplate(parts);
}

function waterTank(): Template {
  // The ubiquitous black plastic tank on a block stand.
  return makeTemplate([
    [box(1.5, 0.5, 1.5), 0x8d8a84],
    [new THREE.CylinderGeometry(0.72, 0.78, 1.45, 14).translate(0, 1.22, 0), 0x1b1b1d],
    [new THREE.CylinderGeometry(0.3, 0.3, 0.12, 10).translate(0, 2.0, 0), 0x2a2a2c],
  ]);
}

function stairHead(): Template {
  return makeTemplate([
    [box(2.4, 2.5, 2.8), 0xd9cdb4],
    [box(2.6, 0.15, 3.0, 0, 2.5, 0), 0xb8ad98],
    [box(0.9, 2.0, 0.05, 0, 0, 1.42), 0x5b4230],
  ]);
}

function dish(): Template {
  const plate = new THREE.SphereGeometry(0.42, 12, 6, 0, Math.PI * 2, 0, Math.PI / 3).rotateX(-1.1).translate(0, 1.1, 0.05);
  return makeTemplate([
    [new THREE.CylinderGeometry(0.03, 0.03, 1.1, 5).translate(0, 0.55, 0), 0x777777],
    [plate, 0xe8e6e0],
  ]);
}

function rebar(): Template {
  // Four rusty rods sticking out of a column top.
  const parts: [THREE.BufferGeometry, number][] = [[box(0.32, 0.25, 0.32), 0xa59d8f]];
  for (const [x, z] of [[-0.1, -0.1], [0.1, -0.1], [-0.1, 0.1], [0.1, 0.1]]) parts.push([box(0.03, 1.6, 0.03, x, 0.25, z), 0x6b3b22]);
  return makeTemplate(parts);
}

/** Street lamp: galvanised pole, curved arm, sodium head that glows at night (code -8). */
function lamp(): Template {
  return makeTemplate([
    [new THREE.CylinderGeometry(0.07, 0.11, 7.5, 6).translate(0, 3.75, 0), 0x8b9096],
    [box(0.06, 0.06, 1.6, 0, 7.35, 0.75), 0x8b9096],
    [box(0.36, 0.12, 0.6, 0, 7.2, 1.5), 0x5c6166],
    [box(0.3, 0.04, 0.5, 0, 7.15, 1.5), 0xffd9a0, -8],
  ]);
}

export const TEMPLATES = {
  lamp: lamp(),
  almond: almondTree(),
  tank: waterTank(),
  stairhead: stairHead(),
  dish: dish(),
  rebar: rebar(),
  tree: shadeTree(),
  palm: palm(),
  pole: pole(),
  umbrella: umbrellaSeller(0),
  umbrella2: umbrellaSeller(1),
  umbrella3: umbrellaSeller(2),
  kiosk: kiosk(0),
  kiosk2: kiosk(3),
  wire: wireSpan(),
};
export type TemplateName = keyof typeof TEMPLATES;

export interface PropPlacement {
  t: TemplateName;
  x: number;
  z: number;
  rot: number;
  s: number;
  /** Optional height offset (wires hang at pole-top height). */
  y?: number;
}

/**
 * Deterministic street furniture placement for a world tile. `lamps` false
 * when the place has its real lamp posts (World.streetLamps).
 */
export function placeProps(world: World, lamps = true): PropPlacement[] {
  const out: PropPlacement[] = [];
  const lagos = world.city.lagosLife;
  const rand = mulberry32(1337);
  const free = (x: number, z: number, margin: number) =>
    world.inBounds(x, z) && !world.insideBuilding(x, z) && world.roadClearance(x, z) > margin;

  // Junction nodes (3+ road ends meeting) attract street sellers.
  const nodes = new Map<string, { x: number; z: number; n: number }>();
  for (const r of world.roads) {
    if (r.cls > 7) continue;
    for (const k of [0, r.pts.length - 2]) {
      const x = r.pts[k], z = r.pts[k + 1];
      const key = `${Math.round(x)},${Math.round(z)}`;
      const nd = nodes.get(key) ?? { x, z, n: 0 };
      nd.n++;
      nodes.set(key, nd);
    }
  }

  for (const r of world.roads) {
    if (r.cls < 2 || r.cls > 7) continue;
    const pts = r.pts;
    let poleLast: { x: number; z: number } | null = null;
    let sinceTree = rand() * 20, sincePole = rand() * 35, sinceKiosk = rand() * 80, sinceLamp = rand() * 30;
    let lampSide = 1;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const ax = pts[i], az = pts[i + 1], bx = pts[i + 2], bz = pts[i + 3];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.5) continue;
      const dx = (bx - ax) / len, dz = (bz - az) / len;
      const nx = -dz, nz = dx;
      const heading = Math.atan2(dx, dz);
      for (let d = 0; d < len; d += 3) {
        const px = ax + dx * d, pz = az + dz * d;
        sinceTree += 3;
        sincePole += 3;
        sinceKiosk += 3;
        sinceLamp += 3;
        // Streetlights on the main roads, alternating sides, arm over the road.
        if (lamps && (r.cls <= 5 || (!lagos && r.cls <= 6)) && sinceLamp > (lagos ? 32 : 38)) {
          const off = r.w / 2 + 0.6;
          const tx = px + nx * off * lampSide, tz = pz + nz * off * lampSide;
          if (free(tx, tz, 0.3)) {
            // Template arm points along +z; face it toward the road centre.
            out.push({ t: "lamp", x: tx, z: tz, rot: Math.atan2(-nx * lampSide, -nz * lampSide), s: 1 });
            sinceLamp = 0;
            lampSide = -lampSide;
          }
        }
        // Trees: denser on quiet streets, sparse on big roads.
        const treeGap = (r.cls >= 6 ? 16 : 26) * (lagos ? 1 : 1.6);
        if (sinceTree > treeGap && rand() < 0.5) {
          const side = rand() < 0.5 ? 1 : -1;
          const off = r.w / 2 + 2.2 + rand() * 2;
          const tx = px + nx * off * side, tz = pz + nz * off * side;
          if (free(tx, tz, 1.5)) {
            const kind = lagos ? (r.cls <= 4 && rand() < 0.4 ? "palm" : rand() < 0.4 ? "almond" : "tree") : "tree";
            out.push({ t: kind, x: tx, z: tz, rot: rand() * 6.28, s: 0.8 + rand() * 0.5 });
            sinceTree = 0;
          }
        }
        // NEPA poles on one side of roads big enough to carry lines, with wires between.
        if (lagos && r.cls <= 6 && sincePole > 34) {
          const off = r.w / 2 + 1.0;
          const tx = px + nx * off, tz = pz + nz * off;
          if (free(tx, tz, 0.5)) {
            out.push({ t: "pole", x: tx, z: tz, rot: heading, s: 1 });
            if (poleLast) {
              const sx = tx - poleLast.x, sz = tz - poleLast.z;
              const span = Math.hypot(sx, sz);
              if (span < 45) {
                const rot = Math.atan2(-sz, sx);
                for (const yo of [7.95, 7.75]) {
                  out.push({ t: "wire", x: poleLast.x, z: poleLast.z, rot, s: span, y: yo });
                }
              }
            }
            poleLast = { x: tx, z: tz };
            sincePole = 0;
          }
        }
        // Container kiosks along busier streets.
        if (lagos && r.cls >= 4 && r.cls <= 6 && sinceKiosk > 70 && rand() < 0.35) {
          const side = rand() < 0.5 ? 1 : -1;
          const off = r.w / 2 + 2.0;
          const tx = px + nx * off * side, tz = pz + nz * off * side;
          if (free(tx, tz, 1.6)) {
            out.push({ t: rand() < 0.5 ? "kiosk" : "kiosk2", x: tx, z: tz, rot: heading + (side > 0 ? Math.PI / 2 : -Math.PI / 2), s: 1 });
            sinceKiosk = 0;
          }
        }
      }
    }
  }

  // Umbrella sellers cluster at busy junctions.
  for (const nd of nodes.values()) {
    if (!lagos || nd.n < 3) continue;
    const count = Math.floor(rand() * 4);
    for (let k = 0; k < count; k++) {
      const a = rand() * Math.PI * 2, r = 6 + rand() * 9;
      const x = nd.x + Math.cos(a) * r, z = nd.z + Math.sin(a) * r;
      if (free(x, z, 0.8)) out.push({ t: (["umbrella", "umbrella2", "umbrella3"] as const)[k % 3], x, z, rot: rand() * 6.28, s: 1 });
    }
  }

  // Markets get a crowd of umbrellas.
  for (const p of world.meta.places) {
    if (!lagos || !/market|shopping/.test(p.cat)) continue;
    for (let k = 0; k < 14; k++) {
      const a = rand() * Math.PI * 2, r = 8 + rand() * 30;
      const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
      if (free(x, z, 0.5)) out.push({ t: (["umbrella", "umbrella2", "umbrella3"] as const)[k % 3], x, z, rot: rand() * 6.28, s: 1 });
    }
  }

  // Trees inside parks, pitches' edges and other green areas.
  for (const a of world.areas) {
    if (a.kind !== 2) continue;
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < a.pts.length; i += 2) {
      minX = Math.min(minX, a.pts[i]);
      maxX = Math.max(maxX, a.pts[i]);
      minZ = Math.min(minZ, a.pts[i + 1]);
      maxZ = Math.max(maxZ, a.pts[i + 1]);
    }
    for (let x = minX; x < maxX; x += 11) {
      for (let z = minZ; z < maxZ; z += 11) {
        const jx = x + rand() * 8, jz = z + rand() * 8;
        if (rand() < 0.55 && pointInPoly(a.pts, jx, jz) && free(jx, jz, 1)) {
          const kind = lagos ? (rand() < 0.2 ? "palm" : rand() < 0.35 ? "almond" : "tree") : "tree";
          out.push({ t: kind, x: jx, z: jz, rot: rand() * 6.28, s: 0.8 + rand() * 0.6 });
        }
      }
    }
  }
  return out;
}

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
