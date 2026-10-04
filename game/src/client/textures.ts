import * as THREE from "three/webgpu";
import type { CityTextures, TexRole, TexSet } from "./facade";

// Loads the CC0 photo-scanned texture sets listed in /tex/manifest.json
// (fetched by tools/assets/fetch_textures.py) and packs them into TWO atlas
// textures: colour, and normal + roughness (roughness in alpha). GPUs allow
// only 16 textures per shader (thirty separate images broke the city), and
// plain 2D atlases work everywhere, unlike texture arrays on some drivers.
// Missing sets just fall back to the procedural look.

const SIZE = 1024;

interface Manifest {
  [role: string]: { metres: [number, number] };
}

async function image(url: string): Promise<ImageBitmap> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(url);
  return createImageBitmap(await res.blob());
}

/** Pixels of an image scaled to SIZE x SIZE. */
function pixels(img: ImageBitmap, g: CanvasRenderingContext2D): Uint8ClampedArray {
  g.clearRect(0, 0, SIZE, SIZE);
  g.drawImage(img, 0, 0, SIZE, SIZE);
  return g.getImageData(0, 0, SIZE, SIZE).data;
}

const lin = (v: number) => {
  const x = v / 255;
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
};

/** Player setting (pause menu): real textures on or off. */
export function texturesEnabled(): boolean {
  try {
    if (new URLSearchParams(location.search).has("notex")) return false;
    return localStorage.getItem("eko-textures") !== "off";
  } catch {
    return true;
  }
}

export async function loadCityTextures(maxAniso = 8): Promise<CityTextures | null> {
  if (!texturesEnabled()) return null;
  let manifest: Manifest;
  try {
    const res = await fetch("/tex/manifest.json");
    if (!res.ok) return null;
    manifest = await res.json();
  } catch {
    return null;
  }
  const roles = Object.keys(manifest) as TexRole[];
  const loaded = await Promise.all(
    roles.map(async (role) => {
      try {
        const [a, n, r] = await Promise.all([image(`/tex/${role}/albedo.jpg`), image(`/tex/${role}/normal.jpg`), image(`/tex/${role}/rough.jpg`)]);
        return { role, a, n, r };
      } catch {
        return null;
      }
    }),
  );
  const ok = loaded.filter((x): x is NonNullable<typeof x> => !!x);
  if (!ok.length) return null;

  // Lay the sets out in a grid in two ordinary 2D textures: the most widely
  // supported thing a GPU can sample. Row 0 is the bottom (v = 0).
  const cols = Math.min(4, ok.length), rows = Math.ceil(ok.length / cols);
  const W = cols * SIZE, H = rows * SIZE;
  const albedo = new Uint8Array(W * H * 4);
  const nr = new Uint8Array(W * H * 4);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const g = canvas.getContext("2d", { willReadFrequently: true })!;
  const sets: Partial<Record<TexRole, TexSet>> = {};
  ok.forEach(({ role, a, n, r }, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const pa = pixels(a, g), pn = pixels(n, g), pr = pixels(r, g);
    let sr = 0, sg = 0, sb = 0, cnt = 0;
    for (let y = 0; y < SIZE; y++) {
      // Image rows run top-down; texture rows bottom-up.
      const dst = ((row * SIZE + (SIZE - 1 - y)) * W + col * SIZE) * 4;
      const src = y * SIZE * 4;
      albedo.set(pa.subarray(src, src + SIZE * 4), dst);
      for (let x = 0; x < SIZE; x++) {
        const k = src + x * 4, d = dst + x * 4;
        nr[d] = pn[k];
        nr[d + 1] = pn[k + 1];
        nr[d + 2] = pn[k + 2];
        nr[d + 3] = pr[k];
        if ((x & 15) === 0 && (y & 15) === 0) {
          sr += lin(pa[k]);
          sg += lin(pa[k + 1]);
          sb += lin(pa[k + 2]);
          cnt++;
        }
      }
    }
    sets[role] = {
      tile: [col, row],
      metres: manifest[role].metres,
      avg: new THREE.Vector3(Math.max(0.02, sr / cnt), Math.max(0.02, sg / cnt), Math.max(0.02, sb / cnt)),
    };
  });

  const make = (data: Uint8Array, srgb: boolean) => {
    const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.anisotropy = maxAniso;
    t.needsUpdate = true;
    return t;
  };
  return { albedo: make(albedo, true), nr: make(nr, false), grid: [cols, rows], sets };
}
