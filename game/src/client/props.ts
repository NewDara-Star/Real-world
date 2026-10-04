import * as THREE from "three";
import type { World } from "./world";
import { pointInPoly } from "./world";

// Low-poly street furniture as tiny vertex-coloured templates. Static props are
// stamped straight into the city chunks (no extra draw calls); vehicles and
// pedestrians reuse the same template format for their instanced meshes.

export interface Template {
  pos: Float32Array;
  col: Float32Array;
}

const SUN = new THREE.Vector3(-0.45, 0.8, -0.35).normalize();

type Part = [THREE.BufferGeometry, number];

/** Merge coloured parts into one template with baked sun shading. */
export function makeTemplate(parts: Part[]): Template {
  const pos: number[] = [];
  const col: number[] = [];
  const n = new THREE.Vector3();
  const c = new THREE.Color();
  for (const [geo, hex] of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.computeVertexNormals();
    const p = g.getAttribute("position");
    const nm = g.getAttribute("normal");
    c.setHex(hex);
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      n.fromBufferAttribute(nm, i);
      const lit = 0.62 + 0.38 * Math.max(0, n.dot(SUN)) + 0.08 * Math.max(0, n.y);
      col.push(c.r * lit, c.g * lit, c.b * lit);
    }
  }
  return { pos: new Float32Array(pos), col: new Float32Array(col) };
}

export function templateGeometry(t: Template): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(t.pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(t.col, 3));
  g.computeBoundingSphere();
  return g;
}

const box = (w: number, h: number, d: number, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);

function shadeTree(): Template {
  const canopy = new THREE.IcosahedronGeometry(2.3, 0).scale(1.25, 0.75, 1.25).translate(0, 4.6, 0);
  const canopy2 = new THREE.IcosahedronGeometry(1.6, 0).scale(1.2, 0.7, 1.2).translate(0.9, 5.4, -0.4);
  return makeTemplate([[box(0.32, 3.8, 0.32), 0x6b4a32], [canopy, 0x4f7d34], [canopy2, 0x5d8c3c]]);
}

function palm(): Template {
  const parts: Part[] = [[new THREE.CylinderGeometry(0.16, 0.24, 7, 5).translate(0.25, 3.5, 0), 0x7a6249]];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const frond = new THREE.BoxGeometry(3.1, 0.06, 0.55).translate(1.5, 0, 0).rotateZ(-0.38).rotateY(a).translate(0.25, 7, 0);
    parts.push([frond, i % 2 ? 0x4c7a2e : 0x5f8f37]);
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

export const TEMPLATES = {
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

/** Deterministic street furniture placement for a world tile. */
export function placeProps(world: World): PropPlacement[] {
  const out: PropPlacement[] = [];
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
    let sinceTree = rand() * 20, sincePole = rand() * 35, sinceKiosk = rand() * 80;
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
        // Trees: denser on quiet streets, sparse on big roads.
        const treeGap = r.cls >= 6 ? 16 : 26;
        if (sinceTree > treeGap && rand() < 0.5) {
          const side = rand() < 0.5 ? 1 : -1;
          const off = r.w / 2 + 2.2 + rand() * 2;
          const tx = px + nx * off * side, tz = pz + nz * off * side;
          if (free(tx, tz, 1.5)) {
            out.push({ t: r.cls <= 4 && rand() < 0.5 ? "palm" : "tree", x: tx, z: tz, rot: rand() * 6.28, s: 0.8 + rand() * 0.5 });
            sinceTree = 0;
          }
        }
        // NEPA poles on one side of roads big enough to carry lines, with wires between.
        if (r.cls <= 6 && sincePole > 34) {
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
        if (r.cls >= 4 && r.cls <= 6 && sinceKiosk > 70 && rand() < 0.35) {
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
    if (nd.n < 3) continue;
    const count = Math.floor(rand() * 4);
    for (let k = 0; k < count; k++) {
      const a = rand() * Math.PI * 2, r = 6 + rand() * 9;
      const x = nd.x + Math.cos(a) * r, z = nd.z + Math.sin(a) * r;
      if (free(x, z, 0.8)) out.push({ t: (["umbrella", "umbrella2", "umbrella3"] as const)[k % 3], x, z, rot: rand() * 6.28, s: 1 });
    }
  }

  // Markets get a crowd of umbrellas.
  for (const p of world.meta.places) {
    if (!/market|shopping/.test(p.cat)) continue;
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
          out.push({ t: rand() < 0.25 ? "palm" : "tree", x: jx, z: jz, rot: rand() * 6.28, s: 0.8 + rand() * 0.6 });
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
