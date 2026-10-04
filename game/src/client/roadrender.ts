import * as THREE from "three/webgpu";
import { FACADE_KERB, FACADE_PATH, FACADE_PLAIN, FACADE_ROAD } from "./facade";
import { ALLOW_CAR, EDGE_CANONICAL, EDGE_GIVE_WAY, EDGE_STOP, EDGE_TWO_WAY, LaneKind, MARKED, type Lane, type RoadNet } from "./roadnet";
import type { Builder } from "./world";

// Streets built from the road network instead of plain ribbons: asphalt
// lanes and junction surfaces, raised concrete footpaths with kerb faces,
// and Irish road markings: broken white centre and lane lines, yellow edge
// lines on faster roads, stop lines, double broken give-way lines, zebra
// crossings and the studded lines of signal-controlled crossings.

type BuilderFor = (x: number, z: number) => Builder;

const ROAD_Y = 0.03;
const PATH_Y = 0.15; // kerb height ~12 cm above the road
const PAINT = 0.008;
const ASPHALT = 0x85868a;
const PATH = 0xaeaba4;
const KERB = 0xb4b0a8;
const WHITE = 0xe9e7e0;
const YELLOW = 0xe0b62c;

const col = new THREE.Color();

/** A horizontal quad, wound to face up whatever order the corners come in. */
function quadUp(b: Builder, p: number[], y: number, hex: number, code: number, u0 = 0, u1 = 0) {
  b.n = [0, 1, 0];
  col.setHex(hex);
  const [ax, az, bx, bz, cx, cz, dx, dz] = p;
  const i0 = b.vert(ax, y, az, col, 1, u0, 0, code);
  const i1 = b.vert(bx, y, bz, col, 1, u0, 0, code);
  const i2 = b.vert(cx, y, cz, col, 1, u1, 0, code);
  const i3 = b.vert(dx, y, dz, col, 1, u1, 0, code);
  // Upward-facing when (b-a) x (c-a) has a negative y component in x/z.
  const cross = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  if (cross < 0) b.idx.push(i0, i1, i2, i0, i2, i3);
  else b.idx.push(i0, i2, i1, i0, i3, i2);
}

/** Vertical face between two ground points, from y0 to y1, visible from both sides. */
function wall(b: Builder, ax: number, az: number, bx: number, bz: number, y0: number, y1: number, hex: number) {
  const dx = bx - ax, dz = bz - az;
  const l = Math.hypot(dx, dz) || 1;
  b.n = [dz / l, 0, -dx / l];
  col.setHex(hex);
  const i0 = b.vert(ax, y0, az, col, 0.9, 0, 0, FACADE_KERB);
  const i1 = b.vert(bx, y0, bz, col, 0.9, l, 0, FACADE_KERB);
  const i2 = b.vert(bx, y1, bz, col, 1, l, 0, FACADE_KERB);
  const i3 = b.vert(ax, y1, az, col, 1, 0, 0, FACADE_KERB);
  b.idx.push(i0, i1, i2, i0, i2, i3, i0, i2, i1, i0, i3, i2);
}

/** Walk a polyline, calling fn for each piece between distances s0..s1, offset sideways. */
function along(pts: Float32Array, cb: (ax: number, az: number, bx: number, bz: number, nx: number, nz: number, s0: number, s1: number) => void) {
  let s = 0;
  for (let k = 0; k + 3 < pts.length; k += 2) {
    const ax = pts[k], az = pts[k + 1], bx = pts[k + 2], bz = pts[k + 3];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-3) continue;
    // Left of travel in x-east / z-south.
    cb(ax, az, bx, bz, (bz - az) / len, -(bx - ax) / len, s, s + len);
    s += len;
  }
}

/** Point at distance s along a polyline plus the left normal there. */
function pointAt(pts: Float32Array, s: number) {
  let acc = 0;
  for (let k = 0; k + 3 < pts.length; k += 2) {
    const ax = pts[k], az = pts[k + 1], bx = pts[k + 2], bz = pts[k + 3];
    const len = Math.hypot(bx - ax, bz - az);
    if (acc + len >= s || k + 4 >= pts.length) {
      const t = len ? Math.min(1, Math.max(0, (s - acc) / len)) : 0;
      return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, nx: len ? (bz - az) / len : 0, nz: len ? -(bx - ax) / len : 1, dx: len ? (bx - ax) / len : 0, dz: len ? (bz - az) / len : 1 };
    }
    acc += len;
  }
  return { x: pts[0], z: pts[1], nx: 0, nz: 1, dx: 1, dz: 0 };
}

function polylineLength(pts: Float32Array) {
  let s = 0;
  for (let k = 0; k + 3 < pts.length; k += 2) s += Math.hypot(pts[k + 2] - pts[k], pts[k + 3] - pts[k + 1]);
  return s;
}

/** Flat strip along a polyline at lateral offset `off` (+ left), width w; dashed if dash > 0. */
function stripe(bf: BuilderFor, pts: Float32Array, off: number, w: number, y: number, hex: number, code: number, dash = 0, gap = 0, trim = 0) {
  const total = polylineLength(pts);
  const s0 = trim, s1 = total - trim;
  if (s1 - s0 < 0.2) return;
  const piece = (a: number, b: number) => {
    // Split at polyline vertices so stripes follow bends.
    let acc = 0;
    for (let k = 0; k + 3 < pts.length; k += 2) {
      const ax = pts[k], az = pts[k + 1], bx = pts[k + 2], bz = pts[k + 3];
      const len = Math.hypot(bx - ax, bz - az);
      const lo = Math.max(a, acc), hi = Math.min(b, acc + len);
      if (hi > lo && len > 1e-3) {
        const dx = (bx - ax) / len, dz = (bz - az) / len;
        const nx = dz, nz = -dx;
        const x0 = ax + dx * (lo - acc) + nx * off, z0 = az + dz * (lo - acc) + nz * off;
        const x1 = ax + dx * (hi - acc) + nx * off, z1 = az + dz * (hi - acc) + nz * off;
        const hw = w / 2;
        quadUp(bf((x0 + x1) / 2, (z0 + z1) / 2), [x0 + nx * hw, z0 + nz * hw, x0 - nx * hw, z0 - nz * hw, x1 - nx * hw, z1 - nz * hw, x1 + nx * hw, z1 + nz * hw], y, hex, code, lo, hi);
      }
      acc += len;
    }
  };
  if (dash <= 0) piece(s0, s1);
  else for (let s = s0; s < s1; s += dash + gap) piece(s, Math.min(s1, s + dash));
}

/** Transverse line across a lane, `back` metres before its end. */
function across(bf: BuilderFor, l: Lane, back: number, depth: number, hex: number, dash = 0, gap = 0) {
  const p = pointAt(l.pts, Math.max(0, l.length - back));
  const hw = l.width / 2 - 0.1;
  const y = ROAD_Y + PAINT * 1.5;
  const seg = (a: number, b: number) => {
    const x0 = p.x + p.nx * a, z0 = p.z + p.nz * a, x1 = p.x + p.nx * b, z1 = p.z + p.nz * b;
    const fx = p.dx * depth / 2, fz = p.dz * depth / 2;
    quadUp(bf(p.x, p.z), [x0 - fx, z0 - fz, x1 - fx, z1 - fz, x1 + fx, z1 + fz, x0 + fx, z0 + fz], y, hex, FACADE_PLAIN);
  };
  if (dash <= 0) seg(-hw, hw);
  else for (let a = -hw; a < hw; a += dash + gap) seg(a, Math.min(hw, a + dash));
}

export function buildRoadNet(net: RoadNet, bf: BuilderFor, drive: "left" | "right") {
  const kerbSide = drive === "left" ? 1 : -1; // + is left of travel

  // Junction surfaces.
  for (const j of net.junctions) {
    if (j.shape.length < 6) continue;
    const b = bf(j.x, j.z);
    b.n = [0, 1, 0];
    fillPoly(b, j.shape, ROAD_Y, ASPHALT, FACADE_ROAD);
  }

  for (const l of net.lanes) {
    if (l.pts.length < 4) continue;
    if (l.kind === LaneKind.Road) {
      stripe(bf, l.pts, 0, l.width + 0.02, ROAD_Y, ASPHALT, FACADE_ROAD);
    } else if (l.kind === LaneKind.Footpath) {
      // Raised footpath: top plus a kerb face on each long side. Pieces that
      // run across a carriageway (mapped crosswalks) stay flat and unpainted.
      const hw = l.width / 2;
      along(l.pts, (ax, az, bx, bz, nx, nz) => {
        const mx = (ax + bx) / 2, mz = (az + bz) / 2;
        const on = net.locate(mx, mz, null, ALLOW_CAR);
        if (on && Math.abs(on.lat) < on.lane.width / 2) return;
        const b = bf(mx, mz);
        quadUp(b, [ax + nx * hw, az + nz * hw, ax - nx * hw, az - nz * hw, bx - nx * hw, bz - nz * hw, bx + nx * hw, bz + nz * hw], PATH_Y, PATH, FACADE_PATH);
        for (const s of [1, -1]) wall(b, ax + nx * hw * s, az + nz * hw * s, bx + nx * hw * s, bz + nz * hw * s, ROAD_Y, PATH_Y, KERB);
      });
    } else if (l.kind === LaneKind.WalkingArea && l.pts.length >= 6) {
      const n = l.pts.length / 2;
      let cx = 0, cz = 0;
      for (let i = 0; i < n; i++) {
        cx += l.pts[i * 2];
        cz += l.pts[i * 2 + 1];
      }
      const b = bf(cx / n, cz / n);
      fillPoly(b, l.pts, PATH_Y, PATH, FACADE_PATH);
    } else if (l.kind === LaneKind.Crossing) {
      const signal = l.inc.some((k) => net.links[k].tl >= 0);
      if (signal) {
        // Signal-controlled crossing: two lines of studs either side.
        for (const s of [1, -1]) stripe(bf, l.pts, (s * l.width) / 2, 0.12, ROAD_Y + PAINT, WHITE, FACADE_PLAIN, 0.25, 0.25);
      } else if (l.allow & MARKED) {
        // Zebra: bands across the walking direction.
        const len = l.length;
        for (let s = 0.3; s + 0.5 < len; s += 1.0) {
          const a = pointAt(l.pts, s), c = pointAt(l.pts, s + 0.5);
          const hw = l.width / 2 - 0.2;
          quadUp(bf(a.x, a.z), [a.x + a.nx * hw, a.z + a.nz * hw, a.x - a.nx * hw, a.z - a.nz * hw, c.x - c.nx * hw, c.z - c.nz * hw, c.x + c.nx * hw, c.z + c.nz * hw], ROAD_Y + PAINT, WHITE, FACADE_PLAIN);
        }
      }
    }
  }

  // Lane markings per edge.
  for (const e of net.edges) {
    const cars = net.carLanes(e);
    if (!cars.length) continue;
    const ref = cars[0];
    // Order lanes from the kerb outward by their lateral position.
    const lat = (l: Lane) => {
      const p = pointAt(ref.pts, Math.min(ref.length, 1));
      const q = pointAt(l.pts, Math.min(l.length, 1));
      return ((q.x - p.x) * p.nx + (q.z - p.z) * p.nz) * kerbSide;
    };
    const sorted = [...cars].sort((a, b) => lat(b) - lat(a)); // kerb side first
    const speed = ref.speed;
    const trim = 0.5;
    // Between same-direction lanes: short broken lane lines.
    for (let k = 0; k + 1 < sorted.length; k++) {
      stripe(bf, sorted[k].pts, (-kerbSide * sorted[k].width) / 2, 0.1, ROAD_Y + PAINT, WHITE, FACADE_PLAIN, 2, 4, trim);
    }
    // Centre line on two-way roads, drawn once per pair.
    const inner = sorted[sorted.length - 1];
    if (e.flags & EDGE_TWO_WAY && e.flags & EDGE_CANONICAL && inner.length > 4) {
      stripe(bf, inner.pts, (-kerbSide * inner.width) / 2, 0.11, ROAD_Y + PAINT, WHITE, FACADE_PLAIN, 3, 6, 1.5);
    }
    // Yellow edge line on faster roads (60 km/h and up).
    if (speed >= 16.5) {
      stripe(bf, sorted[0].pts, (kerbSide * sorted[0].width) / 2 - kerbSide * 0.25, 0.12, ROAD_Y + PAINT, YELLOW, FACADE_PLAIN, 0, 0, trim);
    }
    // Junction approach: stop or give-way line across every car lane.
    for (const l of cars) {
      if (l.length < 3 || !l.out.length) continue;
      const links = l.out.map((k) => net.links[k]);
      const signal = links.some((k) => k.tl >= 0);
      const minor = links.every((k) => k.state === "m" || k.state === "s");
      if (signal || e.flags & EDGE_STOP) across(bf, l, 0.4, 0.3, WHITE);
      else if (e.flags & EDGE_GIVE_WAY || minor) {
        across(bf, l, 0.35, 0.15, WHITE, 0.6, 0.3);
        across(bf, l, 0.75, 0.15, WHITE, 0.6, 0.3);
      }
    }
  }
}

/** Fill a polygon (x, z pairs) facing up. */
function fillPoly(b: Builder, ring: Float32Array, y: number, hex: number, code: number) {
  const n = ring.length / 2;
  const contour: THREE.Vector2[] = [];
  for (let i = 0; i < n; i++) contour.push(new THREE.Vector2(ring[i * 2], ring[i * 2 + 1]));
  // Drop a closing duplicate.
  if (n > 2 && contour[0].distanceTo(contour[n - 1]) < 1e-3) contour.pop();
  if (contour.length < 3) return;
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  b.n = [0, 1, 0];
  col.setHex(hex);
  const base = b.pos.length / 3;
  for (const p of contour) b.vert(p.x, y, p.y, col, 1, 0, 0, code);
  for (const t of tris) {
    const a = contour[t[0]], c = contour[t[1]], d = contour[t[2]];
    const cross = (c.x - a.x) * (d.y - a.y) - (c.y - a.y) * (d.x - a.x);
    if (cross < 0) b.idx.push(base + t[0], base + t[1], base + t[2]);
    else b.idx.push(base + t[0], base + t[2], base + t[1]);
  }
}
