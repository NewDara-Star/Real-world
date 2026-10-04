import * as THREE from "three";

// Loads a baked world tile (see tools/bake/bake_world.py) and builds cheap
// chunked meshes: one merged, vertex-coloured geometry per 200 m chunk, with
// lighting baked into the colours so low-end GPUs only do unlit fills.

export interface Place {
  name: string;
  cat: string;
  x: number;
  z: number;
}

export interface WorldMeta {
  name: string;
  half: { x: number; z: number };
  names: string[];
  places: Place[];
  spawn: { x: number; z: number };
  attribution: string;
}

interface RoadSeg {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  name: number;
  cls: number;
}

const CHUNK = 200;
const GRID = 20; // collision / query grid cell size (m)

// Gidi palette: sun-faded mainland walls and rusty zinc / concrete roofs.
const WALLS = [0xe9dcc0, 0xebbd92, 0xe6d27f, 0xa9c9d6, 0xb3d4b5, 0xf2ede2, 0xdc947a, 0xc4bcae, 0xd9b8d0, 0xe0c9a0];
const ZINC_ROOFS = [0x8f6b50, 0xa6795a, 0x7c7f83, 0x6f5e50, 0x9a8f80];
const FLAT_ROOFS = [0xbdb5a6, 0xa8a196, 0xcfc6b4];

const ROAD_COLORS: Record<number, number> = {
  1: 0x45464b, 2: 0x47484d, 3: 0x4a4b50, 4: 0x4d4e52, 5: 0x535355, 6: 0x5d5a57,
  7: 0x67615b, 8: 0x9c7f5f, 9: 0xa48c6c, 10: 0x5b4a3c, 11: 0x3f7d8b,
};
const AREA_COLORS: Record<number, number> = { 1: 0x3f7d8b, 2: 0x7ea35a, 3: 0x6b9d4c, 4: 0xb6ab98 };
const GROUND = 0xc8b38c;
const SUN = new THREE.Vector3(-0.45, 0.8, -0.35).normalize();

export class World {
  meta!: WorldMeta;
  group = new THREE.Group();
  private chunks: THREE.Mesh[] = [];
  private edges = new Map<number, number[]>(); // grid cell -> flat [ax,az,bx,bz,...] wall edges
  private roads = new Map<number, RoadSeg[]>();
  private footprints = new Map<number, Float32Array[]>();

  async load(name: string, onProgress?: (p: number) => void): Promise<void> {
    const [metaRes, bin] = await Promise.all([
      fetch(`/world/${name}.json`).then((r) => r.json() as Promise<WorldMeta>),
      fetchWithProgress(`/world/${name}.bin`, onProgress),
    ]);
    this.meta = metaRes;
    this.build(new DataView(bin));
  }

  private build(v: DataView) {
    let o = 0;
    const magic = String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3));
    if (magic !== "LGW1") throw new Error("bad world file");
    o = 4;
    const chunkBuilders = new Map<string, Builder>();
    const builderFor = (x: number, z: number) => {
      const key = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
      let b = chunkBuilders.get(key);
      if (!b) chunkBuilders.set(key, (b = new Builder()));
      return b;
    };
    const readPts = (n: number) => {
      const pts = new Float32Array(n * 2);
      for (let i = 0; i < n * 2; i++) pts[i] = v.getInt16(o + i * 2, true) / 10;
      o += n * 4;
      return pts;
    };

    // Buildings
    const nb = v.getUint32(o, true);
    o += 4;
    for (let i = 0; i < nb; i++) {
      const h = v.getUint16(o, true) / 10;
      const n = v.getUint16(o + 2, true);
      o += 4;
      const pts = readPts(n);
      const c = centroid(pts);
      builderFor(c.x, c.z).building(pts, h, i);
      this.indexBuilding(pts);
    }

    // Roads (drawn in class order so big roads sit on top)
    const nr = v.getUint32(o, true);
    o += 4;
    const roads: { cls: number; w: number; name: number; pts: Float32Array }[] = [];
    for (let i = 0; i < nr; i++) {
      const cls = v.getUint8(o);
      const w = v.getUint8(o + 1) / 2;
      const name = v.getUint16(o + 2, true);
      const n = v.getUint16(o + 4, true);
      o += 6;
      roads.push({ cls, w, name, pts: readPts(n) });
    }
    roads.sort((a, b) => b.cls - a.cls);
    for (const r of roads) {
      const y = r.cls === 11 ? 0.03 : 0.05 + (12 - r.cls) * 0.008;
      for (let i = 0; i + 3 < r.pts.length; i += 2) {
        const ax = r.pts[i], az = r.pts[i + 1], bx = r.pts[i + 2], bz = r.pts[i + 3];
        builderFor((ax + bx) / 2, (az + bz) / 2).ribbon(ax, az, bx, bz, r.w, y, ROAD_COLORS[r.cls] ?? 0x5d5a57);
        if (r.cls <= 9) this.indexRoad({ ax, az, bx, bz, name: r.name, cls: r.cls });
      }
    }

    // Areas
    const na = v.getUint32(o, true);
    o += 4;
    for (let i = 0; i < na; i++) {
      const kind = v.getUint8(o);
      const n = v.getUint16(o + 1, true);
      o += 3;
      const pts = readPts(n);
      const c = centroid(pts);
      builderFor(c.x, c.z).flat(pts, kind === 1 ? 0.025 : 0.02, AREA_COLORS[kind] ?? 0x999999);
    }

    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
    for (const b of chunkBuilders.values()) {
      const mesh = new THREE.Mesh(b.geometry(), mat);
      mesh.matrixAutoUpdate = false;
      this.chunks.push(mesh);
      this.group.add(mesh);
    }

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(this.meta.half.x * 2 + 2000, this.meta.half.z * 2 + 2000),
      new THREE.MeshBasicMaterial({ color: GROUND, fog: true }),
    );
    ground.rotation.x = -Math.PI / 2;
    this.group.add(ground);
  }

  /** Hide chunks beyond the fog so the GPU skips them entirely. */
  cull(x: number, z: number, radius: number) {
    const r = radius + CHUNK * 0.75;
    for (const m of this.chunks) {
      const s = m.geometry.boundingSphere!;
      m.visible = (s.center.x - x) ** 2 + (s.center.z - z) ** 2 < r * r;
    }
  }

  inBounds(x: number, z: number) {
    return Math.abs(x) < this.meta.half.x - 2 && Math.abs(z) < this.meta.half.z - 2;
  }

  /** Push a circle out of building walls. Mutates and returns pos. */
  collide(pos: THREE.Vector3, radius: number): THREE.Vector3 {
    pos.x = clamp(pos.x, -this.meta.half.x + 2, this.meta.half.x - 2);
    pos.z = clamp(pos.z, -this.meta.half.z + 2, this.meta.half.z - 2);
    for (let iter = 0; iter < 2; iter++) {
      const e = this.edges.get(cellKey(pos.x, pos.z));
      if (!e) return pos;
      for (let i = 0; i < e.length; i += 4) {
        const ax = e[i], az = e[i + 1], bx = e[i + 2], bz = e[i + 3];
        const dx = bx - ax, dz = bz - az;
        const len2 = dx * dx + dz * dz || 1;
        const t = clamp(((pos.x - ax) * dx + (pos.z - az) * dz) / len2, 0, 1);
        const cx = ax + t * dx, cz = az + t * dz;
        const ox = pos.x - cx, oz = pos.z - cz;
        const d2 = ox * ox + oz * oz;
        if (d2 < radius * radius) {
          const d = Math.sqrt(d2) || 0.0001;
          pos.x = cx + (ox / d) * radius;
          pos.z = cz + (oz / d) * radius;
        }
      }
    }
    return pos;
  }

  insideBuilding(x: number, z: number): boolean {
    const list = this.footprints.get(cellKey(x, z));
    return !!list?.some((p) => pointInPoly(p, x, z));
  }

  /** Nearest open spot to (x, z), preferring a point on a nearby street. */
  findOpen(x: number, z: number): { x: number; z: number } {
    let best = 80 * 80;
    let spot: { x: number; z: number } | null = null;
    const cx = Math.floor(x / GRID), cz = Math.floor(z / GRID);
    for (let i = -4; i <= 4; i++) {
      for (let j = -4; j <= 4; j++) {
        for (const s of this.roads.get(key(cx + i, cz + j)) ?? []) {
          if (s.cls > 7) continue; // skip footpaths and tracks
          const mx = (s.ax + s.bx) / 2, mz = (s.az + s.bz) / 2;
          const d2 = (mx - x) ** 2 + (mz - z) ** 2;
          if (d2 < best && this.inBounds(mx, mz) && !this.insideBuilding(mx, mz)) {
            best = d2;
            spot = { x: mx, z: mz };
          }
        }
      }
    }
    return spot ?? this.openSpotNear(x, z);
  }

  /** Nearest open spot to (x, z), searching outward in rings. */
  openSpotNear(x: number, z: number): { x: number; z: number } {
    for (let r = 0; r < 60; r += 2) {
      for (let a = 0; a < 16; a++) {
        const px = x + Math.cos((a / 16) * Math.PI * 2) * r;
        const pz = z + Math.sin((a / 16) * Math.PI * 2) * r;
        if (this.inBounds(px, pz) && !this.insideBuilding(px, pz)) return { x: px, z: pz };
      }
    }
    return { x, z };
  }

  /** Name of the nearest named road within 40 m, for the location HUD. */
  streetAt(x: number, z: number): string | null {
    let best = 40 * 40;
    let name = -1;
    const cx = Math.floor(x / GRID), cz = Math.floor(z / GRID);
    for (let i = -2; i <= 2; i++) {
      for (let j = -2; j <= 2; j++) {
        for (const s of this.roads.get(key(cx + i, cz + j)) ?? []) {
          if (s.name === 0xffff) continue;
          const d2 = segDist2(x, z, s.ax, s.az, s.bx, s.bz);
          if (d2 < best) {
            best = d2;
            name = s.name;
          }
        }
      }
    }
    return name >= 0 ? this.meta.names[name] : null;
  }

  private indexBuilding(pts: Float32Array) {
    const n = pts.length / 2;
    const cells = new Set<number>();
    for (let i = 0; i < n; i++) {
      const ax = pts[i * 2], az = pts[i * 2 + 1];
      const bx = pts[((i + 1) % n) * 2], bz = pts[((i + 1) % n) * 2 + 1];
      // Register each edge in every cell its padded bounding box touches.
      for (let gx = Math.floor((Math.min(ax, bx) - 1) / GRID); gx <= Math.floor((Math.max(ax, bx) + 1) / GRID); gx++) {
        for (let gz = Math.floor((Math.min(az, bz) - 1) / GRID); gz <= Math.floor((Math.max(az, bz) + 1) / GRID); gz++) {
          const k = key(gx, gz);
          let e = this.edges.get(k);
          if (!e) this.edges.set(k, (e = []));
          e.push(ax, az, bx, bz);
          cells.add(k);
        }
      }
    }
    // Footprints go in every cell their bounding box covers, not just cells
    // their walls cross, so the middle of a big building still counts as inside.
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      minX = Math.min(minX, pts[i * 2]);
      maxX = Math.max(maxX, pts[i * 2]);
      minZ = Math.min(minZ, pts[i * 2 + 1]);
      maxZ = Math.max(maxZ, pts[i * 2 + 1]);
    }
    for (let gx = Math.floor(minX / GRID); gx <= Math.floor(maxX / GRID); gx++) {
      for (let gz = Math.floor(minZ / GRID); gz <= Math.floor(maxZ / GRID); gz++) cells.add(key(gx, gz));
    }
    for (const k of cells) {
      let l = this.footprints.get(k);
      if (!l) this.footprints.set(k, (l = []));
      l.push(pts);
    }
  }

  private indexRoad(s: RoadSeg) {
    const k = key(Math.floor((s.ax + s.bx) / 2 / GRID), Math.floor((s.az + s.bz) / 2 / GRID));
    let l = this.roads.get(k);
    if (!l) this.roads.set(k, (l = []));
    l.push(s);
  }
}

/** Accumulates positions + colours for one chunk. */
class Builder {
  pos: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  private c = new THREE.Color();

  private vert(x: number, y: number, z: number, color: THREE.Color, shade: number) {
    this.pos.push(x, y, z);
    this.col.push(color.r * shade, color.g * shade, color.b * shade);
    return this.pos.length / 3 - 1;
  }

  building(pts: Float32Array, h: number, seed: number) {
    const n = pts.length / 2;
    const wall = this.c.setHex(WALLS[hash(seed) % WALLS.length]).clone();
    const roof = new THREE.Color(h > 9 ? FLAT_ROOFS[hash(seed + 7) % FLAT_ROOFS.length] : ZINC_ROOFS[hash(seed + 3) % ZINC_ROOFS.length]);
    for (let i = 0; i < n; i++) {
      const ax = pts[i * 2], az = pts[i * 2 + 1];
      const bx = pts[((i + 1) % n) * 2], bz = pts[((i + 1) % n) * 2 + 1];
      // Outward normal for a ring that is clockwise when viewed from above (+y).
      let nx = bz - az, nz = -(bx - ax);
      const len = Math.hypot(nx, nz) || 1;
      nx /= len;
      nz /= len;
      const lit = 0.62 + 0.38 * Math.max(0, nx * SUN.x + nz * SUN.z);
      const a = this.vert(ax, 0, az, wall, lit * 0.72);
      const b = this.vert(bx, 0, bz, wall, lit * 0.72);
      const c = this.vert(bx, h, bz, wall, lit);
      const d = this.vert(ax, h, az, wall, lit);
      this.idx.push(a, c, b, a, d, c);
    }
    const contour: THREE.Vector2[] = [];
    for (let i = 0; i < n; i++) contour.push(new THREE.Vector2(pts[i * 2], pts[i * 2 + 1]));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    const base = this.pos.length / 3;
    for (let i = 0; i < n; i++) this.vert(pts[i * 2], h, pts[i * 2 + 1], roof, 0.95);
    for (const t of tris) this.idx.push(base + t[0], base + t[2], base + t[1]);
  }

  ribbon(ax: number, az: number, bx: number, bz: number, w: number, y: number, hex: number) {
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz) || 1;
    const px = (-dz / len) * (w / 2), pz = (dx / len) * (w / 2);
    // Extend slightly along the segment so consecutive pieces overlap at bends.
    const ex = (dx / len) * (w / 2) * 0.9, ez = (dz / len) * (w / 2) * 0.9;
    const c = this.c.setHex(hex);
    const a = this.vert(ax + px - ex, y, az + pz - ez, c, 1);
    const b = this.vert(ax - px - ex, y, az - pz - ez, c, 1);
    const d = this.vert(bx - px + ex, y, bz - pz + ez, c, 1);
    const e = this.vert(bx + px + ex, y, bz + pz + ez, c, 1);
    this.idx.push(a, b, d, a, d, e, a, d, b, a, e, d);
  }

  flat(pts: Float32Array, y: number, hex: number) {
    const n = pts.length / 2;
    const contour: THREE.Vector2[] = [];
    for (let i = 0; i < n; i++) contour.push(new THREE.Vector2(pts[i * 2], pts[i * 2 + 1]));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    const c = this.c.setHex(hex);
    const base = this.pos.length / 3;
    for (let i = 0; i < n; i++) this.vert(pts[i * 2], y, pts[i * 2 + 1], c, 1);
    for (const t of tris) this.idx.push(base + t[0], base + t[1], base + t[2], base + t[0], base + t[2], base + t[1]);
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    const nverts = this.pos.length / 3;
    g.setIndex(nverts > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

async function fetchWithProgress(url: string, onProgress?: (p: number) => void): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`failed to load ${url}`);
  const total = Number(res.headers.get("content-length")) || 0;
  if (!total || !onProgress) return res.arrayBuffer();
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    onProgress(Math.min(1, got / total));
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out.buffer;
}

function centroid(pts: Float32Array) {
  let x = 0, z = 0;
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    x += pts[i * 2];
    z += pts[i * 2 + 1];
  }
  return { x: x / n, z: z / n };
}

function pointInPoly(p: Float32Array, x: number, z: number): boolean {
  let inside = false;
  const n = p.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = p[i * 2], zi = p[i * 2 + 1], xj = p[j * 2], zj = p[j * 2 + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function segDist2(x: number, z: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az;
  const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
  return (x - ax - t * dx) ** 2 + (z - az - t * dz) ** 2;
}

const key = (gx: number, gz: number) => (gx + 1000) * 4000 + (gz + 1000);
const cellKey = (x: number, z: number) => key(Math.floor(x / GRID), Math.floor(z / GRID));
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const hash = (n: number) => {
  let h = Math.imul(n, 2654435761) >>> 0;
  h ^= h >>> 15;
  return h >>> 0; // XOR yields a signed int; keep it unsigned so % indexes stay positive

};
