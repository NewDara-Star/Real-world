import * as THREE from "three";

// One shared material for the whole city. Each vertex carries a `facade`
// attribute (u, v, code, light) and the fragment shader paints detail
// procedurally, so there are no textures to download or keep in GPU memory.
//
//   code >= 0   building wall. fract(code) = per-building seed; code >= 2 marks
//               a ground-floor shopfront. u = metres along the wall, v = height.
//   -1          plain vertex colour (roofs, props, green areas)
//   -2          kerb: black/yellow stripes along u
//   -3          road with centre line (v = lateral position -1..1)
//   -4          road without centre line
//   -5          bare ground (laterite / dust patches)
// light (w) multiplies the final colour (baked sun shading for walls).

export const FACADE_PLAIN = -1;
export const FACADE_KERB = -2;
export const FACADE_ROAD_LINED = -3;
export const FACADE_ROAD = -4;
export const FACADE_GROUND = -5;

const HEADER = /* glsl */ `
varying vec4 vFacade;
varying vec2 vWorldXZ;
float fhash(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float fhash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(fhash2(i), fhash2(i + vec2(1.0, 0.0)), u.x), mix(fhash2(i + vec2(0.0, 1.0)), fhash2(i + vec2(1.0, 1.0)), u.x), u.y);
}
vec3 signColor(float k) {
  float i = floor(fhash(k) * 8.0);
  if (i < 1.0) return vec3(0.98, 0.80, 0.10);  // yellow
  if (i < 2.0) return vec3(0.09, 0.55, 0.27);  // green
  if (i < 3.0) return vec3(0.80, 0.13, 0.12);  // red
  if (i < 4.0) return vec3(0.10, 0.32, 0.70);  // blue
  if (i < 5.0) return vec3(0.95, 0.94, 0.90);  // white
  if (i < 6.0) return vec3(0.96, 0.50, 0.10);  // orange
  if (i < 7.0) return vec3(0.46, 0.20, 0.60);  // purple
  return vec3(0.05, 0.60, 0.65);               // teal
}
`;

const FRAGMENT = /* glsl */ `
{
  float code = vFacade.z;
  vec3 c = diffuseColor.rgb;
  if (code >= 0.0) {
    float u = vFacade.x;
    float h = vFacade.y;
    // Interpolation leaves ~1e-7 noise on a "constant" varying; the hash would
    // amplify that into per-pixel speckle, so snap the seed to its 1/1000 grid.
    float seed = floor(fract(code) * 1000.0 + 0.5) / 1000.0;
    float shop = step(1.5, code);
    float fh = 3.2;
    float fl = floor(h / fh);
    float fy = fract(h / fh);
    float bay = 2.4 + seed * 1.4;
    float bi = floor(u / bay);
    float bx = fract(u / bay);
    // How many metres one pixel covers: fade fine detail before it aliases into noise.
    float px = fwidth(u) + fwidth(h);
    float fine = 1.0 - smoothstep(0.05, 0.18, px);
    if (shop > 0.5 && fl < 0.5) {
      if (fy < 0.78) {
        // Roller shutters, some rolled up to show a dark shop interior.
        float open = step(0.45, fhash(bi + seed * 37.0));
        vec3 shutter = mix(vec3(0.51, 0.53, 0.54), mix(vec3(0.56, 0.58, 0.59), vec3(0.45, 0.47, 0.48), step(0.5, fract(h * 6.0))), fine);
        vec3 inside = mix(vec3(0.20, 0.17, 0.14), signColor(bi * 3.1 + seed) * 0.5, step(0.6, fract(h * 1.3)) * 0.4);
        float doorway = step(0.06, bx) * step(bx, 0.94);
        c = mix(c, mix(shutter, inside, open), doorway);
      } else {
        // Painted signboard with a hint of lettering.
        vec3 sc = signColor(floor(u / (bay * 2.0)) + seed * 91.0);
        float txt = step(0.45, fract(u * 1.9 + seed * 5.0)) * step(0.84, fy) * step(fy, 0.93) * step(0.12, fract(u / (bay * 2.0))) * step(fract(u / (bay * 2.0)), 0.88);
        vec3 ink = mix(vec3(0.07), vec3(0.95), step(0.75, dot(sc, vec3(0.33))) < 0.5 ? 1.0 : 0.0);
        c = mix(sc, ink, txt * 0.8 * fine);
      }
    } else {
      float win = step(0.27, bx) * step(bx, 0.73) * step(0.32, fy) * step(fy, 0.80);
      float door = (fl < 0.5 && mod(bi, 4.0) == 1.0) ? step(0.30, bx) * step(bx, 0.70) * step(fy, 0.72) : 0.0;
      if (door > 0.5) {
        c = vec3(0.32, 0.21, 0.13);
      } else if (win > 0.5) {
        // Glass or louvres behind burglary-proof bars.
        vec3 glass = mix(vec3(0.17, 0.22, 0.26), vec3(0.30, 0.33, 0.34), mix(0.5, step(0.5, fract(fy * 14.0)), fine) * step(0.5, fhash(bi + fl * 7.0 + seed)));
        float bars = max(step(0.86, fract(bx * 8.0)), step(0.88, fract(fy * 6.0)));
        c = mix(glass, vec3(0.36, 0.33, 0.30), mix(0.14, bars, fine));
      } else {
        float lintel = step(0.80, fy) * step(fy, 0.85) * step(0.24, bx) * step(bx, 0.76);
        float stain = step(0.27, bx) * step(bx, 0.73) * smoothstep(0.32, 0.12, fy) * step(0.5, fhash(bi * 1.7 + fl));
        c *= 1.0 - lintel * 0.22 - stain * 0.12;
      }
    }
    // Grime and rain splash near the ground.
    c *= mix(0.70, 1.0, smoothstep(0.0, 0.9, h));
  } else if (code < -1.5 && code > -2.5) {
    float kf = 1.0 - smoothstep(0.15, 0.5, fwidth(vFacade.x));
    c = mix(vec3(0.53, 0.45, 0.10), mix(vec3(0.96, 0.80, 0.10), vec3(0.09), step(0.5, fract(vFacade.x / 1.2))), kf);
  } else if (code < -2.5 && code > -4.5) {
    float patchy = smoothstep(0.62, 0.70, vnoise(vWorldXZ * 0.12));
    c *= 1.0 - patchy * 0.16;
    // Occasional potholes, rarer on big roads (two noise octaves must agree).
    float hole = smoothstep(0.86, 0.9, vnoise(vWorldXZ * 0.55 + 17.0)) * step(0.55, vnoise(vWorldXZ * 0.05 + 3.0));
    c = mix(c, vec3(0.30, 0.24, 0.18), hole * 0.8);
    if (code > -3.5) {
      float line = step(abs(vFacade.y), 0.03) * step(0.5, fract(vFacade.x / 6.0));
      c = mix(c, vec3(0.92, 0.90, 0.84), line * 0.9);
    }
  } else if (code < -4.5) {
    float n = vnoise(vWorldXZ * 0.03) * 0.6 + vnoise(vWorldXZ * 0.17) * 0.4;
    c = mix(c, vec3(0.72, 0.47, 0.33), smoothstep(0.45, 0.75, n) * 0.55);
    c *= 0.92 + 0.08 * vnoise(vWorldXZ * 0.7);
  }
  diffuseColor.rgb = c * vFacade.w;
}
`;

export function createWorldMaterial(): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec4 facade;\nvarying vec4 vFacade;\nvarying vec2 vWorldXZ;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFacade = facade;\nvWorldXZ = (modelMatrix * vec4(position, 1.0)).xz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n" + HEADER)
      .replace("#include <color_fragment>", "#include <color_fragment>\n" + FRAGMENT);
  };
  mat.customProgramCacheKey = () => "eko-facade-v1";
  return mat;
}
