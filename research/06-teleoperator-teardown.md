# 06 — Teleoperator (teleoperator.mindblown.ai) teardown: why it looks real

Research date: 2026-10-04. Read-only analysis of the public client bundle. **No code was copied into this repo.** The site has no licence, so we take techniques only, not code or assets.

> **Method.** I fetched `https://teleoperator.mindblown.ai/` with a generic UA. The page is a shell that loads the game in an iframe (`/?mb=game`). The game page loads `boot.js` (13 KB, classic script) and `app.js` (2,675,455 bytes, ES module, minified, **no source map**: `app.js.map` returns 404, and `src/*.js` returns 404). Workers are `workers/{img,sky,car}.js`. All downloads are in `/tmp/teleop/` (≈49 MB, not in the repo). I prettified `app.js` with `js-beautify@1.15.1 -s 2` into `/tmp/teleop/app.pretty.js` (96,012 lines). **Line refs `L#####` below point into that prettified file.** `app.js:####` means the minified file's line. The JS identifiers are minified. However, **the WGSL shader strings keep the authors' comments** (≈1,350 comment lines, prefixed "sf-drive (round NN)"). That is why the intent behind most techniques can be stated with confidence. Anything inferred rather than read is marked *[inferred]*.
>
> **Correction to `05-driving-sim-graphics-and-world.md` §1.1.** That quick pass was directionally right, but some details need fixing. (a) **AgX is not used.** The tone-mapper maps AgX/Cineon to ACES, and the game sets ACES Filmic (`toneMapping = 4`). (b) The "cascades L0–L2" are the **FFT ocean's** wave cascades. They are not sun-shadow cascades. (c) Generic buildings are textured from **whole-facade image atlases that look AI-generated**, not only procedurally. (d) Ray-marched volumetric clouds and the Hillaire atmosphere **exist in the engine but are not the default sky.** The default is a baked analytic HDR sky. See §3.

---

## 1. Summary: what makes it look real (ranked by visual impact)

1. **Whole-building facade "photographs" with geometry and shading built around them.** Every one of the 54,129 OSM buildings gets a cell from a style atlas: `vic`, `edw`, `mix`, `brk`, `apt`, `shop`, plus a 4096² `office` atlas. Each cell is a full, orthographic, photo-real front of a San Francisco building type (bays, cornice, garage, stairs). The images look **AI-generated**; the code itself says *"the generated photos are clean, SF's fronts are not"* (L43135, `gen_textures.py`). Per-cell JSON (`assets/tex/tex.json`) lists the window rectangles, bay windows and cornice heights. The builder **extrudes real 3D canted bay windows and cornices** from that metadata (`app.js:10746`, `n.cant`, `t.cornice`). The shader then adds window reveals with parallax depth, **interior-mapped rooms** behind the glass, rain streaks under the sills, soot under the cornice, street grime, and per-room lights at night by building type (L42730–43230). This one layer accounts for most of the "real city" impression.
2. **Offline-baked sky visibility (large-scale AO) plus a carefully tuned atmosphere and fog.** `assets/real/sky.bin` (22.8 MB raw / 10.3 MB gz) holds three things: per-wall and per-roof sky visibility; a **2 m street-level visibility field over the whole city** (4220×3442 cells); and lightmaps for landmarks. All are ray-cast offline (64/96/128 rays, 120 m reach; `tools/real/skyvis.mjs`, L27505). This darkens street canyons and alleys the way real cities look, and GTAO adds contact detail on top. The fog is exp² plus a linear "veil". Its colour is **warm toward the sun and cool away from it**, it **thins with height**, and the bay air is clearer (L26467–26482). Distant skylines read through blue haze, as they do in photos.
3. **Physically based shading with temporal AA and a deliberate tone/grade pipeline.** It uses GGX with height-correlated Smith, a split-sum environment with multi-scatter compensation, and specular AA (Kaplanyan/Toksvig). Every procedural stripe, window grid and brick is **box-filtered to the pixel footprint** so it never shimmers (L42258–42269). TAA uses Catmull-Rom history, variance clipping, a reactive mask and per-instance motion vectors for traffic and spinning wheels, followed by a light CAS-style sharpen. Tone mapping is ACES Filmic, then a grade with vibrance, an S-curve, a film shoulder over 0.8, split-toning and warmth. The grade was **tuned against reference photos and against frames from a commercial racing game** (repeated comments: "the photos", "NFS's frames", "the 40 chase frames against the photos").
4. **Road surface richness, plus wetness with screen-space reflections.** One road shader does a lot. It takes a 2K photo asphalt sampled in world space at two scales and rotations, blended by noise. It adds procedural repaving runs, utility cuts, trench strips, crack-sealant "tar snakes" and oil down the lane centres. Lane paint is anti-aliased, and SF-specific markings appear: red BUS ONLY lanes, green bike lanes, sharrows, and cable-car rails with the slot. A decal atlas supplies manholes, grates, plates and litter. Puddles and a damp film feed SSR, and **lamp reflections stretch into long vertical streaks on wet asphalt** (L42356–42665, L26952–27004).
5. **A dense, living street.** `props.bin` places 211,622 objects (lamps, trees, hydrants, stop signs, signals, parked cars, palms). Hero trees are baked meshes with cards and branch tubes per species, with three-level wind and back-lit translucency. Far trees use 3-view impostors. Pedestrians are animated in the vertex shader. Traffic includes buses, cable cars and streetcars. At night, clustered street lamps have a batwing distribution and house-side shields. Each lamp gets a fake "floor bounce" light, and a hemisphere "city glow" fades with distance and height.

**Not used:** photogrammetry, Google Photorealistic 3D Tiles, Cesium, Mapbox, Gaussian splats, NeRF, Draco, meshopt or KTX2/Basis. Every `https://` URL in `app.js` was checked: none points to a map or tile service (one is a JCGT paper citation). The world is a **self-hosted, pre-baked, whole-city download**.

---

## 2. Data sources

| Layer | File (gz → raw) | What it holds | Origin (evidence) |
|---|---|---|---|
| Roads | `assets/real/roads.bin` 7.0 → 10.5 MB | 7,164 edges and 4,147 junctions. Polylines, widths, curbs (0.15 m), 975 street names, 25 districts, flags (`oneway`, `cable`, `tram`, `elevated`, `noPark`…), pre-triangulated walk and curb meshes per 256 m chunk | **OSM**: `classes` are OSM `highway=*` values (motorway… living_street, busway). Lane and transit codes appear in the shader (`transitCode`, `bikeCode`) |
| Buildings | `buildings.bin` 3.1 → 5.3 MB | 54,129 footprints (quantised Int16), heights, roof type (flat, pyramidal, hipped, gabled, dome), style, material, per-building seed, `front` flags per edge (street-facing), 2,084 names | **OSM** (names match OSM; `assets/osm/downtown.json` carries OSM way ids, e.g. Transamerica `24222973`, with `building:part`, `roof:shape`, `h`) |
| Downtown detail | `assets/osm/downtown.json` 2.3 MB | Raw OSM building parts for the towers | OSM |
| Terrain | `terrain.bin` 4.0 → 10.9 MB | 4 m height grid, 2111×1722 (≈8.4 × 6.9 km of northern SF), Uint16 × 0.05 − 60 m, per-cell land cover, sea bitmask | DEM source **unknown** (probably USGS 3DEP 1 m resampled *[inferred]*) |
| Coast | `coast.bin` 17 KB | Sea-wall polylines "1.5 m seaward of the OSM coastline", quay deck heights | OSM coastline |
| Ground / green | `ground.bin`, `green.bin` | Paved/wild polygons with materials (concrete, brick, granite, decomposed granite, asphalt); land cover (urban, lawn, wood, sand, water; park bit) | OSM landuse/leisure *[inferred]* |
| Props | `props.bin` 3.5 → 4.9 MB | 211,622 instances: lamp, tree, hydrant, stop, signal, car, palm, ptree | Probably OSM plus city open data (e.g. DataSF street-tree list) *[inferred, not confirmed]* |
| Baked lighting | `sky.bin` 10.3 → 22.8 MB | Street-level sky-visibility field (2 m), per-wall and per-roof visibility, 280 landmark lightmap blocks (Golden Gate deck/towers, piers, Bay Lights…) | **Their own offline bake** |
| Trees | `assets/veg/trees.bin` 0.6 MB, `yards.bin` 1.2 MB | Six hero species (plane, ficus, elm, cypress, eucalyptus, pine), each 1.6–3.1k leaf cards and 480–900 branch tubes; yard planting | Their own procedural tree generator *[inferred]* |
| Landmarks | `assets/tex/lm/*`, `assets/lm/revolution.bin`, plus code | Hand-built procedural models (e.g. Alcatraz is built from a superellipse with heights, L35545). Facade and tile atlases for Pier 39, Fort Mason, the waterfront, Lombard and the Golden Gate | Hand work and generated textures (`tools/gen_lm_*.py`) |

**Streaming:** there is no tile streaming from a service. `boot.js` prefetches all of `assets/real/*.bin.gz` with `fetch(..., {priority:'high'})` before the module graph loads. Geometry is built client-side into 256 m chunks and culled. The tiers shrink the "city radius" and textures (`_lo` variants, 512 px texture cap on mobile). Total first-load payload is ≈ 30–40 MB gz of data plus ≈ 20+ MB of textures *[estimate from the files sampled]*.

---

## 3. Rendering pipeline

**Engine.** A **custom WebGPU renderer**, class `hx` (L28581), flagged `isMindblownRenderer`. It mimics the `THREE.WebGLRenderer` API so a plain three.js scene graph renders through it. three.js **r186** is bundled (`"186"`, L9661) for the scene graph, math and loaders. WebGL2 is a fallback ("MindblownRenderer: WebGPU unavailable, drawing with THREE.WebGLRenderer instead"). All shading is **hand-written WGSL**: 97 `@vertex`/`@fragment`/`@compute` entry points. TSL/NodeMaterial is not used.

Device setup (`boot.js`, L28788): it requests the adapter in `boot.js` **before** `app.js` loads, saving about 0.7 s. It asks for `timestamp-query` and `shader-f16`, raises `maxSampledTexturesPerShaderStage` to 32 for the "full material" path, and retries 6 configurations. `uncapturederror` drops the device to a "compact material path" for 7 days.

Frame structure, in order, read from the pipeline labels and bind groups (L26328–26410, L30000–33600):

1. **Depth pre-pass** (`depthPrepass: true`). The main pass then shades each pixel once. Uniform data uses dynamic-offset object buffers.
2. **Shadow passes**:
   - a *cached* view-wide sun map of static casters (`smStatic`, about 7 cm/texel);
   - a *near cascade* (`smDyn`, "every caster within ~24 m of the view's foreground… ~1.2 cm a texel");
   - a *movers* map (`smMove`, traffic, redrawn every frame at the cached projection);
   - a spot-light atlas (static and dynamic) and point-light cube shadows (3×2 atlas);
   - **translucent shadow maps** for thin glass (L26700).
3. **Clustered light assignment** (compute, `lightPrep`, cluster buffer `CLU`).
4. **GTAO** (compute, half resolution, 2 slices × 6 steps, 4×4 interleave and TAA, then a depth-aware 4×4 blur; L26137–26250). An optional one-bounce "GI" from last frame's radiance is **off by default** (`m.gi = ?gi`).
5. **Main forward pass**. The uber-shader branches on uniform flags per material. It writes the displayed colour plus a linear HDR copy with view depth in alpha, which next frame's SSR and refraction read. Per-material **WGSL "hooks"** (road, facade, roof, ground, foliage, car paint, pedestrians, signs…) set albedo, roughness, metalness, clear coat, emission, transmission and AO overrides.
6. **SSR** inside the main pass, against **last frame's** linear image: an exponential march (28 steps), binary refinement, per-pixel and per-frame dither that TAA averages, max 90 m (160 m on Ultra, off on Performance). Wet-road streak kernels follow it (L26891–27004). **Planar reflection** (mipped) serves the floor and water where enabled.
7. **Sky/ocean** (see Lighting). **Particles/VFX** (rain 4,200 drops desktop / 1,600 mobile, smoke, sparks, fireworks; compute-simulated, motion-blurred quads, L25211–25470). **Volumetric smoke/fire** at half resolution, heat haze.
8. **Velocity pass** (moving objects; instanced traffic gets last frame's instance matrices; wheels spin in the vertex shader).
9. **TAA resolve → bloom/glare → flare → final** (grade, radial blur, vignette, sharpen) — see §4.

**Dynamic resolution and pacing** (L94850–94870, L94976):
- Starting pixel ratio: `min(DPR, 2.0)` on Ultra, 1.75 on High, 1.0 on Performance, 1.25 or 0.42×DPR on Mobile, 0.6 or 0.2×DPR on Battery saver. The *running* ratio is capped at 1.25 on High and 0.85 on Performance, then moves ×0.8/×0.9 down or ×1.08 up from frame time and **GPU timestamp** time (target 1/42 s, or 1.2× the cap).
- FPS cap of 30/60/uncapped (mobile defaults to 30).
- A first-run benchmark (`ui/autogfx.js`) sets the "auto" level and steps down after sustained low fps.
- **Crash recovery**: a localStorage flag survives an iOS tab kill, and the next load drops one tier.

---

## 4. Post-processing

| Pass | Detail (location) |
|---|---|
| TAA | Catmull-Rom history from 5 bilinear taps (Jimenez), neighbourhood clip toward the box centre (Playdead), blend 0.02–0.25 rising with motion, reactive mask for particles, glass and sprites, per-object velocity (L28467–28526). Mobile uses **FXAA** and no TAA. |
| Sharpen | Contrast-adaptive sharpen after TAA: 0.12/0.13/0.14 by tier, 0.16 on the mobile FXAA frame (L28452–28460, `MB_SHARPEN`). |
| Bloom | Compute mip chain: soft-threshold first level, **13-tap Jimenez (CoD:AW) downsample**, tent or 16-tap disc upsample. 6 levels (4 on mobile). Base strength 0.075, raised by presets (`bloom: .2`, dusk `.32`) (L28189–28235). |
| Lens flare / sun glare | Halo, anamorphic streak, ghosts and ring, scaled by how much of the sun is visible (depth and brightness taps); a veil when driving into the sun (L28368–28397). Strength per preset (`flare`). |
| Tone mapping | **ACES Filmic** (`m.toneMapping = 4`; WGSL `acesThree`, same constants as three.js). Khronos Neutral is available; AgX/Cineon fall back to ACES (L26418–26445). |
| Grade | Saturation, **vibrance** (dull colours gain more), linear-pivot contrast plus a filmic smoothstep S, gamma "mids" lift, **split-toning** (shadow and highlight tints), warmth, lift, **film shoulder above 0.8** (L28343–28430). Values per time of day in `ka` (L94152+). |
| Motion blur | Per-pixel camera blur exists (edges only), but the game sets `motionBlur = 0`. It uses **radial blur toward the frame edges** from 80 km/h (`0.066·k^1.6`, plus nitro). The centre and the car stay sharp. |
| Vignette | 0.28. |
| Not present | DOF, film grain, chromatic aberration, colour-LUT textures (the grade is analytic), auto-exposure (exposure is fixed per preset: noon 0.99, golden 1.15, fog 1.1, blue hour 2.6). |

---

## 5. Lighting

**Sky (default).** A worker (`workers/sky.js`) bakes an **equirect HDR sky** (1024 desktop, 512 mobile, "4k sky" on Ultra) in half-float. It is an analytic zenith/horizon gradient with sun glow lobes and a disc, twilight colours, horizon fog, faint cirrus streaks, and **fbm cumulus with self-shadowing and a silver lining**. It serves as the background and as the **environment**, prefiltered to Phong-lobe "priors" (mirror, 3000, 600, 120, 24, 5, cosine).
- Five presets: "Sunny afternoon" (sun 23° el / 240° az), "Golden hour" (11°), "Karl the Fog", rain, "Blue hour" (−4°). The `T` key cycles them.
- A large "Haze" cylinder with a vertical alpha ramp blends the horizon (L95275).
- The engine also has a full **Hillaire sky-view LUT + Bruneton transmittance + multiple scattering** atmosphere and a **ray-marched volumetric cloud dome** (Perlin-Worley 128³ and 32³ noise, weather map, adaptive stepping, dual-lobe phase, powder, multi-scatter octaves, interleaved refresh every 1–2 s) (L23032–23460). These run only when a `Sky` object is in the scene (`?physky`). By default the **ocean** is rendered by the same `skyOcean` module.

**Sun.** A single directional "SunLight" (`isSunLight`), intensity 0.12–4.6 and colour per preset. It uses the three-map scheme above with **PCSS** sized to the sun's angular diameter (blocker search, then penumbra-wide PCF, taps rotated per TAA frame; L27037–27100). Shadow map resolution is 4096 (High/Ultra), 2048 (Performance), 1024 (mobile) or 512 (saver) (`MB_SHADOW_RES`, L22556). The static map is cached and redrawn only when the sun or camera moves enough (`sunCacheMs`, `shadowEpoch`). There is a far "leaf-mass" proxy for tree shadows.

**Ambient/indirect.**
- Environment split-sum IBL multiplied by the **baked sky visibility** (per vertex `uv2.x` on walls and roofs, or the 2 m world field on the street, the car and props), with a floor for bounce light.
- Then **GTAO** with a multi-bounce fit (Jimenez 2016). Specular occlusion comes from AO.
- Window glass in canyons reflects a **procedural "city across the street"** instead of the sky: facades by azimuth with lit windows at night (L43268–43299). SSR overrides it where it hits.
- At night a **hemisphere "city glow"** lights the scene: warm from the ground, cool from the sky. It fades past 400–1200 m and with height above the street (`glowFall`), so upper floors stay in the cool sky light.

**Punctual lights (night).** Clustered. Street lamps use a **batwing** profile (intensity rising toward the cone edge, about 1/cos^2.5, up to 4.5×) and a **house-side shield**. Each lamp also gets a **"floor bounce" pseudo-light**: a Lambertian disc that lights walls and the car from below. Headlamps model an ECE-like **low-beam cut-off**, a near-field "lens radius" so close walls do not blow out, and source-size lobe widening (Karis 2013). Leaf cards transmit lamp light.

**Water.** An FFT ocean with 3 cascades, a JONSWAP spectrum with Donelan-Banner spreading, Jacobian whitecaps with decay, shore foam from a signed-distance field to sea walls and piles, Bruneton 2010 sun glitter from slope variance, planet curvature, and Bay Lights LED reflections (L23491–23830).

**Weather.** The rain preset adds particles, wet roads (puddles and film), **rain beads on the car's clear coat** (L82966), and spray. "Karl the Fog" uses a marine-layer fog that thins above 60 m with a 35 m scale height, so bridge towers poke out of it (L64639).

---

## 6. Assets and formats

- **Meshes:** glTF binary (`.glb`) served **gzip-compressed** (`*.glb.gz`, decompressed with `DecompressionStream` in an image/bytes worker). There is **no Draco, meshopt or KTX2** (the strings in `app.js` belong only to three's bundled GLTFLoader). Traffic models are written by **glTF-Transform v4.5.0** with `EXT_texture_webp`.
- **Textures:** **WebP** everywhere. Facade atlas `fronts_vic.webp` is 3400×4080 (1.6 MB) with a 1700×2040 lossless mask. `office.webp` is 4096² (1.2 MB). `asphalt_hd` is 2048², its normal map 1024². `_lo` variants are for mobile. Decoding happens in 2–8 workers with `createImageBitmap` and power-of-two downscaling to a per-tier cap.
- **World data:** custom binaries: `uint32 header length + JSON header + typed arrays` (Int16 quantised coordinates, Float32, Uint8 codes), gzip on the wire.
- **Vehicles:**
  - Player Waymo (Jaguar I-PACE): `waymo.glb` with 169k triangles (157k body), generator string `"sf-drive tools/cars/waymo_model.py"`, so it is **script-built**. Albedo, ORM and emissive maps are separate WebP files. Four more player cars: Cybercab, Corvette, Cybertruck, Ferrari 458 (`scene_subd.glb` with baked AO `ao_subd.bin`).
  - Traffic: sedan, hatch, SUV, pickup, van, taxi, bus, plus `_lod1` versions; the sedan is about 13.8k triangles. Image names (`texture_pbr_20250901`) and comments ("the generated cars", "the generated textures' blotches and baked light") point to an **image-to-3D generator**. The shader splits paint, glass, rubber and metal using a mask (`tools/cars/masks.mjs`) and re-lights them, because the generated texture has baked lighting.
  - Car paint: base, metallic flakes per cell that fade to roughness with distance, a clear coat, and Beer-Lambert darkening toward the silhouette (L82984–83092).
- **Engine capability not used here:** a **neural appearance renderer** (an MLP inlined into WGSL, latent texture arrays, prefiltered priors, "studio bundles" baked from Blender Cycles, `weights.bin`). Its loader `loadNeural` (`app.js:8472`) is never called in the taxi build.
- **Audio:** `assets/audio/audio.json` defines engine samples at 1000, 2000, 3500, 5500 and 8000 rpm plus coast, crossfaded by RPM, and recorded road/skid/impact/scrape sounds (source tag "apex-city"). It also lists city and bay ambience beds, passing car and truck loops, gulls, a foghorn, cable-car bells, and **convolution reverb IRs** (`ir_street`, `ir_tunnel`).

**Car and driving side.**
- **Physics:** a custom vehicle model (L81840–81935) with mass, yaw inertia, CG height, per-axle wheel radius and inertia, μ 1.24–1.45 by car, a drift μ, drag `cdA`, rolling resistance, downforce, separate front/rear brake forces, ride frequency 2 Hz and damping 0.7, anti-roll, pitch/roll inertia, an engine torque curve, gears and launch control. EVs get one-speed regen. Assists are TCS, ESP (per-wheel braking), ABS and a steering helper. There is no third-party physics engine.
- **Camera** (L86307–86476):
  - Modes: Chase (5.6 m back, 2.25 m up, look 4.5 m ahead, **FOV 58°**), Far chase (8.8 m, FOV 60°), Hood (FOV 68°), Bumper (FOV 72°). FOV grows up to +14° with speed, +7° with nitro, and +18–22° in portrait.
  - All motion uses a critically damped spring (SmoothDamp-style).
  - Yaw follows the velocity vector (more when drifting) and lags more at low speed. The camera leans with lateral g, gets an impact kick (4 Hz decaying), shakes slightly at speed, pulls in for walls, and is lifted over terrain.

---

## 7. What a three.js r186 WebGPU project could adopt (prioritised plan)

The ordering puts the most "looks real" per unit of effort first, for our pipeline: OSM/Overture → `tools/bake/bake_world.py` → three r186 `WebGPURenderer` + TSL, with Lagos/Yaba and Dublin/Finglas as targets. Teleoperator's main lesson is that **realism comes from offline baking plus surface detail plus a calibrated look**, not from photogrammetry. Every item below fits a self-hosted pipeline. *Verify exact r186 class names in `node_modules/three/examples/jsm` before coding; the names here match recent releases but were not re-checked today.*

| # | Item | How (technique / library) | Licence / terms constraints |
|---|---|---|---|
| **P0** | **Calibrate the look first**: a fixed exposure per time-of-day preset, ACES or AgX, then an analytic grade (vibrance, S-curve, split-tone, shoulder) | TSL post chain: `renderOutput` / `toneMapping` + a custom TSL grade node. Build a **reference harness**: 20–40 fixed camera poses, screenshots compared with real street photos of Yaba/Finglas (luminance histograms, 99.5th percentile, saturation). Teleoperator did this "round" by "round". | Our own photos, or CC-licensed photos used only as references (no redistribution). Do **not** pull Google Street View imagery (Maps terms forbid scraping or derivative use). |
| **P0** | **Aerial-perspective fog**: exp² plus a linear veil, colour warm toward the sun and cool away from it, height falloff, clearer over water | A TSL fog node (`scene.fogNode`) or a custom `fogNode` reading the sun direction; a horizon haze band | Technique only. |
| **P1** | **Baked sky visibility (city-scale AO)** per wall and roof vertex plus a 1–2 m street-level grid | Add a pass to `bake_world.py`: ray-cast 64–128 hemisphere rays against the extruded buildings and terrain (CPU BVH, e.g. `trimesh`/Embree via Python, or `three-mesh-bvh` in Node). Store a Uint8 field and a `uv1` attribute, then multiply into IBL/ambient in a TSL `aoNode`. Keep GTAO (`examples/jsm/tsl/display/GTAONode.js`) for contact. | `three-mesh-bvh` MIT; Embree Apache-2.0; trimesh MIT. |
| **P1** | **Sun shadows done properly**: cascaded maps for near detail, a cached large static map, a per-frame movers map, soft penumbra | `CSMShadowNode` (r186 `examples/jsm/csm/`) to start. Cache static casters with `shadow.autoUpdate = false` and `needsUpdate` on sun or camera moves. Use PCF-soft/VSM to start, and PCSS later in a custom shadow node. | MIT (three). |
| **P1** | **TAA instead of SMAA**, with a sharpen pass; stochastic alpha for foliage | `TRAANode` (r186 `examples/jsm/tsl/display/TRAANode.js`) plus velocity; a CAS-style sharpen in TSL; dithered alpha test for leaves that TAA resolves | MIT. Note: instanced traffic needs per-instance previous matrices for correct velocity (Teleoperator added this). Check r186 `VelocityNode` support for `InstancedMesh`. |
| **P2** | **Facade "photo" atlases per local building style, plus metadata-driven 3D details** | Per style (Lagos: two-storey "face-me-I-face-you" blocks, painted render with burglar-proof grilles, shopfront containers, corrugated roofs; Dublin: red-brick terraces, pebble-dash semis), make orthographic full-front images. Store window rects, door and gate positions and balcony/eave heights in JSON. The baker extrudes **balconies, eaves, window reveals and grilles**. The TSL shader adds a reveal shadow, interior mapping (rooms behind glass), weathering by height (rain streaks, splash grime at the foot) and night occupancy lights. | Image sources: **our own photos** (best); CC0 (Poly Haven, ambientCG) for materials only; **AI-generated** images under the chosen model's licence (record the model and its terms; some forbid certain commercial use). **Mapillary** imagery is CC BY-SA 4.0: attribution plus share-alike on derived textures. **Google Street View: not allowed.** |
| **P2** | **Road shader**: world-space 2-scale photo asphalt blended by noise; procedural repaving, patches, cracks; AA'd lane paint; local markings; decals; wet film and puddles | TSL material on the road mesh with `uv` = (along, across) metres. Box-filtered stripes (integrate the square wave over `fwidth`). Lagos specifics: worn or no paint, laterite dust on the edges, open drains, potholes, speed bumps, BRT lanes. | CC0 asphalt textures (ambientCG/Poly Haven, already in `tools/assets/fetch_textures.py`). |
| **P2** | **Sky and IBL**: an HDR sky baked for each preset in a worker (or physical), then PMREM, plus a 2D cumulus layer | Option A: our own analytic gradient plus cumulus fbm, baked to an equirect in a Worker (cheap, art-directable; this is what Teleoperator ships). Option B: **`@takram/three-atmosphere`** (MIT; WebGPU/TSL entry `@takram/three-atmosphere/webgpu`; verify the r186 peer range) for physically based sky, sun transmittance and aerial perspective. Volumetric clouds: `@takram/three-clouds` (MIT; check WebGPU support). Default to 2D baked clouds as Teleoperator does. | MIT. |
| **P3** | **SSR for wet roads and glass**; lamp streaks on wet asphalt at night | `SSRNode` (r186 `examples/jsm/tsl/display/SSRNode.js`) on roughness under ~0.45; for wet roads, a vertical blur kernel at the hit (TSL). Off on low tiers. | MIT. |
| **P3** | **Vegetation**: per-species hero trees (cards plus branch tubes), 3-level wind, back-light translucency, far impostors (3 views) | Generate offline (e.g. **`@dgreenheck/ez-tree`**, MIT, three.js procedural trees *[verify licence]*), bake an octahedral or 3-view impostor atlas; wind in TSL `positionNode`. Lagos species: neem, almond (*Terminalia*), mango, coconut and oil palms, flame tree. | MIT. |
| **P3** | **Night lighting**: many lamps with clustered or tiled culling, batwing profile plus shield, a fake floor-bounce light per lamp, a hemisphere "city glow" fading with distance and height, interior-mapped lit windows | three r186 tiled lighting (`examples/jsm/lighting/TiledLighting.js`, used by `webgpu_lights_tiled`) or a capped light pool near the camera; a custom TSL light-profile function | MIT. |
| **P4** | **Street density**: props from data (lamps, signals, signs, hydrants, parked cars), pedestrians with a vertex-shader walk cycle, varied traffic | OSM `highway=street_lamp`, `traffic_signals`, `stop`; Overture places; procedural fill along kerbs. Traffic meshes: CC0/CC-BY models (Kenney CC0, Quaternius CC0) or image-to-3D under its terms; split materials by mask and re-light (do not trust baked texture lighting). | OSM **ODbL** (attribution plus share-alike on the derived *database*; rendered images are fine with attribution); Overture **CDLA-Permissive-2.0** for most themes (some layers ODbL). |
| **P4** | **Camera and feel**: SmoothDamp springs, FOV 58° + speed term, look-ahead, lean, impact kick, radial blur > 80 km/h; RPM-crossfaded engine samples plus convolution reverb by environment | three `MathUtils` and a custom spring; TSL radial blur; WebAudio `ConvolverNode` with IRs | IRs: OpenAIR library (mostly CC BY) *[verify per IR]*; engine samples: own recordings or licensed packs. |
| **P5** | **Water** (Lagos Lagoon, Liffey/Dublin Bay): start with r186 `WaterMesh`, move later to an FFT ocean (JONSWAP, 2–3 cascades, Jacobian foam, shore SDF foam) | TSL compute FFT; shore SDF baked in `bake_world.py` from the OSM coastline | Technique only. |
| **P5** | **Robustness**: quality tiers, GPU-timestamp-driven dynamic resolution, first-run benchmark, crash-recovery tier drop, adapter pre-request in a classic script | `renderer.setPixelRatio` stepping; WebGPU `timestamp-query` (r186 `renderer.resolveTimestampsAsync`) | — |
| **Skip** | Google Photorealistic 3D Tiles / Cesium ion as a base layer | Not needed for this look. Already found to be **blocked for EEA-billed projects created after 8 Jul 2025** (see 05 §0), and the Map Tiles API terms forbid offline caching and baking. | Google Maps Platform ToS; EEA restriction. |

**Suggested order for the next three sprints:**
1. P0 (look harness, grade, fog) and P1 (sky-visibility bake, CSM caching, TRAA). These are cheap and give the largest global change.
2. P2 facade atlases plus extruded details for **one** Yaba street style, and the road shader.
3. Night (P3), vegetation and SSR, then density (P4).

---

## 8. Unknowns, and what to check in a screen recording

**Could not determine from the bundle:**
- The generator used for facade images and traffic cars (the code only says "generated"; the `texture_pbr_20250901` naming hints at an image-to-3D tool; unconfirmed).
- The DEM source and the source of the prop positions (OSM vs DataSF).
- Exact chunk and LOD radii per tier (minified JS without comments).
- Whether the volumetric cloud dome or Hillaire sky ever runs in normal play (`?physky` suggests no).
- Real GPU cost per pass: there are `timestamp-query` labels (`gtao`, `bloom`…) but no numbers. Opening the site with `?fps` or watching `#fps` may show them.

**In a screen recording (desktop, High), check:**
1. Pause on a Victorian block at 10–20 m. Do bay windows have real silhouettes (they should)? Do windows show interior parallax when the camera moves? Is there streaking under sills?
2. Compare a canyon street with an open plaza at noon. The canyon floor should be clearly darker (baked sky visibility); the contact shadows are GTAO.
3. Drive toward the sun at golden hour. Look for lens ghosts and the anamorphic streak, the veil, warm fog toward the sun and cool fog away from it.
4. Step through T (time of day): noon → golden → fog → blue hour. Note that exposure jumps (no auto-exposure) and the city-glow fill at blue hour.
5. Rain at blue hour: lamp streaks down the wet road, beads on the car, puddles near the kerb, spray.
6. Fast camera pans: TAA ghosting on traffic (it should be low), shimmer on far window grids (it should be absent), sharpening halos.
7. Above 80 km/h: radial blur at the frame edges, FOV widening (up to +14°), no per-pixel motion blur.
8. Shadow detail: crisp under the car within about 24 m, softer far away; whether traffic shadows ever lag.
9. The water from the Embarcadero: FFT chop, whitecaps, foam at the sea wall, sun glitter.
10. Settings menu: switch Performance ↔ Ultra and note the resolution change, SSR on/off, and the shadow-resolution difference.

**Reproduce:** the files are in `/tmp/teleop/`: `app.js`, `boot.js`, `workers/*.js`, `assets/real/*.bin.gz`, `assets/tex/tex.json`, the sampled atlases, and `comments.txt` with all WGSL comments by prettified line.
