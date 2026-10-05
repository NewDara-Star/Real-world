import * as THREE from "three/webgpu";
import { Fn, If, abs, attribute, cameraViewMatrix, dFdx, dFdy, dot, float, floor, fract, fwidth, max, min, mix, mod, normalize, normalWorld, normalWorldGeometry, positionWorld, select, sin, smoothstep, step, texture, uniform, vec2, vec3, vec4 } from "three/tsl";

// One shared PBR material for the whole city. Each vertex carries a `facade`
// attribute (u, v, code, ao). With real textures loaded (CC0 photo scans,
// see public/tex/CREDITS.md) surfaces get photographic colour detail,
// roughness and normal maps sampled in metres; without them TSL paints the
// detail procedurally. Works on WebGPU and falls back to WebGL2.
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
//   -8          street lamp head (glows at night)
//   -9          concrete roof tiles
//   -10         footpath (concrete paving slabs)
//   -11/-12/-13 modelled prop surface: brick / render / concrete, box-mapped
//               in metres (garden walls and piers: the glTF's extras.surface)
//   -14         hedge foliage
// ao (w) darkens the colour (baked occlusion, e.g. under eaves).

export const FACADE_PLAIN = -1;
export const FACADE_KERB = -2;
export const FACADE_ROAD_LINED = -3;
export const FACADE_ROAD = -4;
export const FACADE_GROUND = -5;
export const FACADE_ZINC = -6;
export const FACADE_FLAT_ROOF = -7;
export const FACADE_LAMP = -8;
export const FACADE_TILE = -9;
export const FACADE_PATH = -10;
export const FACADE_PROP_BRICK = -11;
export const FACADE_PROP_RENDER = -12;
export const FACADE_PROP_CONCRETE = -13;
export const FACADE_HEDGE = -14;

/** One real-world texture set (CC0 photo-scanned): a tile in the shared atlases. */
export interface TexSet {
  tile: [number, number];
  /** Metres one tile covers (width, height). */
  metres: [number, number];
  /** Average linear albedo, so textures add detail without shifting each building's own colour. */
  avg: THREE.Vector3;
}
export type TexRole = "asphalt" | "footpath" | "brick" | "render" | "plaster" | "rooftile" | "zinc" | "laterite" | "concrete" | "grass";
/**
 * All sets packed into two atlases (colour; normal + roughness in alpha):
 * shaders may bind only 16 textures, so one image per map fails.
 */
export interface CityTextures {
  albedo: THREE.DataTexture;
  nr: THREE.DataTexture;
  grid: [number, number];
  sets: Partial<Record<TexRole, TexSet>>;
}

let ATLAS: CityTextures | null = null;

/**
 * Sample a set at a position in metres: detail colour (around 1), roughness,
 * tangent-space normal. Tiling inside an atlas cell uses fract() with explicit
 * gradients, so mip selection doesn't jump at the wrap.
 */
const sampleSet = (t: TexSet, m: N, contrast = 1) => {
  const A = ATLAS!;
  const uv = m.div(vec2(t.metres[0], t.metres[1]));
  const inset = 6 / 1024; // keep clear of the neighbouring cells' texels at lower mips
  const scale = vec2((1 - 2 * inset) / A.grid[0], (1 - 2 * inset) / A.grid[1]);
  const at = fract(uv).mul(1 - 2 * inset).add(inset).add(vec2(t.tile[0], t.tile[1])).div(vec2(A.grid[0], A.grid[1]));
  const gx = dFdx(uv).mul(scale), gy = dFdy(uv).mul(scale);
  const nr = texture(A.nr, at).grad(gx, gy);
  return {
    a: mix(vec3(1), texture(A.albedo, at).grad(gx, gy).rgb.div(vec3(t.avg.x, t.avg.y, t.avg.z)), contrast),
    r: nr.a,
    n: nr.rgb.mul(2).sub(1),
  };
};

/** 0 = Lagos look, 1 = Dublin look (set once per city). */
export const styleUniform = uniform(0);

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

/** Returns vec4(albedo, roughness). With textures, real photo-scanned detail replaces the procedural noise. */
const makeSurface = (tex: CityTextures | null) => Fn(() => {
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
    if (tex?.sets.brick && tex.sets.render && tex.sets.plaster) {
      // Dublin: red brick for brick-coloured houses, roughcast render for the
      // rest. Lagos: painted plaster. Each tinted by the building's own colour.
      const at = vec2(u, h);
      const br = sampleSet(tex.sets.brick, at), rd = sampleSet(tex.sets.render, at, 0.55), pl = sampleSet(tex.sets.plaster, at, 0.8);
      const isBrick = step(1.35, base.r.div(base.g.add(0.001))).mul(styleUniform);
      c.assign(base.mul(mix(pl.a, mix(rd.a, br.a, isBrick), styleUniform)));
      rough.assign(mix(mix(pl.r, rd.r, styleUniform), br.r, isBrick));
    } else {
      // Plaster: soft blotches and streaks so walls aren't flat paint.
      const plaster = vnoise(vec2(u.mul(0.7), h.mul(0.9))).mul(0.6).add(vnoise(vec2(u.mul(3.1), h.mul(3.7))).mul(0.4));
      c.assign(c.mul(plaster.mul(0.16).add(0.9)));
    }
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
      // Lagos: burglary-proof bars. Dublin: white uPVC frame with a centre mullion.
      const lagosBars = max(step(0.86, fract(bx.mul(8))), step(0.88, fract(fy.mul(6))));
      const wx = bx.sub(0.27).div(0.46), wy = fy.sub(0.32).div(0.48);
      const frame = max(max(step(wx, 0.07), step(0.93, wx)), max(max(step(wy, 0.08), step(0.92, wy)), step(abs(wx.sub(0.5)), 0.035)));
      const bars = mix(lagosBars, frame, styleUniform);
      const barMix = mix(float(0.14), bars, fine);
      const windowCol = mix(glass, mix(vec3(0.36, 0.33, 0.3), vec3(0.93, 0.93, 0.9), styleUniform), barMix);
      const windowRough = mix(mix(float(0.08), float(0.5), louvre), float(0.6), barMix);
      // Lintel shadow above windows and a faint stain below them.
      const lintel = step(0.8, fy).mul(step(fy, 0.85)).mul(step(0.24, bx)).mul(step(bx, 0.76));
      const stain = step(0.27, bx).mul(step(bx, 0.73)).mul(smoothstep(0.32, 0.12, fy)).mul(step(0.5, fhash(bi.mul(1.7).add(fl))));
      const plain = float(1).sub(winOnly).sub(door);
      c.assign(c.mul(float(1).sub(lintel.mul(0.22).mul(plain)).sub(stain.mul(0.12).mul(plain))));
      c.assign(mix(c, windowCol, winOnly));
      // Dublin's painted front doors; Lagos hardwood.
      const doorPaint = mix(vec3(0.32, 0.21, 0.13), signColor(bi.add(seed.mul(53))).mul(0.8), styleUniform);
      c.assign(mix(c, doorPaint, door));
      rough.assign(mix(mix(rough, windowRough, winOnly), float(0.7), door));
    });
    // Grime and rain splash near the ground.
    c.assign(c.mul(mix(float(0.62), float(1), smoothstep(0, 0.9, h))));
  })
    .ElseIf(code.lessThan(-1.5).and(code.greaterThan(-2.5)), () => {
      const kf = float(1).sub(smoothstep(0.15, 0.5, fwidth(fac.x)));
      const lagosKerb = mix(vec3(0.53, 0.45, 0.1), mix(vec3(0.96, 0.8, 0.1), vec3(0.09), step(0.5, fract(fac.x.div(1.2)))), kf);
      const dublinKerb = vec3(0.62, 0.62, 0.6).toVar();
      if (tex?.sets.concrete) dublinKerb.assign(dublinKerb.mul(sampleSet(tex.sets.concrete, vec2(xz.x.add(xz.y), positionWorld.y)).a));
      c.assign(mix(lagosKerb, dublinKerb, styleUniform));
      rough.assign(0.75);
    })
    .ElseIf(code.lessThan(-2.5).and(code.greaterThan(-4.5)), () => {
      // Asphalt: grain, patched repairs, worn wheel tracks and the odd pothole.
      if (tex?.sets.asphalt) {
        const a = sampleSet(tex.sets.asphalt, vec2(xz.x, xz.y.negate()));
        c.assign(c.mul(a.a));
      } else {
        const grain = vnoise(xz.mul(2.3)).mul(0.5).add(vnoise(xz.mul(9)).mul(0.5));
        c.assign(c.mul(grain.mul(0.18).add(0.88)));
      }
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
        // Ireland: yellow edge line just inside each kerb.
        const edge = step(0.86, abs(fac.y)).mul(step(abs(fac.y), 0.9)).mul(styleUniform);
        c.assign(mix(c, vec3(0.93, 0.78, 0.15), edge));
      });
    })
    .ElseIf(code.lessThan(-4.5).and(code.greaterThan(-5.5)), () => {
      const n = vnoise(xz.mul(0.03)).mul(0.6).add(vnoise(xz.mul(0.17)).mul(0.4));
      // Lagos: dust with laterite patches. Dublin: mown grass with worn, darker patches.
      const lagosGround = mix(c, vec3(0.72, 0.47, 0.33), smoothstep(0.45, 0.75, n).mul(0.55));
      const grass = mix(vec3(0.3, 0.46, 0.2), vec3(0.4, 0.52, 0.24), n).mul(vnoise(xz.mul(1.3)).mul(0.15).add(0.9)).toVar();
      const ground = lagosGround.toVar();
      if (tex?.sets.grass) grass.assign(grass.mul(sampleSet(tex.sets.grass, vec2(xz.x, xz.y.negate())).a));
      if (tex?.sets.laterite) ground.assign(mix(c, vec3(0.62, 0.38, 0.26), smoothstep(0.35, 0.7, n).mul(0.6)).mul(sampleSet(tex.sets.laterite, vec2(xz.x, xz.y.negate())).a));
      c.assign(mix(ground, grass, styleUniform));
      c.assign(c.mul(vnoise(xz.mul(0.7)).mul(0.1).add(0.91)));
      rough.assign(1);
    })
    .ElseIf(code.lessThan(-5.5).and(code.greaterThan(-6.5)), () => {
      if (tex?.sets.zinc) {
        const z = sampleSet(tex.sets.zinc, roofUV());
        c.assign(c.mul(z.a));
        rough.assign(z.r);
        return;
      }
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
    .ElseIf(code.lessThan(-8.5).and(code.greaterThan(-9.5)), () => {
      if (tex?.sets.rooftile) {
        const t = sampleSet(tex.sets.rooftile, roofUV());
        c.assign(c.mul(t.a));
        rough.assign(t.r);
        return;
      }
      // Concrete roof tiles: rows of ~30 cm with slight per-tile shade.
      const row = positionWorld.y.mul(3.4);
      const tileRow = fract(row);
      const tileId = floor(row).add(floor(xz.x.add(xz.y).mul(3)).mul(0.37));
      c.assign(c.mul(fhash(tileId).mul(0.12).add(0.9)).mul(mix(float(0.78), float(1), smoothstep(0.0, 0.25, tileRow))));
      c.assign(c.mul(vnoise(xz.mul(0.6)).mul(0.12).add(0.9)));
      rough.assign(0.82);
    })
    .ElseIf(code.lessThan(-9.5).and(code.greaterThan(-10.5)), () => {
      // Footpath: concrete paving slabs.
      if (tex?.sets.footpath) {
        const f = sampleSet(tex.sets.footpath, vec2(xz.x, xz.y.negate()));
        c.assign(c.mul(f.a));
        rough.assign(f.r);
      } else c.assign(c.mul(vnoise(xz.mul(0.8)).mul(0.1).add(0.9)));
    })
    .ElseIf(code.lessThan(-10.5).and(code.greaterThan(-13.5)), () => {
      // Modelled props: the same photo sets as the houses, mapped in metres on each face.
      if (tex?.sets.brick && tex.sets.render && tex.sets.concrete) {
        const at = propUV();
        const { brick, render } = propMix(code);
        const a = mix(mix(sampleSet(tex.sets.concrete, at).a, sampleSet(tex.sets.render, at, 0.55).a, render), sampleSet(tex.sets.brick, at).a, brick);
        c.assign(c.mul(a));
      } else c.assign(c.mul(vnoise(propUV().mul(1.5)).mul(0.14).add(0.86)));
      // Grime splashed up the bottom of a wall.
      c.assign(c.mul(mix(float(0.7), float(1), smoothstep(0, 0.35, positionWorld.y))));
      rough.assign(0.9);
    })
    .ElseIf(code.lessThan(-13.5).and(code.greaterThan(-14.5)), () => {
      // Clipped privet: small leaves in two sizes, darker deep in the gaps.
      const at = propUV();
      const leaves = vnoise(at.mul(9)).mul(0.6).add(vnoise(at.mul(23)).mul(0.4));
      c.assign(c.mul(mix(float(0.55), float(1.25), leaves)).mul(vnoise(at.mul(1.3)).mul(0.25).add(0.85)));
      rough.assign(0.95);
    })
    .ElseIf(code.lessThan(-6.5), () => {
      if (tex?.sets.concrete) c.assign(c.mul(sampleSet(tex.sets.concrete, vec2(xz.x, xz.y.negate())).a));
      c.assign(c.mul(vnoise(xz.mul(0.8)).mul(0.14).add(0.86)));
      rough.assign(0.95);
    });

  return vec4(c.mul(fac.w), min(rough, 1));
});

// The mapping helpers below run inside the colour node, where normalWorld is
// derived from the lit normal, which isn't computed yet: it read as
// normalize(0) = NaN and blackened every prop and hedge pixel (and the lighting
// with it). They use the mesh's own normal instead. makeNormal, the normal
// node itself, keeps normalWorld: there three gives it the geometric normal.
/** Roof faces: along the eaves and up the slope, in metres. */
const roofUV = () => {
  const n = normalWorldGeometry;
  const t = normalize(vec3(n.z.negate(), 0, n.x).add(vec3(1e-4, 0, 0)));
  const sinSlope = max(float(0.25), float(1).sub(n.y.mul(n.y)).sqrt());
  return vec2(dot(positionWorld, t), positionWorld.y.div(sinSlope));
};

/** Prop faces: walls along the face and up, tops east and north, in metres. */
const propUV = () => {
  const n = normalWorldGeometry;
  const t = normalize(vec3(n.z.negate(), 0, n.x).add(vec3(1e-4, 0, 0)));
  const up = step(0.7, abs(n.y));
  return mix(vec2(dot(positionWorld, t), positionWorld.y), vec2(positionWorld.x, positionWorld.z.negate()), up);
};

/** Which texture set a prop surface code draws (concrete when both are 0). */
const propMix = (code: N) => ({
  brick: step(-11.5, code),
  render: step(-12.5, code).mul(step(code, -11.5)),
});

/** 1 where a wall pixel is window, door or shopfront (flat glass, paint, shutters): no brick relief. */
const openings = Fn(([u, h, code]: [N, N, N]) => {
  const seed = floor(fract(code).mul(1000).add(0.5)).div(1000);
  const fl = floor(h.div(3.2));
  const fy = fract(h.div(3.2));
  const bay = seed.mul(1.4).add(2.4);
  const bi = floor(u.div(bay));
  const bx = fract(u.div(bay));
  const win = step(0.27, bx).mul(step(bx, 0.73)).mul(step(0.32, fy)).mul(step(fy, 0.8));
  const door = step(fl, 0.5).mul(step(abs(mod(bi, 4).sub(1)), 0.5)).mul(step(0.3, bx)).mul(step(bx, 0.7)).mul(step(fy, 0.72));
  const shop = step(1.5, code).mul(step(fl, 0.5));
  return min(float(1), win.add(door).add(shop));
});

/**
 * Per-pixel normal from the texture sets' normal maps, built in world space
 * from each surface's own axes (walls: along the wall and up; ground: east and
 * north; roofs: along the eaves and up the slope), returned in view space.
 */
const makeNormal = (tex: CityTextures) => Fn(() => {
  const fac = attribute("facade", "vec4");
  const base = attribute("color", "vec3");
  const code = fac.z;
  const N = normalWorld;
  const xz = positionWorld.xz;
  const nw = vec3(N).toVar();
  const ground = (t: TexSet | undefined, strength: number) => {
    if (!t) return;
    const n = sampleSet(t, vec2(xz.x, xz.y.negate())).n;
    // T = +x, B = -z, N = +y.
    nw.assign(normalize(vec3(n.x.mul(strength), n.z, n.y.mul(strength).negate())));
  };
  If(code.greaterThanEqual(0), () => {
    if (!tex.sets.brick || !tex.sets.render || !tex.sets.plaster) return;
    const at = vec2(fac.x, fac.y);
    const isBrick = step(1.35, base.r.div(base.g.add(0.001))).mul(styleUniform);
    const n = mix(sampleSet(tex.sets.plaster, at).n, mix(sampleSet(tex.sets.render, at).n, sampleSet(tex.sets.brick, at).n, isBrick), styleUniform).toVar();
    // Glass, doors and shutters stay flat.
    const flat = openings(fac.x, fac.y, code);
    n.assign(mix(n, vec3(0, 0, 1), flat));
    const T = normalize(vec3(N.z.negate(), 0, N.x).add(vec3(1e-4, 0, 0)));
    nw.assign(normalize(T.mul(n.x).add(vec3(0, 1, 0).mul(n.y)).add(N.mul(n.z))));
  })
    .ElseIf(code.lessThan(-2.5).and(code.greaterThan(-4.5)), () => ground(tex.sets.asphalt, 0.8))
    .ElseIf(code.lessThan(-4.5).and(code.greaterThan(-5.5)), () => {
      if (tex.sets.grass && tex.sets.laterite) {
        const at = vec2(xz.x, xz.y.negate());
        const n = mix(sampleSet(tex.sets.laterite, at).n, sampleSet(tex.sets.grass, at).n, styleUniform);
        nw.assign(normalize(vec3(n.x, n.z, n.y.negate())));
      }
    })
    .ElseIf(code.lessThan(-9.5).and(code.greaterThan(-10.5)), () => ground(tex.sets.footpath, 1))
    .ElseIf(code.lessThan(-5.5).and(code.greaterThan(-6.5)).or(code.lessThan(-8.5).and(code.greaterThan(-9.5))), () => {
      const t = code.greaterThan(-6.5);
      if (!tex.sets.zinc || !tex.sets.rooftile) return;
      const n = mix(sampleSet(tex.sets.rooftile, roofUV()).n, sampleSet(tex.sets.zinc, roofUV()).n, select(t, float(1), float(0)));
      const T = normalize(vec3(N.z.negate(), 0, N.x).add(vec3(1e-4, 0, 0)));
      const B = normalize(vec3(0, 1, 0).sub(N.mul(N.y)).add(vec3(0, 1e-4, 0)));
      nw.assign(normalize(T.mul(n.x).add(B.mul(n.y)).add(N.mul(n.z))));
    })
    .ElseIf(code.lessThan(-6.5).and(code.greaterThan(-7.5)), () => ground(tex.sets.concrete, 1))
    .ElseIf(code.lessThan(-10.5).and(code.greaterThan(-13.5)), () => {
      if (!tex.sets.brick || !tex.sets.render || !tex.sets.concrete) return;
      const at = propUV();
      const { brick, render } = propMix(code);
      const n = mix(mix(sampleSet(tex.sets.concrete, at).n, sampleSet(tex.sets.render, at).n, render), sampleSet(tex.sets.brick, at).n, brick);
      const up = abs(N.y).greaterThan(0.7);
      const T = select(up, vec3(1, 0, 0), normalize(vec3(N.z.negate(), 0, N.x).add(vec3(1e-4, 0, 0))));
      const B = select(up, vec3(0, 0, -1), vec3(0, 1, 0));
      nw.assign(normalize(T.mul(n.x).add(B.mul(n.y)).add(N.mul(n.z))));
    });
  return normalize(cameraViewMatrix.mul(vec4(nw, 0)).xyz);
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
    const power = max(step(0.32, fhash(cell.x.mul(17.1).add(cell.y.mul(31.7)).add(floor(clockUniform.div(240)).mul(7.3)))), styleUniform);
    const r = fhash(bi.mul(1.3).add(fl.mul(13)).add(seed.mul(71)));
    const lit = mix(step(r, 0.12), step(r, 0.62), power);
    const warm = mix(vec3(1.0, 0.78, 0.5), vec3(0.85, 0.95, 1.0), step(0.6, fhash(r.mul(9.1))));
    const win = step(0.27, bx).mul(step(bx, 0.73)).mul(step(0.32, fy)).mul(step(fy, 0.8)).mul(float(1).sub(shop.mul(step(fl, 0.5))));
    // Open shops spill light from inside the shutters.
    const shopInside = shop.mul(step(fl, 0.5)).mul(step(fy, 0.78)).mul(step(0.06, bx)).mul(step(bx, 0.94)).mul(step(0.45, fhash(bi.add(seed.mul(37)))));
    glow.assign(warm.mul(win.mul(lit).mul(mix(float(0.45), float(0.95), power))).add(vec3(1.0, 0.8, 0.5).mul(shopInside.mul(mix(float(0.2), float(0.8), power)))));
  }).ElseIf(code.lessThan(-7.5).and(code.greaterThan(-8.5)), () => {
    // Sodium orange in Lagos; Dublin's LED lanterns are a neutral white.
    glow.assign(mix(vec3(1.0, 0.72, 0.38), vec3(1.0, 0.93, 0.82), styleUniform).mul(5));
  });
  return glow.mul(nightUniform);
});

export function createWorldMaterial(tex: CityTextures | null = null): THREE.MeshStandardNodeMaterial {
  const mat = new THREE.MeshStandardNodeMaterial();
  ATLAS = tex;
  const s = makeSurface(tex)();
  if (tex) mat.normalNode = makeNormal(tex)();
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
