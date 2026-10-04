// Builds the game's pedestrians from Microsoft Rocketbox (MIT,
// https://github.com/microsoft/Microsoft-Rocketbox). See research/20-human-npcs.md.
//
//   cd tools/assets/people && npm install && node build_people.mjs [--cache DIR]
//
// 1. Sparse, blob-less clone of just the avatars and clips we use (cached).
// 2. Each avatar: FBX -> glTF (FBX2glTF), textures shrunk to JPEG/PNG, a second
//    lower-detail copy of every mesh (shared vertices, simplified indices,
//    node name + "_lod1") for people further away.
// 3. Each clip: FBX -> glTF, keeping only bone rotations plus the root's
//    translation. Each walk's real speed is measured from the root's travel
//    (the game pins that travel so walkers move by their own speed instead).
// 4. game/public/models/humans/people.json lists who, which place, which clips.
//
// Rocketbox's Bip01 skeleton is the house rig: every human in the game uses it.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { prune, quantize, simplifyPrimitive, weld } from "@gltf-transform/functions";
import { KHRMeshQuantization } from "@gltf-transform/extensions";
import convert from "fbx2gltf";
import { MeshoptSimplifier } from "meshoptimizer";

const ROOT = new URL("../../..", import.meta.url).pathname;
const OUT = join(ROOT, "game/public/models/humans");
const args = process.argv.slice(2);
const CACHE = args.includes("--cache") ? args[args.indexOf("--cache") + 1] : join(homedir(), ".cache/realworld/rocketbox");
const REPO = "https://github.com/microsoft/Microsoft-Rocketbox.git";

// Who walks where. Everyday clothes only; no foreign police, military or fire
// uniforms (owner's decision). Dublin is a mixed city, so it uses everyone;
// Lagos uses the Black civilians until our MakeHuman people are made.
const LAGOS = ["Male_Adult_04", "Male_Adult_12", "Male_Adult_18", "Male_Child_02", "Sports_Male_03", "Business_Male_05", "Construction_Male_03", "Female_Party_02", "Business_Female_01"];
const DUBLIN = [
  ...[1, 2, 3, 5, 6, 7, 8, 9, 10, 11].map((n) => `Male_Adult_${String(n).padStart(2, "0")}`),
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `Female_Adult_${String(n).padStart(2, "0")}`),
  "Business_Male_01", "Business_Female_02", "Male_Child_01", "Female_Child_01",
  "Male_Adult_04", "Male_Adult_12", "Business_Female_01",
];
const AVATARS = [...new Set([...DUBLIN, ...LAGOS])];
const GROUP = (name) => (/Child/.test(name) ? "Children" : /_Adult_|_Party_/.test(name) ? "Adults" : "Professions");
const SEX = (name) => (/Female/.test(name) ? "f" : "m");

// Clips per sex: two walks (variety), a slow walk, and two idles. (The
// "waiting" idles are 47 s long: too much to bake into every person.)
const CLIPS = { walk: ["walk_neutral_01", "walk_neutral_02", "walk_slow_01"], idle: ["idle_neutral_01", "idle_look_around_01"] };
const clipFile = (sex, c, kind) => `Assets/Animations/all_animations_max_motextr_${kind}/${sex}_${c}.max.fbx`;

function sh(cmd, a, opts = {}) {
  return execFileSync(cmd, a, { stdio: ["ignore", "pipe", "inherit"], ...opts }).toString();
}

// ---- 1. sources ----
// A blob-less clone: only the files we ask for are downloaded, one person at
// a time, and the big source textures are deleted once converted.
if (!existsSync(join(CACHE, ".git"))) {
  mkdirSync(CACHE, { recursive: true });
  sh("git", ["clone", "--filter=blob:none", "--no-checkout", "--depth", "1", REPO, CACHE]);
}
const fetch = (...files) => {
  const want = files.filter((f) => !existsSync(join(CACHE, f)));
  if (want.length) sh("git", ["-C", CACHE, "checkout", "HEAD", "--", ...want]);
};
const ls = (dir) => sh("git", ["-C", CACHE, "ls-tree", "--name-only", "HEAD", dir + "/"]).split("\n").filter(Boolean);
fetch("LICENSE.md");
if (!/MIT License/.test(readFileSync(join(CACHE, "LICENSE.md"), "utf8"))) throw new Error("Rocketbox's licence is no longer MIT: stop and check");

mkdirSync(OUT, { recursive: true });
const io = new NodeIO().registerExtensions([KHRMeshQuantization]);

// Smaller files: geometry quantised to 16-bit (KHR_mesh_quantization, read
// natively by three.js), and the hair/eyelash cut-out map at 256 px.
async function optimise(doc) {
  for (const m of doc.getRoot().listMaterials()) {
    const t = m.getBaseColorTexture();
    if (m.getAlphaMode() === "MASK" && t && t.getMimeType() === "image/png") {
      const src = join(tmp, `op_${Math.random().toString(36).slice(2)}.png`);
      writeFileSync(src, t.getImage());
      t.setImage(image(src, 256, true));
    }
  }
  await doc.transform(quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }), prune());
}
const tmp = join(tmpdir(), "realworld-people");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

// TGA -> JPEG/PNG at a size, with Pillow (sharp can't read TGA).
function image(src, size, png) {
  const out = join(tmp, `img_${Math.random().toString(36).slice(2)}.${png ? "png" : "jpg"}`);
  sh("python3", ["-c", `
from PIL import Image
im = Image.open(${JSON.stringify(src)})
im = im.convert("RGBA" if ${png ? "True" : "False"} else "RGB").resize((${size}, ${size}), Image.LANCZOS)
im.save(${JSON.stringify(out)}, quality=86) if not ${png ? "True" : "False"} else im.save(${JSON.stringify(out)}, optimize=True)
`]);
  return readFileSync(out);
}

// Re-run only the size pass on already-built people (no re-download).
if (args.includes("--reoptimise")) {
  for (const f of sh("ls", [OUT]).split("\n").filter((f) => f.endsWith(".glb"))) {
    const doc = await io.read(join(OUT, f));
    await optimise(doc);
    await io.write(join(OUT, f), doc);
    console.log(`${f}: ${(readFileSync(join(OUT, f)).length / 1024).toFixed(0)} KB`);
  }
  process.exit(0);
}

// ---- 2. avatars ----
const CLIPS_ONLY = args.includes("--clips-only"); // keep the people already built, redo the clips
const manifest = { source: "Microsoft Rocketbox (MIT)", rig: "Bip01", avatars: [], clips: {}, walkSpeed: {} };
for (const name of CLIPS_ONLY ? [] : AVATARS) {
  const rel = `Assets/Avatars/${GROUP(name)}/${name}`;
  const dir = join(CACHE, rel);
  const texFiles = ls(`${rel}/Textures`).filter((f) => /_(body|head)_(color|normal)\.tga$|_opacity_color\.tga$/.test(f));
  try {
    fetch(`${rel}/Export/${name}.fbx`, ...texFiles);
  } catch {
    console.warn(`skipped ${name}: not in Rocketbox`);
    continue;
  }
  const fbx = join(dir, "Export", `${name}.fbx`);
  const raw = join(tmp, `${name}.glb`);
  await convert(fbx, raw, ["--binary"]);
  const doc = await io.read(raw);
  for (const t of doc.getRoot().listTextures()) t.dispose();
  const tex = (file, size, png = false) => {
    const p = join(dir, "Textures", file);
    return existsSync(p) ? doc.createTexture(file).setImage(image(p, size, png)).setMimeType(png ? "image/png" : "image/jpeg") : null;
  };
  const code = texFiles.map((f) => f.split("/").pop()).find((f) => f.endsWith("_body_color.tga"))?.replace("_body_color.tga", "");
  for (const m of doc.getRoot().listMaterials()) {
    const n = m.getName().toLowerCase();
    m.setMetallicFactor(0).setRoughnessFactor(0.85);
    if (n.endsWith("body")) m.setBaseColorTexture(tex(`${code}_body_color.tga`, 1024)).setNormalTexture(tex(`${code}_body_normal.tga`, 512));
    else if (n.endsWith("head")) m.setBaseColorTexture(tex(`${code}_head_color.tga`, 512)).setNormalTexture(tex(`${code}_head_normal.tga`, 256));
    else if (n.endsWith("opacity")) m.setBaseColorTexture(tex(`${code}_opacity_color.tga`, 512, true)).setAlphaMode("MASK").setAlphaCutoff(0.4).setDoubleSided(true);
  }
  // Facial blend shapes and extra UV sets aren't used: drop them.
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) for (const t of prim.listTargets()) prim.removeTarget(t);
  await doc.transform(weld());
  // LOD1: a sibling node per skinned mesh, same vertices, about a fifth of the triangles.
  await MeshoptSimplifier.ready;
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh || !node.getSkin() || node.getName().endsWith("_lod1")) continue;
    const low = doc.createMesh(mesh.getName() + "_lod1");
    for (const prim of mesh.listPrimitives()) {
      const p = prim.clone();
      p.setIndices(prim.getIndices().clone());
      simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio: 0.22, error: 0.01 });
      low.addPrimitive(p);
    }
    const lodNode = doc.createNode(node.getName() + "_lod1").setMesh(low).setSkin(node.getSkin()).setTranslation(node.getTranslation()).setRotation(node.getRotation()).setScale(node.getScale());
    (node.getParentNode() ?? doc.getRoot().listScenes()[0]).addChild(lodNode);
  }
  await optimise(doc);
  await io.write(join(OUT, `${name}.glb`), doc);
  const tris = (suffix) => doc.getRoot().listMeshes().filter((m) => m.getName().endsWith("_lod1") === (suffix === "lod1")).reduce((s, m) => s + m.listPrimitives().reduce((a, p) => a + (p.getIndices()?.getCount() ?? 0) / 3, 0), 0);
  manifest.avatars.push({ name, sex: SEX(name), places: [DUBLIN.includes(name) && "finglas", LAGOS.includes(name) && "yaba"].filter(Boolean), tris: Math.round(tris("lod0")), trisLod1: Math.round(tris("lod1")) });
  rmSync(dir, { recursive: true, force: true }); // the sources are 80+ MB a person
  console.log(`${name}: ${Math.round(tris("lod0"))} / ${Math.round(tris("lod1"))} triangles, ${(readFileSync(join(OUT, `${name}.glb`)).length / 1024).toFixed(0)} KB`);
}

// ---- 3. clips ----
mkdirSync(join(OUT, "clips"), { recursive: true });
for (const sex of ["m", "f"]) {
  manifest.clips[sex] = { walk: [], idle: [] };
  for (const kind of ["walk", "idle"]) {
    for (const c of CLIPS[kind]) {
      try {
        fetch(clipFile(sex, c, kind === "walk" ? "xy" : "static"));
      } catch {
        console.warn(`skipped clip ${sex}_${c}: not in Rocketbox`);
        continue;
      }
      const src = join(CACHE, clipFile(sex, c, kind === "walk" ? "xy" : "static"));
      const name = `${sex}_${c}`;
      const raw = join(tmp, `${name}.glb`);
      await convert(src, raw, ["--binary", "--anim-framerate=bake30"]);
      const doc = await io.read(raw);
      // Walking speed: the "xy" walks still carry the root's forward travel
      // (the game pins it at load). Distance over time is the speed the clip
      // was recorded at, which the game matches to each walker's real speed.
      if (kind === "walk") {
        const root = doc.getRoot().listNodes().find((n) => n.getName() === "Bip01");
        let scale = 1;
        for (let p = root?.getParentNode(); p; p = p.getParentNode()) scale *= p.getScale()[0];
        const ch = doc.getRoot().listAnimations().flatMap((a) => a.listChannels()).find((k) => k.getTargetNode() === root && k.getTargetPath() === "translation");
        if (ch) {
          const t = ch.getSampler().getInput().getArray(), v = ch.getSampler().getOutput().getArray();
          const n = t.length;
          const dist = Math.hypot(v[(n - 1) * 3] - v[0], v[(n - 1) * 3 + 2] - v[2]) * scale;
          manifest.walkSpeed[name] = +(dist / (t[n - 1] - t[0])).toFixed(3);
        }
      }
      for (const a of doc.getRoot().listAnimations()) {
        a.setName(name);
        for (const ch of a.listChannels()) {
          const path = ch.getTargetPath(), node = ch.getTargetNode()?.getName() ?? "";
          // Rotations carry the motion. Bone translations would force this
          // clip's body proportions onto every avatar; only the root keeps
          // its up-and-down bob (horizontal motion is already extracted).
          if (path === "rotation" || (path === "translation" && node === "Bip01")) continue;
          ch.getSampler().dispose();
          ch.dispose();
        }
      }
      // A clip file needs only its skeleton nodes, not the reference mesh.
      for (const n of doc.getRoot().listNodes()) n.setMesh(null).setSkin(null);
      await doc.transform(prune());
      await io.write(join(OUT, "clips", `${name}.glb`), doc);
      manifest.clips[sex][kind].push(name);
      console.log(`${name}${manifest.walkSpeed[name] ? ` (${manifest.walkSpeed[name]} m/s)` : ""}`);
    }
  }
}

if (CLIPS_ONLY) manifest.avatars = JSON.parse(readFileSync(join(OUT, "people.json"), "utf8")).avatars;
writeFileSync(join(OUT, "people.json"), JSON.stringify(manifest, null, 1) + "\n");
console.log(`${manifest.avatars.length} avatars, ${Object.values(manifest.clips).flatMap((c) => [...c.walk, ...c.idle]).length} clips -> ${OUT}`);
