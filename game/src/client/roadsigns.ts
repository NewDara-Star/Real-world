import * as THREE from "three/webgpu";
import { EDGE_GIVE_WAY, EDGE_STOP, type Lane, type RoadNet } from "./roadnet";

// Street furniture read from the road network: traffic lights that run the
// real signal programs, STOP and YIELD signs where the map has them, and
// Irish speed-limit discs wherever the limit changes.

interface Head {
  tl: number;
  li: number;
  base: number; // first lamp instance
}

/** Kerb-side point near the end (or start) of a lane, plus the lane's heading there. */
function kerbPoint(l: Lane, atEnd: boolean, out: number, kerbSide: number) {
  const n = l.pts.length / 2;
  const i = atEnd ? n - 2 : 0;
  const ax = l.pts[i * 2], az = l.pts[i * 2 + 1], bx = l.pts[i * 2 + 2], bz = l.pts[i * 2 + 3];
  const len = Math.hypot(bx - ax, bz - az) || 1;
  const dx = (bx - ax) / len, dz = (bz - az) / len;
  const px = atEnd ? bx - dx * 0.6 : ax + dx * 2;
  const pz = atEnd ? bz - dz * 0.6 : az + dz * 2;
  // Left of travel is (dz, -dx).
  const off = (l.width / 2 + out) * kerbSide;
  return { x: px + dz * off, z: pz - dx * off, yaw: Math.atan2(dx, dz) };
}

/** Of an edge's car lanes, the one furthest to the kerb side. */
function kerbLane(cars: Lane[], kerbSide: number) {
  const a = kerbPoint(cars[0], true, 0, 0);
  let kerb = cars[0], best = -Infinity;
  for (const l of cars) {
    const b = kerbPoint(l, true, 0, 0);
    const lat = ((b.x - a.x) * Math.cos(a.yaw) - (b.z - a.z) * Math.sin(a.yaw)) * kerbSide;
    if (lat > best) {
      best = lat;
      kerb = l;
    }
  }
  return kerb;
}

function canvasTexture(draw: (g: CanvasRenderingContext2D, s: number) => void) {
  const s = 128;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d")!;
  draw(g, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function speedDisc(kmh: number) {
  return canvasTexture((g, s) => {
    g.fillStyle = "#c8202a";
    g.beginPath();
    g.arc(s / 2, s / 2, s / 2 - 2, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.arc(s / 2, s / 2, s / 2 - 16, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#111";
    g.font = `bold ${kmh >= 100 ? 46 : 58}px Arial, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(String(kmh), s / 2, s / 2 + 2);
    g.font = "bold 14px Arial, sans-serif";
    g.fillText("km/h", s / 2, s / 2 + 36);
  });
}
function stopSign() {
  return canvasTexture((g, s) => {
    g.fillStyle = "#ffffff";
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 8 + (i * Math.PI) / 4;
      g.lineTo(s / 2 + Math.cos(a) * (s / 2 - 1), s / 2 + Math.sin(a) * (s / 2 - 1));
    }
    g.fill();
    g.fillStyle = "#c8202a";
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 8 + (i * Math.PI) / 4;
      g.lineTo(s / 2 + Math.cos(a) * (s / 2 - 6), s / 2 + Math.sin(a) * (s / 2 - 6));
    }
    g.fill();
    g.fillStyle = "#fff";
    g.font = "bold 34px Arial, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("STOP", s / 2, s / 2 - 10);
    g.font = "bold 22px Arial, sans-serif";
    g.fillText("STAD", s / 2, s / 2 + 20);
  });
}
function yieldSign() {
  return canvasTexture((g, s) => {
    const tri = (inset: number) => {
      g.beginPath();
      g.moveTo(inset * 1.2, inset * 0.9 + 8);
      g.lineTo(s - inset * 1.2, inset * 0.9 + 8);
      g.lineTo(s / 2, s - inset * 1.6 - 4);
      g.closePath();
    };
    g.fillStyle = "#c8202a";
    tri(2);
    g.fill();
    g.fillStyle = "#ffffff";
    tri(16);
    g.fill();
    g.fillStyle = "#111";
    g.textAlign = "center";
    g.font = "bold 16px Arial, sans-serif";
    g.fillText("GÉILL SLÍ", s / 2, 44);
    g.font = "bold 19px Arial, sans-serif";
    g.fillText("YIELD", s / 2, 64);
  });
}

export class RoadSigns {
  group = new THREE.Group();
  private heads: Head[] = [];
  private lamps!: THREE.InstancedMesh;
  private colors: Float32Array = new Float32Array(0);

  constructor(private net: RoadNet, drive: "left" | "right") {
    const kerbSide = drive === "left" ? 1 : -1;
    const poleMat = new THREE.MeshStandardNodeMaterial({ color: 0x5a5d60, roughness: 0.6, metalness: 0.4 });
    const housingMat = new THREE.MeshStandardNodeMaterial({ color: 0x151515, roughness: 0.7 });
    const poles: THREE.Matrix4[] = [];
    const housings: THREE.Matrix4[] = [];
    const lampMats: THREE.Matrix4[] = [];
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);

    // ---- traffic lights: one pole per signalled approach, kerb side ----
    for (const e of net.edges) {
      const cars = net.carLanes(e).filter((l) => l.out.some((k) => net.links[k].tl >= 0));
      if (!cars.length) continue;
      const kerb = kerbLane(cars, kerbSide);
      const link = kerb.out.map((k) => net.links[k]).find((k) => k.tl >= 0 && k.dir === "s") ?? kerb.out.map((k) => net.links[k]).find((k) => k.tl >= 0)!;
      const p = kerbPoint(kerb, true, 1.1, kerbSide);
      q.setFromAxisAngle(up, p.yaw);
      poles.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x, 0, p.z), q, one));
      // Head faces back toward approaching traffic.
      const back = new THREE.Quaternion().setFromAxisAngle(up, p.yaw + Math.PI);
      housings.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x, 2.9, p.z), back, one));
      const base = lampMats.length;
      for (let i = 0; i < 3; i++) {
        // Red on top, amber, green; lenses on the face toward traffic.
        const pos = new THREE.Vector3(p.x - Math.sin(p.yaw) * 0.14, 3.32 - i * 0.36, p.z - Math.cos(p.yaw) * 0.14);
        lampMats.push(new THREE.Matrix4().compose(pos, back, one));
      }
      this.heads.push({ tl: link.tl, li: link.li, base });
    }
    const poleGeo = new THREE.CylinderGeometry(0.06, 0.07, 3.6, 8).translate(0, 1.8, 0);
    const housingGeo = new THREE.BoxGeometry(0.34, 1.12, 0.24).translate(0, 0.42, 0);
    const lampGeo = new THREE.CircleGeometry(0.11, 14);
    this.add(poleGeo, poleMat, poles);
    this.add(housingGeo, housingMat, housings);
    const lampMat = new THREE.MeshBasicNodeMaterial({ color: 0xffffff });
    this.lamps = this.add(lampGeo, lampMat, lampMats);
    this.colors = new Float32Array(lampMats.length * 3);
    this.lamps.instanceColor = new THREE.InstancedBufferAttribute(this.colors, 3);

    // ---- signs ----
    const signPoles: THREE.Matrix4[] = [];
    const byTex = new Map<string, { tex: THREE.Texture; mats: THREE.Matrix4[]; size: number }>();
    const sign = (key: string, make: () => THREE.Texture, size: number, x: number, z: number, yaw: number) => {
      let g = byTex.get(key);
      if (!g) byTex.set(key, (g = { tex: make(), mats: [], size }));
      const face = new THREE.Quaternion().setFromAxisAngle(up, yaw + Math.PI);
      g.mats.push(new THREE.Matrix4().compose(new THREE.Vector3(x - Math.sin(yaw) * 0.05, 2.1, z - Math.cos(yaw) * 0.05), face, one));
      signPoles.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), face, one));
    };
    for (const e of net.edges) {
      const cars = net.carLanes(e);
      if (!cars.length) continue;
      const kerb = kerbLane(cars, kerbSide);
      if (e.flags & EDGE_STOP) {
        const p = kerbPoint(kerb, true, 0.9, kerbSide);
        sign("stop", stopSign, 0.75, p.x, p.z, p.yaw);
      } else if (e.flags & EDGE_GIVE_WAY) {
        const p = kerbPoint(kerb, true, 0.9, kerbSide);
        sign("yield", yieldSign, 0.9, p.x, p.z, p.yaw);
      }
      // Speed limit changes: sign at the start of an edge whose limit
      // differs from the road it continues straight on from.
      const kmh = Math.round((kerb.speed * 3.6) / 10) * 10;
      if (kerb.length > 30 && kmh >= 30) {
        const prev = kerb.inc.map((k) => net.links[k]).find((k) => k.dir === "s");
        const prevKmh = prev ? Math.round((net.lanes[prev.from].speed * 3.6) / 10) * 10 : kmh;
        if (prev && prevKmh !== kmh) {
          const p = kerbPoint(kerb, false, 0.9, kerbSide);
          sign(`speed${kmh}`, () => speedDisc(kmh), 0.75, p.x, p.z, p.yaw);
        }
      }
    }
    const signPoleGeo = new THREE.CylinderGeometry(0.035, 0.035, 2.5, 6).translate(0, 1.25, 0);
    this.add(signPoleGeo, poleMat, signPoles);
    for (const g of byTex.values()) {
      const mat = new THREE.MeshStandardNodeMaterial({ map: g.tex, transparent: true, alphaTest: 0.5, roughness: 0.5, side: THREE.DoubleSide });
      this.add(new THREE.PlaneGeometry(g.size, g.size), mat, g.mats);
    }
  }

  private add(geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[]) {
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, mats.length));
    mats.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.count = mats.length;
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return mesh;
  }

  /** Light the lamps for the signal programs at time t. Colours above 1 bloom. */
  update(t: number) {
    const c = this.colors;
    for (const h of this.heads) {
      const st = this.net.signalState(h.tl, h.li, t);
      const red = st === "r" || st === "u";
      const amber = st === "y" || st === "Y" || st === "u";
      const green = st === "G" || st === "g";
      const set = (i: number, on: boolean, r: number, g: number, b: number) => {
        const k = (h.base + i) * 3;
        const s = on ? 4 : 0.08;
        c[k] = r * s;
        c[k + 1] = g * s;
        c[k + 2] = b * s;
      };
      set(0, red, 1, 0.08, 0.05);
      set(1, amber, 1, 0.55, 0.05);
      set(2, green, 0.1, 1, 0.45);
    }
    if (this.lamps.instanceColor) this.lamps.instanceColor.needsUpdate = true;
  }
}
