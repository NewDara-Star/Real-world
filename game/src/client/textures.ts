import * as THREE from "three/webgpu";
import type { CityTextures, TexRole, TexSet } from "./facade";

// Loads the CC0 photo-scanned texture sets listed in /tex/manifest.json
// (fetched by tools/assets/fetch_textures.py) and packs them into TWO
// texture arrays: colour, and normal + roughness (roughness in alpha).
// GPUs allow only 16 textures per shader, so thirty separate images made
// the whole city shader fail to compile on real hardware.
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

export async function loadCityTextures(maxAniso = 8): Promise<CityTextures | null> {
  if (new URLSearchParams(location.search).has("notex")) return null;
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

  const layer = SIZE * SIZE * 4;
  const albedo = new Uint8Array(layer * ok.length);
  const nr = new Uint8Array(layer * ok.length);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const g = canvas.getContext("2d", { willReadFrequently: true })!;
  const sets: Partial<Record<TexRole, TexSet>> = {};
  ok.forEach(({ role, a, n, r }, i) => {
    const pa = pixels(a, g);
    albedo.set(pa, i * layer);
    // Average linear colour, so detail can be applied around each building's own colour.
    let sr = 0, sg = 0, sb = 0;
    for (let k = 0; k < pa.length; k += 4 * 97) {
      sr += lin(pa[k]);
      sg += lin(pa[k + 1]);
      sb += lin(pa[k + 2]);
    }
    const cnt = Math.ceil(pa.length / (4 * 97));
    const pn = pixels(n, g);
    const pr = pixels(r, g);
    const off = i * layer;
    for (let k = 0; k < layer; k += 4) {
      nr[off + k] = pn[k];
      nr[off + k + 1] = pn[k + 1];
      nr[off + k + 2] = pn[k + 2];
      nr[off + k + 3] = pr[k];
    }
    sets[role] = {
      layer: i,
      metres: manifest[role].metres,
      avg: new THREE.Vector3(Math.max(0.02, sr / cnt), Math.max(0.02, sg / cnt), Math.max(0.02, sb / cnt)),
    };
  });

  const make = (data: Uint8Array, srgb: boolean) => {
    const t = new THREE.DataArrayTexture(data, SIZE, SIZE, ok.length);
    t.format = THREE.RGBAFormat;
    t.type = THREE.UnsignedByteType;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.anisotropy = maxAniso;
    t.needsUpdate = true;
    return t;
  };
  return { albedo: make(albedo, true), nr: make(nr, false), sets };
}
