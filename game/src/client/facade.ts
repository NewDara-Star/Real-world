import * as THREE from "three/webgpu";
import { Fn, If, abs, attribute, dot, float, floor, fract, fwidth, max, min, mix, mod, positionWorld, select, sin, smoothstep, step, uniform, vec2, vec3, vec4 } from "three/tsl";

// One shared PBR material for the whole city. Each vertex carries a `facade`
// attribute (u, v, code, ao) and TSL paints detail procedurally, so there are
// no textures to download or keep in GPU memory. Works on WebGPU and falls
// back to WebGL2 automatically.
//
//   code >= 0   building wall. fract(code) = per-building seed; code >= 2 marks
//               a ground-floor shopfront. u = metres along the wall, v = height.
//   -1          plain vertex colour (props, green areas)
//   -2          kerb: black/yellow stripes along u
//   -3          road with centre line (v = lateral position -1..1)
//   -4          road without centre line
//   -5          bare ground (laterite / dust patches)
//   -6          zinc roof (corrugated, metallic)
//   -7          flat concrete roof
// ao (w) darkens the colour (baked occlusion, e.g. under eaves).

export const FACADE_PLAIN = -1;
export const FACADE_KERB = -2;
export const FACADE_ROAD_LINED = -3;
export const FACADE_ROAD = -4;
export const FACADE_GROUND = -5;
export const FACADE_ZINC = -6;
export const FACADE_FLAT_ROOF = -7;
export const FACADE_LAMP = -8;

/** 0 = full day, 1 = full night. Set by Graphics.setTime. */
export const nightUniform = uniform(0);
/** Seconds since load; drives NEPA outages shifting around the city. */
export const clockUniform = uniform(0);

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

const fhash = Fn(([n]: [N]) => fract(sin(n.mul(127.1)).mul(43758.5453)));
const fhash2 = Fn(([p]: [N]) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)));
const vnoise = Fn(([p]: [N]) => {
  const i: N = floor(p);
  const f: N = fract(p);
  const u: N = f.mul(f).mul(float(3).sub(f.mul(2)));
  const a = fhash2(i), b = fhash2(i.add(vec2(1, 0))), c = fhash2(i.add(vec2(0, 1))), d = fhash2(i.add(vec2(1, 1)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
});

const signColor = Fn(([k]: [N]) => {
  const i = floor(fhash(k).mul(8));
  const c = vec3(0.05, 0.6, 0.65).toVar(); // teal
  If(i.lessThan(1), () => c.assign(vec3(0.98, 0.8, 0.1))) // yellow
    .ElseIf(i.lessThan(2), () => c.assign(vec3(0.09, 0.55, 0.27))) // green
    .ElseIf(i.lessThan(3), () => c.assign(vec3(0.8, 0.13, 0.12))) // red
    .ElseIf(i.lessThan(4), () => c.assign(vec3(0.1, 0.32, 0.7))) // blue
    .ElseIf(i.lessThan(5), () => c.assign(vec3(0.95, 0.94, 0.9))) // white
    .ElseIf(i.lessThan(6), () => c.assign(vec3(0.96, 0.5, 0.1))) // orange
    .ElseIf(i.lessThan(7), () => c.assign(vec3(0.46, 0.2, 0.6))); // purple
  return c;
});

/** Returns vec4(albedo, roughness). */
const surface = Fn(() => {
  const fac = attribute("facade", "vec4");
  const base = attribute("color", "vec3");
  const code = fac.z;
  const c = base.toVar();
  const rough = float(0.9).toVar();
  const xz = positionWorld.xz;

  If(code.greaterThanEqual(0), () => {
    const u = fac.x;
    const h = fac.y;
    // Interpolation leaves ~1e-7 noise on a "constant" varying; the hash would
    // amplify it into per-pixel speckle, so snap the seed to its 1/1000 grid.
    const seed = floor(fract(code).mul(1000).add(0.5)).div(1000);
    const shop = step(1.5, code);
    const fh = float(3.2);
    const fl = floor(h.div(fh));
    const fy = fract(h.div(fh));
    const bay = seed.mul(1.4).add(2.4);
    const bi = floor(u.div(bay));
    const bx = fract(u.div(bay));
    // Fade fine detail before it aliases into noise at distance.
    const fine = float(1).sub(smoothstep(0.05, 0.18, fwidth(u).add(fwidth(h))));
    // Plaster: soft blotches and streaks so walls aren't flat paint.
    const plaster = vnoise(vec2(u.mul(0.7), h.mul(0.9))).mul(0.6).add(vnoise(vec2(u.mul(3.1), h.mul(3.7))).mul(0.4));
    c.assign(c.mul(plaster.mul(0.16).add(0.9)));
    const streak = smoothstep(0.55, 0.9, vnoise(vec2(u.mul(1.3), h.mul(0.12)))).mul(0.12);
    c.assign(c.mul(float(1).sub(streak)));

    If(shop.greaterThan(0.5).and(fl.lessThan(0.5)), () => {
      If(fy.lessThan(0.78), () => {
        // Roller shutters, some rolled up to show a dark shop interior.
        const open = step(0.45, fhash(bi.add(seed.mul(37))));
        const slat = mix(vec3(0.51, 0.53, 0.54), mix(vec3(0.58, 0.6, 0.61), vec3(0.44, 0.46, 0.47), step(0.5, fract(h.mul(6)))), fine);
        const inside = mix(vec3(0.16, 0.14, 0.12), signColor(bi.mul(3.1).add(seed)).mul(0.45), step(0.6, fract(h.mul(1.3))).mul(0.4));
        const doorway = step(0.06, bx).mul(step(bx, 0.94));
        c.assign(mix(c, mix(slat, inside, open), doorway));
        rough.assign(mix(rough, mix(float(0.45), float(0.9), open), doorway));
      }).Else(() => {
        // Painted signboard with a hint of lettering.
        const span = bay.mul(2);
        const sp = fract(u.div(span));
        const sc = signColor(floor(u.div(span)).add(seed.mul(91)));
        const txt = step(0.45, fract(u.mul(1.9).add(seed.mul(5)))).mul(step(0.84, fy)).mul(step(fy, 0.93)).mul(step(0.12, sp)).mul(step(sp, 0.88));
        const ink = select(dot(sc, vec3(0.33)).greaterThan(0.75), vec3(0.07), vec3(0.95));
        c.assign(mix(sc, ink, txt.mul(0.8).mul(fine)));
        rough.assign(0.55);
      });
    }).Else(() => {
      // Branch-free so every wall pixel runs the same code: masks for door,
      // window and plaster detail, blended in order.
      const win = step(0.27, bx).mul(step(bx, 0.73)).mul(step(0.32, fy)).mul(step(fy, 0.8));
      const doorBay = step(fl, 0.5).mul(step(abs(mod(bi, 4).sub(1)), 0.5));
      const door = doorBay.mul(step(0.3, bx)).mul(step(bx, 0.7)).mul(step(fy, 0.72));
      const winOnly = win.mul(float(1).sub(door));
      // Glass or louvres behind burglary-proof bars.
      const louvre = mix(float(0.5), step(0.5, fract(fy.mul(14))), fine).mul(step(0.5, fhash(bi.add(fl.mul(7)).add(seed))));
      const glass = mix(vec3(0.1, 0.13, 0.16), vec3(0.3, 0.33, 0.34), louvre);
      const bars = max(step(0.86, fract(bx.mul(8))), step(0.88, fract(fy.mul(6))));
      const barMix = mix(float(0.14), bars, fine);
      const windowCol = mix(glass, vec3(0.36, 0.33, 0.3), barMix);
      const windowRough = mix(mix(float(0.08), float(0.5), louvre), float(0.6), barMix);
      // Lintel shadow above windows and a faint stain below them.
      const lintel = step(0.8, fy).mul(step(fy, 0.85)).mul(step(0.24, bx)).mul(step(bx, 0.76));
      const stain = step(0.27, bx).mul(step(bx, 0.73)).mul(smoothstep(0.32, 0.12, fy)).mul(step(0.5, fhash(bi.mul(1.7).add(fl))));
      const plain = float(1).sub(winOnly).sub(door);
      c.assign(c.mul(float(1).sub(lintel.mul(0.22).mul(plain)).sub(stain.mul(0.12).mul(plain))));
      c.assign(mix(c, windowCol, winOnly));
      c.assign(mix(c, vec3(0.32, 0.21, 0.13), door));
      rough.assign(mix(mix(rough, windowRough, winOnly), float(0.7), door));
    });
    // Grime and rain splash near the ground.
    c.assign(c.mul(mix(float(0.62), float(1), smoothstep(0, 0.9, h))));
  })
    .ElseIf(code.lessThan(-1.5).and(code.greaterThan(-2.5)), () => {
      const kf = float(1).sub(smoothstep(0.15, 0.5, fwidth(fac.x)));
      c.assign(mix(vec3(0.53, 0.45, 0.1), mix(vec3(0.96, 0.8, 0.1), vec3(0.09), step(0.5, fract(fac.x.div(1.2)))), kf));
      rough.assign(0.75);
    })
    .ElseIf(code.lessThan(-2.5).and(code.greaterThan(-4.5)), () => {
      // Asphalt: grain, patched repairs, worn wheel tracks and the odd pothole.
      const grain = vnoise(xz.mul(2.3)).mul(0.5).add(vnoise(xz.mul(9)).mul(0.5));
      c.assign(c.mul(grain.mul(0.18).add(0.88)));
      const patchy = smoothstep(0.62, 0.7, vnoise(xz.mul(0.12)));
      c.assign(c.mul(float(1).sub(patchy.mul(0.14))));
      const tracks = smoothstep(0.25, 0.0, abs(abs(fac.y).sub(0.5))).mul(0.07);
      c.assign(c.mul(float(1).sub(tracks)));
      const hole = smoothstep(0.86, 0.9, vnoise(xz.mul(0.55).add(17))).mul(step(0.55, vnoise(xz.mul(0.05).add(3))));
      c.assign(mix(c, vec3(0.3, 0.24, 0.18), hole.mul(0.8)));
      rough.assign(mix(float(0.88), float(0.98), hole));
      If(code.greaterThan(-3.5), () => {
        const line = step(abs(fac.y), 0.03).mul(step(0.5, fract(fac.x.div(6))));
        c.assign(mix(c, vec3(0.92, 0.9, 0.84), line.mul(0.9)));
      });
    })
    .ElseIf(code.lessThan(-4.5).and(code.greaterThan(-5.5)), () => {
      const n = vnoise(xz.mul(0.03)).mul(0.6).add(vnoise(xz.mul(0.17)).mul(0.4));
      c.assign(mix(c, vec3(0.72, 0.47, 0.33), smoothstep(0.45, 0.75, n).mul(0.55)));
      c.assign(c.mul(vnoise(xz.mul(0.7)).mul(0.1).add(0.91)));
      rough.assign(1);
    })
    .ElseIf(code.lessThan(-5.5).and(code.greaterThan(-6.5)), () => {
      // Corrugated zinc: ridges every ~7.6 cm, rust blooms, sun-faded sheets.
      const r = xz.x.add(xz.y).mul(82);
      const ridgeFade = float(1).sub(smoothstep(0.6, 2.5, fwidth(r)));
      const ridge = sin(r).mul(0.5).add(0.5).mul(ridgeFade).add(float(0.5).mul(float(1).sub(ridgeFade)));
      // Small rust spots and streaks, not big blotches.
      const rust = smoothstep(0.62, 0.86, vnoise(xz.mul(1.4)).mul(0.7).add(vnoise(xz.mul(5)).mul(0.3)));
      c.assign(mix(c, vec3(0.42, 0.26, 0.16), rust.mul(0.38)));
      c.assign(c.mul(ridge.mul(0.12).add(0.9)));
      rough.assign(mix(float(0.45), float(0.85), rust));
    })
    .ElseIf(code.lessThan(-6.5), () => {
      c.assign(c.mul(vnoise(xz.mul(0.8)).mul(0.14).add(0.86)));
      rough.assign(0.95);
    });

  return vec4(c.mul(fac.w), min(rough, 1));
});

/**
 * Night glow: lit windows and open shops, NEPA-aware, plus streetlight heads.
 * Each ~140 m patch of the city has mains power or not, re-rolled every four
 * minutes; without power only a few windows glow (generators and lanterns).
 */
const nightGlow = Fn(() => {
  const fac = attribute("facade", "vec4");
  const code = fac.z;
  const glow = vec3(0).toVar();
  If(code.greaterThanEqual(0), () => {
    const u = fac.x;
    const h = fac.y;
    const seed = floor(fract(code).mul(1000).add(0.5)).div(1000);
    const shop = step(1.5, code);
    const fl = floor(h.div(3.2));
    const fy = fract(h.div(3.2));
    const bay = seed.mul(1.4).add(2.4);
    const bi = floor(u.div(bay));
    const bx = fract(u.div(bay));
    const cell = floor(positionWorld.xz.div(140));
    const power = step(0.32, fhash(cell.x.mul(17.1).add(cell.y.mul(31.7)).add(floor(clockUniform.div(240)).mul(7.3))));
    const r = fhash(bi.mul(1.3).add(fl.mul(13)).add(seed.mul(71)));
    const lit = mix(step(r, 0.12), step(r, 0.62), power);
    const warm = mix(vec3(1.0, 0.78, 0.5), vec3(0.85, 0.95, 1.0), step(0.6, fhash(r.mul(9.1))));
    const win = step(0.27, bx).mul(step(bx, 0.73)).mul(step(0.32, fy)).mul(step(fy, 0.8)).mul(float(1).sub(shop.mul(step(fl, 0.5))));
    // Open shops spill light from inside the shutters.
    const shopInside = shop.mul(step(fl, 0.5)).mul(step(fy, 0.78)).mul(step(0.06, bx)).mul(step(bx, 0.94)).mul(step(0.45, fhash(bi.add(seed.mul(37)))));
    glow.assign(warm.mul(win.mul(lit).mul(mix(float(0.45), float(0.95), power))).add(vec3(1.0, 0.8, 0.5).mul(shopInside.mul(mix(float(0.2), float(0.8), power)))));
  }).ElseIf(code.lessThan(-7.5).and(code.greaterThan(-8.5)), () => {
    glow.assign(vec3(1.0, 0.72, 0.38).mul(5));
  });
  return glow.mul(nightUniform);
});

export function createWorldMaterial(): THREE.MeshStandardNodeMaterial {
  const mat = new THREE.MeshStandardNodeMaterial();
  const s = surface();
  mat.colorNode = s.xyz;
  mat.roughnessNode = s.w;
  mat.emissiveNode = nightGlow();
  const code = attribute("facade", "vec4").z;
  mat.metalnessNode = select(code.lessThan(-5.5).and(code.greaterThan(-6.5)), float(0.55), float(0));
  return mat;
}

/** Plain vertex-coloured PBR material for props, vehicles and people. */
export function createVertexColorMaterial(roughness = 0.75, metalness = 0): THREE.MeshStandardNodeMaterial {
  const mat = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness, metalness });
  return mat;
}
