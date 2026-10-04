# 20: Human NPCs that look like people

Date: 2026-10-04. Goal: replace the box pedestrians (`traffic.ts` `walker()`,
two step poses swapped per frame in `trafficnet.ts`, and `avatar.ts` for the
player on foot and remote players) with realistic, animated people, using
existing permissively licensed assets, and render a hundred or more of them
cheaply in three.js r186 `WebGPURenderer`.

Marks: **[v]** read from the source file itself or tested here; **[s]** a
search-engine extract of the official page (the proxy blocked the page);
**[m]** from memory, unverified. Blocked this session: helpx.adobe.com,
quaternius.com and quaternius.itch.io, opengameart.org, mocap.cs.cmu.edu,
static.makehumancommunity.org, app.cinevva.com.

Scratch work (not in the repo): a Rocketbox partial clone, the converted
GLBs, test pages and screenshots are under
`/tmp/claude-0/-home-user-Real-world/5d569546-9ace-5b91-b2ce-7f6b31ee93cf/scratchpad/humans/`.

## Recommendation

1. **Characters: Microsoft Rocketbox** (MIT). It's the only free, realistic,
   rigged and permissively licensed set big enough for a street: 115 people in
   everyday clothes plus uniforms. Every character uses the same `Bip01` biped
   skeleton, and the set comes with its own animations.
2. **Animation: Rocketbox's own 417 clips**, from the same repo under the same
   licence. They include walks at several speeds, start, stop, turns, waiting
   idles, phone and umbrella idles. Because the skeleton is shared, no
   retargeting is needed.
3. **Rendering: a baked bone-animation texture plus instanced skinning in a
   TSL `positionNode`**, with one draw per character model and LOD level. I
   built a prototype that works in r186 `WebGPURenderer`; details in §3.
4. **Fill the Lagos gap with MakeHuman/MPFB2** (CC0 output). Rocketbox has few
   Black civilians and no West African clothing (§1.2).

Avoid: Mixamo (the terms forbid redistributing raw files), SMPL/SMPL-X/AMASS
(non-commercial), Bandai Namco motion data (CC BY-NC-ND), Ready Player Me
(shut down), Renderpeople/Reallusion free samples (their EULAs forbid
redistribution), and any MetaHuman parts.

## 1. Character sets

### 1.1 Microsoft Rocketbox: first choice

- **Licence [v]:** `LICENSE.md` in github.com/microsoft/Microsoft-Rocketbox is
  the plain MIT text, "Copyright (c) 2020 Microsoft". The README says "12/2020:
  Updated license to MIT" and "The library of avatars is now released under MIT
  License." The licence covers the whole repo: avatars, textures and
  `Assets/Animations`. The old "research and academic use" wording only appears
  in the 2020 blog link. Credit: the MIT notice plus the citation
  (Gonzalez-Franco et al. 2020, Frontiers in VR, doi 10.3389/frvir.2020.561558).
- **Status [v]:** the last commit is 2022-10-02. The GitHub page shows "archived
  by the owner on Oct 2, 2026, read-only". Archiving doesn't affect the
  licence, but it does mean we should keep our converted copies in the repo,
  not fetch them at build time.
- **Contents [v]** (from the git tree): `Assets/Avatars/Adults` has 40 people
  (17 women, 2 "party" women, 21 men), `Children` has 4, and `Professions` has
  71 (business, construction, delivery, fire, medical, military, pilot,
  police, security, sports, chef, gardener, wood). That makes 115. Each avatar
  has `Export/<name>.fbx` (body only) and `<name>_facial.fbx` (blendshapes),
  plus 7 to 8 TGA textures at 2048² (body, head and hair-opacity colour, normal
  and specular). The repo also has 3ds Max sources and 25 animals (cows, goats,
  dogs, chickens; useful later for Lagos).
- **Polycount [v]:** measured from the FBX geometry. Male_Adult_01 has 7,440
  triangles and 4,025 vertices; Female_Adult_01 has 8,732 triangles. There are
  81 bones, including fingers and about 30 face bones. The README's "hipoly,
  midpoly, lowpoly, ultralowpoly" LODs (e.g. `m002_lowpoly_33_bones`) are only
  in the `.max` sources; the exported FBX holds only the hipoly mesh. We make
  our own LODs with meshoptimizer: `gltf-transform simplify --ratio 0.25` took
  it to 1,931 triangles, and it still read fine at 10 m (screenshot test).
- **Sizes [v]:** the raw FBX is 0.52 MB. Raw textures are about 90 MB per
  avatar (TGA). After conversion: FBX2glTF GLB 0.34 MB (mesh only); with
  textures (body 1024² JPEG, head and hair 512²) 0.64 MB; with meshopt
  compression 0.41 MB. So 30 avatars come to about 12 to 15 MB, or less with
  KTX2. The walk clip is 0.10 MB as a GLB, `m_idle_neutral_01` 0.6 MB (11.7 s)
  and `m_idle_waiting_01` 2.3 MB (47 s, which should be trimmed).
- **Animations [v]:** 471 FBX files (the README says 417) in three folders:
  `all_animations_max_motextr_static` (326, in place: idles, talk, phone,
  umbrella, newspaper, bag, trolley, sitting, waving),
  `..._motextr_xy` (71: `walk_neutral_01..04`, `walk_slow`, `walk_fast`,
  `walk_stroll`, `walk_start`, `walk_stop`, `run_*`, `waiting_walk`, male and
  female versions) and `..._motextr_xyz` (74: `turn_left/right_60/90/120/180`,
  `turn_*_to_walk`, sitting down). Measured from root motion:
  `m_walk_neutral_01` covers 1.187 m per 1.167 s cycle (1.02 m/s);
  `f_walk_neutral_01` covers 1.412 m (1.21 m/s). Both are realistic walking
  speeds, and knowing them lets us match playback rate to speed (§4).
- **Tested here [v]:** FBX2glTF 0.9.7 (the `fbx2gltf` npm package, which ships
  a Linux binary) converts both avatars and clips. FBX2glTF doesn't find the
  textures because of the FBX paths, so a 20-line gltf-transform script
  attaches resized JPEGs. Male_Adult_01 renders correctly in r186
  `WebGPURenderer` (WebGL2 backend, SwiftShader) with an `AnimationMixer`
  playing `m_walk_neutral_01`, and the male walk plays on Female_Adult_01.
  One trap: the clips carry a translation track for all 81 bones, which forces
  the source skeleton's proportions onto the target (the woman gets broader
  shoulders and longer limbs). Keep only rotations plus the `Bip01` root
  translation. Zero the root's forward axis to get an in-place cycle.
  `MotionExtractionHelper` tracks can be dropped. Screenshots: `shot.png`,
  `ret.png` and `crowd.png` in the scratch folder.
- **Look:** this is 2010 to 2015 game-quality realism (the "Complete Characters
  HD" line): photo-sourced textures and believable faces at street distance,
  but dated close up. That's fine for pedestrians seen from a car.

### 1.2 Fit for Finglas and Yaba (judged from the 115 preview PNGs)

- **Finglas:** this is well covered. There are many white men and women in
  jeans, jackets, hoodies and shorts, plus business, medical, construction
  (hi-vis is missing; it could be added by recolouring a jacket texture),
  police (not Garda uniforms; avoid them or retexture) and children.
  `f_umbrella_*` idles suit Dublin.
- **Yaba: there's a real gap.** Clearly Black civilians in everyday clothes
  are Male_Adult_04, Male_Adult_12, Male_Adult_18, Male_Child_02,
  Sports_Male_03, Business_Male_05 and Construction_Male_03, with
  Female_Party_02 and Business_Female_01 as possibles. That's roughly 7 men
  and 2 women. There's no West African clothing (ankara, agbada, kaftan, gele),
  but there are Middle Eastern and South Asian outfits (hijab, burqa, thobe,
  keffiyeh), which are not what Yaba looks like. Options, best first:
  1. Generate 10 to 20 Lagos people in **MPFB2** (Blender) with African
     phenotype settings, CC0 MakeHuman clothes and our own ankara textures
     (made from CC0 photos or procedurally), export them with the
     "game engine" rig, and retarget the Rocketbox clips in Blender once,
     offline.
  2. Retexture Rocketbox clothes with print patterns. This is cheap and works
     for shirts and dresses. Changing skin tone on white faces looks wrong;
     don't do it.
  3. Accept the repetition: about 7 Black models across 100 pedestrians.
     Players will notice the clones.

### 1.3 MakeHuman / MPFB2 [v]

- MakeHuman `LICENSE.md` (makehumancommunity/makehuman): the code is AGPL; the
  "bundled assets (base mesh and proxies, targets, textures, clothes, poses)
  have been released under CC0 1.0"; section D says the output is assets plus
  your own input, so "there is no limitation". The MPFB2 repo has
  `LICENSE.ASSETS.md` = CC0 1.0 and `LICENSE.CODE.md` = GPLv3, and needs
  Blender 4.2 or later.
- Caveat [m]: community asset-pack clothes and hair have their own licences
  (mostly CC0, some CC-BY). Check each one we use; I couldn't read the pack
  page (blocked).
- Pros: full control over body shape, age and phenotype; CC0; it exports
  glTF from Blender. Cons: the default skin and clothes look plasticky next to
  Rocketbox, it's an author-time Blender workflow, and its rig isn't `Bip01`,
  so the clips need one offline retarget per rig (Blender, or three.js
  `SkeletonUtils.retargetClip`, as in the `webgpu_animation_retargeting`
  example). Effort: about 2 to 3 days for a first batch of 10 people.

### 1.4 Others checked

| Source | Licence | Realistic? | Verdict |
|---|---|---|---|
| Quaternius Universal Animation Library (120+ clips, 1 and 2) | CC0 [s] (Pro tiers are paid; their licence is unclear [m]) | Mannequin rig | A good backup animation source if we leave Rocketbox's skeleton. Its walks are game-styled. |
| Quaternius Universal Base Characters (6 bodies, about 13k tris, 20 hair styles) | CC0 [s] | Stylised | Not realistic enough; fine for a far LOD or for children. |
| Kenney animated characters | CC0 [s] | Blocky | No; it's what we're moving away from. |
| 100 Avatars (Polygonal Mind) | CC0 [s] | Stylised VRM | No. |
| Poly Pizza / Sketchfab CC-BY | Per model | Mixed | Only one model at a time with the licence checked on the page. No consistent rig, so animations don't transfer. Not worth it for crowds. |
| Mixamo | Adobe terms [s]: free for commercial use, but you may not "engage in any type of free distribution of character or animation raw files" | Good | **Avoid.** Our GLBs sit unpacked in `public/` and in a git repo, which is raw-file distribution. It also breaks our "no 'no redistribution'" rule. |
| Ready Player Me | [s] Netflix bought it on 2025-12-19; the public API and avatar creator went offline on 2026-01-31 | Stylised | Dead. Don't use it. |
| SMPL / SMPL-X / AMASS | Non-commercial research licence [m] | Bodies only | **Avoid.** |
| CMU mocap | [m] "free for use in research projects... may include in commercially-sold products, but may not resell this data directly" | Raw BVH | Usable in principle, but raw data needs cleanup and retargeting. We don't need it: Rocketbox has the walks. |
| Bandai Namco Research Motiondataset | CC BY-NC-ND 4.0 [s] | Mocap | **Avoid.** |
| Renderpeople / Reallusion free samples | Their EULAs [m] | Very realistic scans | **Avoid**: they forbid redistribution. |
| Epic MetaHuman | Epic EULA, Unreal-only | | Banned by our rule. |

## 2. What r186 gives us for many animated people [v]

Read from `node_modules/three` 0.186.1 and the r186 examples:

- `SkinnedMesh` works in `WebGPURenderer` (`nodes/accessors/Skinning.js`). It
  uses one skeleton per mesh, a uniform buffer for small skeletons and a bone
  texture for big ones. There's **no built-in instanced skinning**; `BatchedMesh`
  has no skinning either.
- `webgpu_skinning_instancing`: all instances share one pose. Not useful.
- `webgpu_skinning_instancing_individual` (new in r186): per-instance poses via
  a **compute shader** that writes skinned vertices into a storage buffer.
  `mixer.setTime()` runs on the CPU for each instance every frame. It's
  WebGPU-first; it relies on compute and `attributeArray`, which the WebGL2
  fallback (our headless test path) handles poorly. It's also 2× vertex
  storage per instance. A good reference, but not what we should copy.
- `InstancedMesh2` (agargaro/instanced-mesh, MIT, v0.3.16, last commit
  2026-10-01, `three >=0.186`): per-instance skinning, LOD, BVH culling,
  3,000 skinned instances in its demo. It's **WebGLRenderer only**: GLSL
  `ShaderChunk` and `onBeforeCompile` patching, with no node-material path. It
  won't work with our renderer, but the technique is the same (bone texture
  indexed by `instanceIndex * bonesPerInstance`).
- Industry technique: baked animation textures. These come from GPU Gems 3
  ch. 2 "Animated Crowd Rendering" (NVIDIA) and Unity's "Animation Instancing
  for SkinnedMeshRenderer". You store bone matrices per frame in a texture, and
  the vertex shader picks the frame for each instance. You get one draw call per
  mesh with no CPU animation cost. The alternative, vertex animation textures
  (VAT, storing every vertex per frame), costs vertices × frames of memory, so
  it suits 500-vertex soldiers, not 4,000-vertex people.

### Prototype that works (tested here)

`crowd.html` in the scratch folder, r186 `WebGPURenderer({ forceWebGL: true })`:

- At load time, run the mixer once per frame at 30 fps and copy
  `skeleton.boneMatrices` into a `DataTexture` (RGBA32F; width = bones × 4,
  height = frames).
- Draw a plain `THREE.Mesh` with `mesh.count = N` (instanced draw), plus
  per-instance `InstancedBufferAttribute`s: four `vec4` columns for the
  instance matrix, a time offset and a playback rate.
- A `material.positionNode = Fn(() => …)()` that computes the frame from a
  `uniform` time × rate + offset, `tex.load(ivec2(bone*4+k, frame))` for the 4
  bone matrices, blends by `skinIndex`/`skinWeight`, then computes
  `inst * meshWorld * bindInverse * skin * bind * position` and assigns
  `normalLocal` the same way.
- Result: 60 walkers, each at its own phase and speed, in 3 draw calls (body,
  head and hair materials), rendered correctly (`crowd.png`).
- Gotchas: in `NodeMaterial.setupPosition`, `positionNode` replaces
  `positionLocal` after the instancing step. So use a plain `Mesh` with
  `count`, not an `InstancedMesh`, and apply the instance matrix yourself.
  Multiply by the source SkinnedMesh's `matrixWorld`, because the FBX root has
  a rotation; without it the people lie on their backs. Not yet checked:
  shadows (`castShadowPositionNode`, or the shadow pass reusing `positionNode`).
  Check before relying on them, or use the existing blob-shadow decal from
  `avatar.ts` for pedestrians.

Budget: 81 bones × 4 texels × (about 1,500 frames for walk, slow walk, fast
walk, start, stop, 2 turns and 4 idles) × 16 B ≈ 7.8 MB of GPU memory per
skeleton family. Cut it by about 3× by dropping finger and face bones (merge
their weights into the hand and head; that leaves about 25 bones) and storing
half floats. The baked matrices include each avatar's `boneInverse`, so they
are per avatar. To share one texture across all Rocketbox people, bake bone
*world* matrices instead and multiply by a small per-avatar `boneInverse`
array in the shader. Bake at load time in the browser from the clips, which
are small, rather than shipping the texture.

## 3. Rendering plan

| Distance | What | Triangles | Animation |
|---|---|---|---|
| < 20 m | Hipoly Rocketbox mesh, 3 materials (body, head, alpha-tested hair) | 7 to 9k | Baked texture, two-clip crossfade in the shader |
| 20 to 60 m | meshopt simplify 25%, hair merged into body atlas | about 2k | Same texture, no crossfade |
| 60 to 150 m | simplify about 8% | about 600 | Same texture, every other frame |
| > 150 m | Not drawn (impostors aren't worth it at our density) | 0 | none |

110 pedestrians (the desktop budget in `main.ts`) is about 0.3 to 0.5 M
triangles, with draws = avatar types in view × LODs × materials, so about 40
to 80. Sampler use per material: bake texture + colour + normal = 3, well
under the 16 limit (`textures.ts` comment). Textures: KTX2 (UASTC/ETC1S via
`gltf-transform etc1s`, which our `KTX2Loader` path would need) or plain
WebP/JPEG at 1024/512 to start.

## 4. Animation tied to the planned social-force walkers

How the industry avoids foot sliding without full motion matching (Ubisoft's
Clavet 2016) or UE5's distance matching and stride warping:

- **Speed-matched playback.** Each locomotion clip has a measured speed
  (stride per cycle ÷ cycle time from root motion, e.g. 1.02 m/s for
  `m_walk_neutral_01`). Set `rate = |v| / v_clip`, clamped to about
  0.75 to 1.3. Outside that range, switch clips: `walk_slow` below,
  `walk_fast` above, `run_*` for people dashing across. Within the range,
  crossfade neighbouring clips by speed (a 1D blend space), keeping a shared
  normalised phase so the feet stay in step. With the baked texture that's two
  texture fetches per bone and a lerp, done per instance in the shader.
- **Heading.** The social-force velocity is jittery. Low-pass it (a time
  constant of about 0.3 s) and turn the body yaw toward it at a maximum of
  about 180°/s. For turns above about 60° at low speed, play
  `turn_left/right_60/90/120/180` (or `*_to_walk`) once, then resume. Never let
  a walker slide sideways: if lateral velocity is more than half the forward
  velocity, slow down and turn first. This is the same rule as research 17
  for cars.
- **Start and stop.** When the desired speed drops below about 0.15 m/s (a red
  man, a gap check at the kerb, the player's car in the way), play
  `walk_stop`, then an idle. Going: `walk_start` then the walk. Give these
  transitions 0.25 to 0.4 s crossfades.
- **Waiting variety.** Pick from `idle_neutral_01..09`, `idle_waiting_01/02`,
  `idle_look_around_01..03`, `cell_phone_textmessage`, `umbrella_idle`
  (Finglas in rain, which ties into live weather, roadmap item 8) and
  `headphones_idle`. Start each at a random phase and swap every 5 to 15 s so
  a crowd at a crossing doesn't breathe in sync.
- **Walking speeds.** Helbing & Molnár 1995 and Weidmann 1993 give a mean
  desired speed of 1.34 m/s with an SD of about 0.26 [m]. The current spawn,
  `1.1 + rand * 0.45` (`trafficnet.ts`), is close; draw from a normal
  distribution later.
- **Stride phase and frame rate (fixed in 461eb0a):** the step phase used to
  advance by a fixed `0.016` per frame, so legs ran slow at low fps. It now
  advances by `dt`; `tests/pedestrians.test.mts` checks the phase per metre
  walked at 30, 60 and 120 fps. Animation clips must keep the same rule:
  playback rate from distance walked, not frames.
- **Knocked down:** the current box tips over. Rocketbox has no fall or ragdoll
  clips. Use `crouch_*` or a still frame of a lying pose, or just keep the
  rotate-and-lie trick for now.

## 5. Integration plan for our code

| Step | Files | Effort |
|---|---|---|
| A. Asset fetch and bake script: sparse git checkout of the chosen Rocketbox folders (avatars plus about 25 clips), FBX2glTF, strip non-root translations and `MotionExtractionHelper`, attach and resize textures, meshopt LODs, write `public/models/humans/<name>.glb` and `clips.glb` | new `tools/assets/fetch_humans.py` (or `.mjs`, since it needs `fbx2gltf` and `@gltf-transform/*` from npm), `public/models/CREDITS.md` (MIT notice and citation) | 1 day |
| B. Crowd renderer: load avatars and clips, bake the bone texture, build the instanced-skinned node material and per-avatar LOD meshes, expose `setPed(i, avatar, x, z, yaw, clipA, phaseA, clipB, phaseB, blend)` and write the per-instance attributes once per frame | new `game/src/client/crowd.ts` | 2 to 3 days |
| C. Hook into traffic: replace `wMeshes` and `walkerTemplate` with the crowd API; add `avatar`, `clip`, `phase` and `yawSmoothed` to `Ped`; add speed-to-clip and speed-to-rate mapping, stop/start and idles while `waiting` | `trafficnet.ts` (constructor and the render loop at about lines 173 and 880 to 897); leave the legacy `traffic.ts` `Traffic` on boxes, or delete it if it's dead | 1 day |
| D. Player on foot and remote players: one normal `SkinnedMesh` with an `AnimationMixer` (few of them, so no instancing needed) | `avatar.ts` (keep the class API: `root`, the walk update), `main.ts` lines 292 and 413 | 0.5 day |
| E. Per-place population: an avatar weight table per place (Finglas or Yaba), with Rocketbox plus MPFB people | `crowd.ts`, place JSON or the `CITY` config | 0.5 day, plus about 2 to 3 days for the MPFB Lagos batch |
| F. Tests: a headless Playwright screenshot through the WebGL2 path (works today), and a native WebGPU check on the Mac | | 0.5 day |

Total: about 6 days for Rocketbox in Finglas, plus about 3 days for Lagos
people.

Decisions for the owner before starting (these box us in):

1. **Rocketbox's `Bip01` skeleton becomes the house rig.** Every future human
   (MPFB, others) gets retargeted to it.
2. **Repo size:** 30 avatars are about 12 to 15 MB of GLBs committed under
   `public/models/humans/`. Otherwise, fetch them with the script and
   gitignore them, like the textures.
3. **Uniforms:** use the police, military and fire models (wrong country) or
   leave them out.

## Sources

- github.com/microsoft/Microsoft-Rocketbox: `LICENSE.md`, `README.md`, git
  tree at 0943055 (2022-10-02) [v]
- github.com/makehumancommunity/makehuman `LICENSE.md`; makehumancommunity/mpfb2
  `LICENSE.ASSETS.md` and `LICENSE.CODE.md` [v]
- github.com/agargaro/instanced-mesh: `LICENSE`, `README.md`,
  `src/shaders/chunks/instanced_skinning_pars_vertex.glsl` [v]
- three.js r186 `examples/webgpu_skinning_instancing_individual.html`, `src/nodes/accessors/Skinning.js`,
  `src/materials/nodes/NodeMaterial.js` [v]
- Adobe Mixamo FAQ via community.adobe.com threads [s]; Ready Player Me shutdown via genies.com and avatarsdk.com [s];
  Quaternius UAL and UBC via search extracts of quaternius.com, itch.io and opengameart [s];
  Bandai Namco dataset via 80.lv and arXiv 2306.08861 [s]
- GPU Gems 3 ch. 2 "Animated Crowd Rendering"; Unity blog "Animation Instancing for SkinnedMeshRenderer"; Helbing & Molnár 1995 [m]
