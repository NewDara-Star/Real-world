import * as THREE from "three/webgpu";
import type { CityTextures, TexRole, TexSet } from "./facade";

// Loads the CC0 photo-scanned texture sets listed in /tex/manifest.json
// (fetched by tools/assets/fetch_textures.py). Missing sets just fall back to
// the procedural look, so the city still renders if any file is absent.

interface Manifest {
  [role: string]: { metres: [number, number] };
}

const loader = new THREE.TextureLoader();

function load(url: string, srgb: boolean, maxAniso: number): Promise<THREE.Texture> {
  return new Promise((res, rej) =>
    loader.load(url, (t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = maxAniso;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      res(t);
    }, undefined, rej),
  );
}

/** Average linear colour of an sRGB image, from a 16x16 downsample. */
function averageLinear(img: CanvasImageSource): THREE.Vector3 {
  const c = document.createElement("canvas");
  c.width = c.height = 16;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, 16, 16);
  const d = g.getImageData(0, 0, 16, 16).data;
  const lin = (v: number) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  let r = 0, gg = 0, b = 0;
  for (let i = 0; i < d.length; i += 4) {
    r += lin(d[i]);
    gg += lin(d[i + 1]);
    b += lin(d[i + 2]);
  }
  const n = d.length / 4;
  return new THREE.Vector3(Math.max(0.02, r / n), Math.max(0.02, gg / n), Math.max(0.02, b / n));
}

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
  const out: CityTextures = {};
  await Promise.all(
    Object.entries(manifest).map(async ([role, m]) => {
      try {
        const [albedo, normal, rough] = await Promise.all([
          load(`/tex/${role}/albedo.jpg`, true, maxAniso),
          load(`/tex/${role}/normal.jpg`, false, maxAniso),
          load(`/tex/${role}/rough.jpg`, false, maxAniso),
        ]);
        const set: TexSet = { albedo, normal, rough, metres: m.metres, avg: averageLinear(albedo.image as CanvasImageSource) };
        out[role as TexRole] = set;
      } catch {
        // leave this role procedural
      }
    }),
  );
  return out;
}
