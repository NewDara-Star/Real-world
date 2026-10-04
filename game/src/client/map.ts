import { ALLOW_SERVICE, LaneKind, type RoadNet } from "./roadnet";
import type { Navigator } from "./nav";
import type { World } from "./world";

// The map, drawn from the same data the world is built from: buildings,
// parks, water, every lane and junction, so it always matches the streets
// you're driving. A rotating GTA-style minimap in the corner, plus a full
// map (M) with search to set a sat-nav destination.

const S = 1; // base map pixels per metre

export interface Destination {
  x: number;
  z: number;
  name: string;
}

export class MapView {
  private base: HTMLCanvasElement;
  private hx: number;
  private hz: number;
  private mini: HTMLCanvasElement;
  private big: HTMLCanvasElement;
  private view = { x: 0, z: 0, scale: 0.25 };
  private searchIndex: { name: string; kind: string; x: number; z: number }[] = [];
  open = false;
  onDestination: (d: Destination | null) => void = () => {};

  constructor(private world: World, private net: RoadNet | null, private nav: Navigator | null) {
    this.hx = world.meta.half.x;
    this.hz = world.meta.half.z;
    this.base = this.drawBase();
    this.mini = document.getElementById("minimap") as HTMLCanvasElement;
    this.big = document.getElementById("bigmap-canvas") as HTMLCanvasElement;
    this.buildSearch();
    this.wireBigMap();
  }

  // ---------------------------------------------------------- base map --

  private drawBase(): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = Math.ceil(this.hx * 2 * S);
    c.height = Math.ceil(this.hz * 2 * S);
    const g = c.getContext("2d")!;
    const X = (x: number) => (x + this.hx) * S, Z = (z: number) => (z + this.hz) * S;
    g.fillStyle = "#1d2428";
    g.fillRect(0, 0, c.width, c.height);
    const poly = (pts: Float32Array, fill: string) => {
      if (pts.length < 6) return;
      g.beginPath();
      g.moveTo(X(pts[0]), Z(pts[1]));
      for (let i = 2; i < pts.length; i += 2) g.lineTo(X(pts[i]), Z(pts[i + 1]));
      g.closePath();
      g.fillStyle = fill;
      g.fill();
    };
    for (const a of this.world.areas) poly(a.pts, a.kind === 1 ? "#24465e" : a.kind === 2 || a.kind === 3 ? "#26402b" : "#272e33");
    for (const b of this.world.footprintList) poly(b, "#3a444c");
    const line = (pts: Float32Array, w: number, col: string) => {
      if (pts.length < 4) return;
      g.beginPath();
      g.moveTo(X(pts[0]), Z(pts[1]));
      for (let i = 2; i < pts.length; i += 2) g.lineTo(X(pts[i]), Z(pts[i + 1]));
      g.strokeStyle = col;
      g.lineWidth = Math.max(1, w * S);
      g.lineCap = "round";
      g.lineJoin = "round";
      g.stroke();
    };
    const net = this.net;
    if (net) {
      for (const l of net.lanes) if (l.kind === LaneKind.Footpath) line(l.pts, Math.min(2, l.width), "#46525a");
      for (const j of net.junctions) poly(j.shape, "#cfd5da");
      for (const l of net.lanes) {
        if (l.kind !== LaneKind.Road && l.kind !== LaneKind.Internal) continue;
        if (!(l.allow & 1)) continue;
        const col = l.allow & ALLOW_SERVICE ? "#7d868d" : l.speed >= 16.5 ? "#f2cf72" : "#cfd5da";
        line(l.pts, l.width + 0.4, col);
      }
    } else {
      for (const r of this.world.roads) if (r.cls <= 9) line(r.pts, r.w, r.cls <= 4 ? "#f2cf72" : "#cfd5da");
    }
    return c;
  }

  // ----------------------------------------------------------- minimap --

  drawMinimap(px: number, pz: number, yaw: number, speed: number) {
    const c = this.mini;
    const g = c.getContext("2d")!;
    const w = c.width, h = c.height, r = w / 2;
    g.clearRect(0, 0, w, h);
    g.save();
    g.beginPath();
    g.arc(r, r, r - 2, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = "#1d2428";
    g.fillRect(0, 0, w, h);
    // Forward points up: rotate so the heading (sin yaw, cos yaw) maps to (0, -1).
    const theta = -Math.PI / 2 - Math.atan2(Math.cos(yaw), Math.sin(yaw));
    const zoom = 2.2 - Math.min(1.2, speed / 25); // zoom out as you speed up
    g.translate(r, r * 1.25);
    g.rotate(theta);
    g.scale(zoom, zoom);
    // Only the patch around the player (the whole base is several megapixels).
    const span = (r * 2) / zoom;
    const sx = Math.max(0, (px + this.hx) * S - span), sy = Math.max(0, (pz + this.hz) * S - span);
    const sw = Math.min(this.base.width - sx, span * 2), sh = Math.min(this.base.height - sy, span * 2);
    if (sw > 0 && sh > 0) g.drawImage(this.base, sx, sy, sw, sh, sx - (px + this.hx) * S, sy - (pz + this.hz) * S, sw, sh);
    this.drawRoute(g, px, pz, 5 / zoom);
    g.restore();
    // You: an arrow pointing up.
    g.save();
    g.translate(r, r * 1.25);
    g.fillStyle = "#ffffff";
    g.strokeStyle = "#0b0f12";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, -11);
    g.lineTo(8, 9);
    g.lineTo(0, 4);
    g.lineTo(-8, 9);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
    // North marker on the rim.
    const nx = Math.cos(theta - Math.PI / 2), nz = Math.sin(theta - Math.PI / 2);
    g.fillStyle = "#e9edf0";
    g.font = "bold 13px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("N", r + nx * (r - 13), r + nz * (r - 13));
    g.beginPath();
    g.arc(r, r, r - 2, 0, Math.PI * 2);
    g.strokeStyle = "rgba(255,255,255,0.35)";
    g.lineWidth = 3;
    g.stroke();
  }

  /** Route line and destination pin in the current transform (base pixels around the player). */
  private drawRoute(g: CanvasRenderingContext2D, px: number, pz: number, width: number) {
    const nav = this.nav;
    if (!nav?.dest) return;
    const p = nav.path;
    if (p.length >= 4) {
      g.beginPath();
      let started = false;
      for (let k = 0; k < p.length; k += 2) {
        if (nav.pathCum[k / 2] < nav.progress - 5) continue;
        const x = (p[k] - px) * S, z = (p[k + 1] - pz) * S;
        if (!started) {
          g.moveTo(x, z);
          started = true;
        } else g.lineTo(x, z);
      }
      g.strokeStyle = "#35c4ff";
      g.lineWidth = width;
      g.lineCap = "round";
      g.lineJoin = "round";
      g.stroke();
    }
    const dx = (nav.dest.x - px) * S, dz = (nav.dest.z - pz) * S;
    g.beginPath();
    g.arc(dx, dz, width * 1.6, 0, Math.PI * 2);
    g.fillStyle = "#ffcf3a";
    g.fill();
  }

  // ----------------------------------------------------------- big map --

  toggle(on = !this.open, px = 0, pz = 0, yaw = 0) {
    this.open = on;
    const el = document.getElementById("bigmap")!;
    el.hidden = !on;
    if (on) {
      this.view.x = px;
      this.view.z = pz;
      this.view.scale = Math.min(innerWidth / (this.hx * 2), innerHeight / (this.hz * 2)) * 2.2;
      this.player = { x: px, z: pz, yaw };
      this.drawBig();
      (document.getElementById("map-search") as HTMLInputElement).focus();
    }
  }
  private player = { x: 0, z: 0, yaw: 0 };

  private drawBig() {
    const c = this.big;
    c.width = innerWidth * devicePixelRatio;
    c.height = innerHeight * devicePixelRatio;
    const g = c.getContext("2d")!;
    g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    g.fillStyle = "#151b1e";
    g.fillRect(0, 0, innerWidth, innerHeight);
    const v = this.view;
    g.save();
    g.translate(innerWidth / 2, innerHeight / 2);
    g.scale(v.scale, v.scale);
    g.imageSmoothingQuality = "high";
    const hw = innerWidth / 2 / v.scale, hh = innerHeight / 2 / v.scale;
    const sx = Math.max(0, (v.x + this.hx) * S - hw), sy = Math.max(0, (v.z + this.hz) * S - hh);
    const sw = Math.min(this.base.width - sx, hw * 2), sh = Math.min(this.base.height - sy, hh * 2);
    if (sw > 0 && sh > 0) g.drawImage(this.base, sx, sy, sw, sh, sx - (v.x + this.hx) * S, sy - (v.z + this.hz) * S, sw, sh);
    this.drawRoute(g, v.x, v.z, 6 / v.scale);
    // Named places.
    g.font = `${12 / v.scale}px system-ui, sans-serif`;
    g.textAlign = "left";
    g.textBaseline = "middle";
    if (v.scale > 0.6) {
      for (const p of this.world.meta.places) {
        g.fillStyle = "#ffcf3a";
        g.beginPath();
        g.arc((p.x - v.x) * S, (p.z - v.z) * S, 3 / v.scale, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "#e9edf0";
        g.fillText(p.name, (p.x - v.x) * S + 6 / v.scale, (p.z - v.z) * S);
      }
    }
    // You.
    g.translate((this.player.x - v.x) * S, (this.player.z - v.z) * S);
    g.rotate(Math.atan2(Math.cos(this.player.yaw), Math.sin(this.player.yaw)) + Math.PI / 2);
    g.scale(1 / v.scale, 1 / v.scale);
    g.fillStyle = "#fff";
    g.strokeStyle = "#000";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, -14);
    g.lineTo(10, 11);
    g.lineTo(0, 5);
    g.lineTo(-10, 11);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }

  private wireBigMap() {
    const c = this.big;
    let drag: { x: number; y: number; vx: number; vz: number; moved: boolean } | null = null;
    c.addEventListener("pointerdown", (e) => {
      drag = { x: e.clientX, y: e.clientY, vx: this.view.x, vz: this.view.z, moved: false };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      this.view.x = drag.vx - dx / this.view.scale / S;
      this.view.z = drag.vz - dy / this.view.scale / S;
      this.drawBig();
    });
    c.addEventListener("pointerup", (e) => {
      if (drag && !drag.moved) {
        // Click: drop a destination pin there.
        const x = this.view.x + (e.clientX - innerWidth / 2) / this.view.scale / S;
        const z = this.view.z + (e.clientY - innerHeight / 2) / this.view.scale / S;
        this.onDestination({ x, z, name: this.nameNear(x, z) });
        this.drawBig();
      }
      drag = null;
    });
    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      const k = Math.exp(-e.deltaY * 0.0015);
      this.view.scale = Math.max(0.08, Math.min(6, this.view.scale * k));
      this.drawBig();
    }, { passive: false });
    const input = document.getElementById("map-search") as HTMLInputElement;
    const list = document.getElementById("map-results")!;
    input.addEventListener("input", () => {
      const q = input.value.trim().toLowerCase();
      list.innerHTML = "";
      if (q.length < 2) return;
      const hits = this.searchIndex.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 8);
      for (const h of hits) {
        const li = document.createElement("li");
        const b = document.createElement("button");
        b.innerHTML = `<b></b><span></span>`;
        b.querySelector("b")!.textContent = h.name;
        b.querySelector("span")!.textContent = h.kind;
        b.addEventListener("click", () => {
          this.onDestination({ x: h.x, z: h.z, name: h.name });
          this.view.x = h.x;
          this.view.z = h.z;
          this.drawBig();
        });
        li.appendChild(b);
        list.appendChild(li);
      }
    });
    input.addEventListener("keydown", (e) => {
      e.stopPropagation(); // typing "m" or "p" shouldn't close the map or pause
      if (e.key === "Enter") (list.querySelector("button") as HTMLButtonElement | null)?.click();
      if (e.key === "Escape") this.toggle(false);
    });
    document.getElementById("map-clear")!.addEventListener("click", () => {
      this.onDestination(null);
      this.drawBig();
    });
    document.getElementById("map-close")!.addEventListener("click", () => this.toggle(false));
    addEventListener("resize", () => this.open && this.drawBig());
  }

  /** Places and street names you can search for. */
  private buildSearch() {
    for (const p of this.world.meta.places) this.searchIndex.push({ name: p.name, kind: (p as { cat?: string }).cat?.replace(/_/g, " ") ?? "place", x: p.x, z: p.z });
    const net = this.net;
    if (!net) return;
    // Each street once, at the middle of its longest stretch.
    const best = new Map<number, { len: number; x: number; z: number }>();
    for (const e of net.edges) {
      if (e.name === 0xffff) continue;
      const lanes = net.carLanes(e);
      if (!lanes.length) continue;
      const l = lanes[0];
      const cur = best.get(e.name);
      if (cur && cur.len >= l.length) continue;
      const mid = Math.floor(l.pts.length / 4) * 2;
      best.set(e.name, { len: l.length, x: l.pts[mid], z: l.pts[mid + 1] });
    }
    for (const [n, v] of best) this.searchIndex.push({ name: net.names[n], kind: "street", x: v.x, z: v.z });
  }

  /** A name for a dropped pin: the nearest named place or street. */
  private nameNear(x: number, z: number): string {
    let best = "Dropped pin", bd = 60 * 60;
    for (const s of this.searchIndex) {
      const d = (s.x - x) ** 2 + (s.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = s.name;
      }
    }
    return best;
  }
}
