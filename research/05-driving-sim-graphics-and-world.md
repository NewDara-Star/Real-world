# 05 — Driving-sim graphics, "drive anywhere", physics, narration and Electron

Research date: 2026-10-04. Scope: the Electron desktop driving sim (`game/`, three.js r186, `WebGPURenderer` + TSL with WebGL2 fallback, Logitech G29 over WebHID) for long drives in real places (Finglas/Dublin, Yaba/Lagos, later anywhere), plus a driving-instructor mode.

> **Method note.** `api.github.com` and the GitHub MCP tools were blocked for third-party repos in this session. Licences were read from the actual `LICENSE` files via `raw.githubusercontent.com`. "Last commit" dates come from shallow `git clone`s made today, and package versions from `registry.npmjs.org`. `developers.google.com` was blocked, so the Google pricing and terms come from search-engine extracts of those pages. Treat them as "verify before relying on". Anything I estimated is marked **[estimate]**.

---

## 0. TL;DR

1. **Teleoperator does not use photogrammetry.** I downloaded its public bundle (`app.js`, 2.6 MB) and read it. It is a **custom WebGPU renderer ("MindblownRenderer", hand-written WGSL)**. three r186 is bundled only for loaders and math, and as the WebGL fallback. The city comes from **pre-baked binary layers built from OSM-type data** (`terrain/roads/buildings/props/coast/ground/green/rails.bin`), plus **hand-made facade atlases for landmarks** and tree impostors. So it uses the same approach we do, executed with much more shading craft. See §1.1 for its technique list. This is the best roadmap we have.
2. **The biggest visual wins for our pipeline, in order, are:** SunLight cascaded shadows (built into r186) → sky-driven IBL plus baked sky-visibility (AO) → AgX/Neutral tone mapping with grading → TRAA/TAAU instead of SMAA → physically based atmosphere and aerial perspective (`@takram/three-atmosphere/webgpu`) → facade interior-mapping and night windows → road surface detail and wetness. See §6.
3. **Google Photorealistic 3D Tiles are blocked for us in Ireland.** Google stopped serving them to projects created after **8 July 2025** with an **EEA billing address** (HTTP 403). An Irish developer account cannot legally use them for Finglas. Lagos photogrammetry coverage is **unconfirmed** (probably terrain plus imagery only). The "far-field" layer therefore has to be **pluggable**, with a self-generated fallback.
4. **Physics:** for a wheel sim, do not rely on Rapier's Bullet-style `DynamicRayCastVehicleController` tyre logic. Use Rapier (Apache-2.0) or Jolt (MIT) for the rigid body and collisions. Write **our own tyre model** (combined-slip Pacejka or brush model with a friction circle), and derive force feedback from **front-axle self-aligning torque**.
5. **Electron 44.5.1 = Chromium 152.** WebGPU is on by default on macOS, and the WebHID permission handlers our `desktop/main.cjs` uses are the documented approach. `@electron/packager` can build a darwin-arm64 `.app` on Linux. It cannot sign or make a DMG, so you need **ad-hoc signing plus clearing the quarantine flag on the Mac** (or `rcodesign` on Linux).

---

## 1. Rendering: what "Teleoperator-grade" actually means

### 1.1 Teleoperator teardown (from its public JS bundle)

Source: `https://teleoperator.mindblown.ai/` → iframe `/?mb=game` → `app.js` (2,675,455 bytes) and `boot.js`. There is no licence, so **we learn techniques only and copy no code.**

| Area | What the code shows |
|---|---|
| Renderer | `MindblownRenderer`: raw `navigator.gpu`, its own WGSL (`@compute` ×39, `@fragment` ×32). It requests `timestamp-query` and `shader-f16`, retries up to 6 adapter configurations, then falls back to `THREE.WebGLRenderer`. three is `REVISION "186"`. |
| World data | `assets/real/{terrain,roads,buildings,props,coast,ground,green,rails,btags,sky}.bin` and `assets/osm/downtown.json`, all baked offline (a `tools/real/skyvis.mjs` is referenced). Trees and yards are in `assets/veg/*.bin`. |
| Landmarks | Hand-authored `assets/tex/lm/{pier39,fortmason,waterfront,lombard_gg,skyline}` facade atlases with masks. Generic buildings are procedural. |
| Lighting | GGX with height-correlated Smith and Karis split-sum. **Clustered lights** in a compute-built cluster buffer. Cascaded sun shadow (`cascade` sizes L0–L2). **PCSS-style soft shadows** ("blocker search… umbra"). A cached spot-shadow atlas for static casters. A far "leaf-mass" shadow map for trees. |
| Indirect | **Baked sky visibility per surface** ("the sky's share each surface sees"). Baked AO for vehicles (`ao_*.bin`). Box-projected reflection probes. Something they call a "neural env" / "learned clear-coat occlusion". |
| Post | **TAA with a reactive mask** and heat haze. **SSR** with planar reflections for water and glass. GTAO. Bloom and glare. AgX/ACES/Neutral tone-mapping options. Colour grade ("grade.mids"). Speed radial blur ("NFS speed"). |
| Atmosphere | Bruneton/Hillaire-style transmittance and aerial perspective. **Ray-marched clouds** (Beer-powder, stratus→cumulus profile). Height fog. |
| City detail | **Interior mapping** ("rooms' level of detail by the pixel's area", lit offices by floor at blue hour). Window glass. Facade grime ("darker toward the street, streaks"). Roof materials (TPO sheets). Road "utility cuts", cracked and weathered patches, damp patches, decals that fade over 50 m. Vegetation impostors (`impostors.json`). |
| Water | Ocean with FFT-style cascades, shoreline foam from a signed-distance field, and the Bay Lights. |

**Lesson:** the realism comes from **(a) baked lighting data computed offline from the same OSM-derived geometry**, **(b) many small surface-variation tricks**, and **(c) temporal AA plus a good tone curve**. Photogrammetry plays no part. All of it fits our existing `tools/bake/bake_world.py` and three's built-in nodes.

### 1.2 three.js r186 built-ins (verified in the `r186` tag, `examples/jsm/…`)

r186 was tagged 2026-09-24; npm `three@0.186.1`, MIT. All of these work with `WebGPURenderer`, and most also work on its WebGL2 backend.

| Feature | Module | Notes for us |
|---|---|---|
| **Cascaded sun shadows** | `lights/SunLight.js`, `SunLightNode.js`, `SunShadowNode.js` (new in r186). Older: `csm/CSMShadowNode.js` | `renderer.library.addLight(SunLightNode, SunLight)`. Set `shadow.camera.far` for the max distance. Replaces our hand-snapped 180 m `DirectionalLight` frustum. Example: `webgpu_lights_sunlight.html`. |
| Clustered (Forward+) lights | `lighting/ClusteredLighting.js` (r185) | `renderer.lighting = new ClusteredLighting(1024, 32, 24, 64)`. Point lights only. Good for streetlights and shop signs at night. |
| Irradiance probe grid | `lighting/LightProbeGrid.js` (+`LightProbeGridWebGL.js`) | GPU-baked L2 SH grid; diffuse GI for street canyons. Used by `webgpu_generator_city.html`. |
| VXGI | `lighting/vxgi/VXGINode.js` | WebGPU-only voxel cone tracing. Too heavy and too bounded for a city. Skip. |
| SSGI | `tsl/display/SSGINode.js` | Presets with TRAA: Low (1 slice × 12 steps) to High (3×16). Also does AO. Expensive. |
| SSR | `tsl/display/SSRNode.js` | `stochastic:false` gives cheap mirror SSR plus a blur; `reflectNonMetals:false` early-outs. Use it for wet roads and glass. |
| GTAO | `tsl/display/GTAONode.js` | We already use it. |
| TRAA / **TAAU** | `TRAANode.js`, `TAAUNode.js` | TAAU renders at lower resolution and reconstructs. An FSR2-like path for Retina screens. Needs a `velocity` MRT and MSAA off. |
| FSR1 | `FSR1Node.js` | Cheap spatial upscaler alternative. |
| Motion blur | `MotionBlur.js` | Uses the same velocity buffer as TRAA. |
| DOF, god-rays, lens flare, 3D LUT | `DepthOfFieldNode`, `GodraysNode`, `LensflareNode`, `Lut3DNode` | LUT is the cheap path to a film-like grade. |
| Denoise | `DenoiseNode`, `RecurrentDenoiseNode` | For SSGI and SSR. |
| Generators | `generators/CityGenerator.js` (+`city/` cars, streetlights, traffic lights, trees, benches), `TreeGenerator`, `ForestGenerator`, `TerrainGenerator` | Read-only reference for TSL materials (`createBuildingMaterial`, `createRoadMaterial`) and instancing patterns. |
| Weather | `webgpu_compute_particles_rain.html`, `…_snow.html`, `webgpu_custom_fog_scattering.html`, `webgpu_fog_height.html` | Compute rain plus height fog. |
| Lights | `webgpu_lights_ies_spotlight.html`, `webgpu_lights_projector.html` | IES profiles and projector textures for **real headlights**. |
| Misc | `webgpu_materials_retroreflection.html` (r186), `webgpu_reversed_depth_buffer.html`, `webgpu_performance_renderbundle.html`, `webgpu_mesh_batch.html` | Retroreflective road signs and lane paint. Reversed-Z for long view distances. Render bundles and `BatchedMesh` for draw-call-bound cities. |

### 1.3 Third-party libraries

| Library | Licence (from LICENSE) | Last commit / npm | WebGPU? | Verdict |
|---|---|---|---|---|
| [takram-design-engineering/three-geospatial](https://github.com/takram-design-engineering/three-geospatial) (`@takram/three-atmosphere`, `three-clouds`) | MIT | 2026-05-27; atmosphere 0.19.1, clouds 0.7.6 | **Atmosphere: done** (`@takram/three-atmosphere/webgpu`, needs three ≥0.182). **Clouds: WebGPU work in progress** (WebGL only today). | **Adopt the atmosphere.** `AtmosphereLight` (replaces sun + sky light probe), `aerialPerspective(color, depth)` post node, `skyBackground()`, `SkyEnvironmentNode` for IBL, moon and stars, and `getSunDirectionECEF(date)` for a real sun position at Dublin or Lagos. It is built for geospatial ECEF scale. Our local ENU frame needs the `AtmosphereContext` set up with a world-origin matrix (see their storybook). |
| [0beqz/realism-effects](https://github.com/0beqz/realism-effects) (SSGI, TRAA, motion blur) | MIT | **2024-02-03**; npm 1.1.2 (2023) | No (pmndrs/postprocessing, WebGL) | **Dead and incompatible.** three's own SSGI/TRAA nodes supersede it. |
| [N8python/n8ao](https://github.com/N8python/n8ao) | CC0 (repo LICENSE; npm says ISC) | 2026-08-09; 2.0.1 | WebGL `EffectComposer` / pmndrs only | Not for `WebGPURenderer`. Keep GTAO, or try `three-gtvbao`. |
| [pmndrs/postprocessing](https://github.com/pmndrs/postprocessing) | Zlib | 2026-09-09; 6.39.5 | WebGL | Not compatible with our renderer. |
| [norio/three-gtvbao](https://github.com/norio/three-gtvbao) | MIT | 2026-09-09; 0.2.1 | **Yes (TSL)**, r184+, verified on 0.186.0 | Drop-in AO upgrade over GTAO (visibility bitmask, half-res, depth-aware upsample, TRAA-aware). Worth an A/B test. |
| [bhouston/three-ss-fidelity](https://github.com/bhouston/three-ss-fidelity) | MIT | 2026-10-03 | Yes | A harness scoring three's SSGI/SSR/TRAA against a path tracer. A fork (`ssgi-traa-redesign`) is improving those nodes, so expect better SSGI/TRAA upstream. Watch it. |
| [gkjohnson/three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh) | MIT | 2026-09-30; 0.9.15 | n/a (CPU) | Fast raycasts and shape-casts against tiles and procedural meshes (camera collision, ground sampling). |
| [Scthe/nanite-webgpu](https://github.com/Scthe/nanite-webgpu) | MIT | 2026-05-10 | Raw WebGPU, not three | Meshlet LOD, software rasteriser, impostors. Impressive but **not needed**: our buildings are low-poly, so we are draw-call and overdraw bound, not triangle bound. Use `BatchedMesh` plus merged tiles plus impostors. |

### 1.4 Specific techniques (how to do them in TSL)

- **IBL from the procedural sky:** render `SkyMesh` (or takram's `skyBackground`) into a small cube scene and call `PMREMGenerator.fromScene()` **only when sun elevation changes by more than about 1°** (every few game minutes). Assign the result to `scene.environment`. Without this, car paint, glass and wet roads cannot look right. Cost is near zero when amortised. Takram's `SkyEnvironmentNode` does the same physically.
- **Baked sky visibility, Teleoperator-style:** in `bake_world.py`, for each building wall and road vertex, cast about 64 hemisphere rays against the building footprints and heights and store the fraction of open sky as a vertex attribute (or an R8 texture per tile). In TSL, multiply ambient/IBL diffuse by it (`builtinAOContext` or `material.aoNode`). It is free at runtime and gives the "street canyon" look that screen-space AO cannot (screen-space AO has no off-screen occluders).
- **Car paint:** `MeshPhysicalNodeMaterial` with `clearcoat = 1`, `clearcoatRoughness ≈ 0.03–0.08`, base `metalness ≈ 0.6–0.9`, `roughness ≈ 0.35`. For **flakes**, add a high-frequency cell-noise normal perturbation to the base layer only (`normalNode` from `mx_cell_noise_float(positionLocal*400)`), and leave the clearcoat normal smooth. Add a small `sheen` or `iridescence` for pearl paints. Most of the realism comes from the environment map.
- **Wet roads and rain:** a global `wetness` uniform plus a puddle mask (world-space noise × road "low spots" from the bake). Wet means `roughness *= mix(1, 0.15, wet)` and `albedo *= mix(1, 0.6, wet)` (darkening). Puddles get roughness ≈ 0.02 and a flattened normal. Feed them to **SSR** (`stochastic:false`, mask to the road) with IBL fallback. Add rain drops as compute particles, ripple normals from a scrolling flipbook, spray behind tyres, and screen-space droplets on the windscreen in the cockpit view.
- **Headlights:** two `SpotLight`s with `map` (a projector texture with low/high-beam cut-off) or IES profiles, shadows off (or one shared 512 px shadow). Add emissive lens meshes plus bloom. **Streetlights** go through `ClusteredLighting` as point lights. For hundreds of them, use a fake light pool decal on the road plus a light only within about 80 m **[estimate]**.
- **LOD and impostors:** trees as an instanced mesh near the camera and **octahedral impostors** beyond about 120 m. Buildings: full facade shader within 300 m, a flat-colour batched mesh beyond, then fog or aerial perspective. Use `BatchedMesh` per 250 m tile so culling stays coarse but draw calls stay low.
- **Virtual texturing:** unnecessary. Use **texture arrays** (`webgpu_textures_2d-array_compressed`) with KTX2/Basis for facade, road and roof material sets, as Teleoperator's `tex.json` atlas does.
- **Grass and terrain:** for Finglas verges and parks, compute-placed instanced blades within 40–60 m plus a grassy ground shader beyond. The three.js forum has a WebGPU grass plugin and a 1.5M-blade demo. Terrain comes from the DEM in our bake (Copernicus GLO-30). See `TerrainGenerator` for slope-based TSL materials.

### 1.5 Cost on Apple Silicon (M1/M2/M3, 1440p-ish internal)

All numbers are **[estimate]**, extrapolated from typical WebGPU/Metal tile-GPU behaviour and three.js example timings. Measure with the `Inspector` / `timestamp-query`.

| Item | GPU ms (M1 base → M3 Pro) | Visual gain | Gain per ms |
|---|---|---|---|
| AgX/Neutral + exposure + 3D LUT | ~0.1 | High | ★★★★★ |
| PMREM sky IBL (amortised) | ~0 (2–5 ms once per update) | Very high | ★★★★★ |
| Baked sky visibility | 0 | Very high | ★★★★★ |
| SunLight 3 cascades, 2048² | 2–4 → 1–2 | Very high | ★★★★ |
| TRAA (vs SMAA) | ~0.5–1 | High (no shimmer) | ★★★★ |
| TAAU at 0.67 scale | **saves** 30–45 % of shading | Neutral or positive | ★★★★★ |
| takram aerial perspective + sky | ~0.5–1.5 | High at distance | ★★★★ |
| Facade interior mapping | ~0.5–1 (ALU) | High at night | ★★★★ |
| SSR roads-only, non-stochastic, half-res | 1–2.5 | High when wet | ★★★ |
| GTAO / GTVBAO half-res | 1–2 | Medium (we already have it) | ★★★ |
| Clustered lights (night) | 0.5–2 | High at night | ★★★ |
| Motion blur (velocity) | ~0.5 | Medium at speed | ★★★ |
| SSGI medium + denoise | 4–8 → 2–4 | Medium outdoors | ★ |
| Volumetric clouds (ray-marched) | 2–6 | Medium | ★★ |
| VXGI / path tracing | ≫10 | n/a | ✗ |

---

## 2. "Drive anywhere on Earth"

### 2.1 Google Photorealistic 3D Tiles (Map Tiles API)

- **Renderer:** [NASA-AMMOS/3DTilesRendererJS](https://github.com/NASA-AMMOS/3DTilesRendererJS), Apache-2.0, last commit 2026-10-03, npm `3d-tiles-renderer@0.5.3` (2026-09-18), devDep `three ^0.185`. Plugins we would use:
  - `GoogleCloudAuthPlugin`, plus `GoogleAttributionsManager` for the required copyright string.
  - `ReorientationPlugin` puts a lat/lon at the origin with +Y up.
  - **`TileFlatteningPlugin`** flattens tile vertices onto shapes, explicitly "for cutting roads into terrain". It lets photogrammetry sit under our procedural roads.
  - **`LoadRegionPlugin`** restricts loading to sphere/OBB/ray regions, with mask regions.
  - `MeshBVHPlugin` provides BVH raycasts on tiles.
  - `TilesFadePlugin`, `UnloadTilesPlugin`, `TileCompressionPlugin` and `BatchedTilesPlugin` cover streaming and memory.
  - **WebGPU caveat:** I found no explicit `WebGPURenderer` support statement. The core is renderer-agnostic, but several plugins wrap `onBeforeCompile` materials (WebGL-only). Test with `MeshBasicNodeMaterial` replacements in `onLoadModel`.
- **Pricing** (search extracts of Google's pricing pages; verify): an Enterprise SKU with **1,000 free billable events per month**, then **$6.00 per 1,000** (0–100k), $5.10 (100k–500k), $4.20 (500k–1M), $3.30 (1–5M), $2.40 (5M+). **Only root-tileset requests are billed.** A session token then allows **up to 3 hours** of tile requests. There is a cap of **10,000 root requests per day**. For one personal player that is effectively free (one event per launch).
- **Terms that bite:**
  - **EEA block.** From **8 July 2025**, Photorealistic 3D Tiles (and 2D satellite tiles) **return 403 for projects created after that date on accounts with an EEA billing address**. Google suggests its own closed "3D Maps" (`Map3DElement`) instead, which cannot be embedded in a three.js scene. ([Google EEA page](https://developers.google.com/maps/comms/eea/map-tiles), [blosm issue #644](https://github.com/vvoovv/blosm/issues/644)). Cesium ion's Google asset (id 2275207) is subject to the same Google terms. **Since you are in Ireland, assume this is unavailable.**
  - **No pre-fetch, store or cache** beyond HTTP cache headers. **No offline use.** No "geodata extraction" ([Map Tiles policies](https://developers.google.com/maps/documentation/tile/policies)). So **we must not bake Google meshes into colliders or files**. Runtime raycasts are a grey zone; keep them transient.
  - **Attribution:** show the Google logo and the per-tile copyright string, unobscured.
  - **"No use with non-Google maps"** (GMP ToS §3.2.3(e)). Mixing Google tiles with an OSM/Overture-derived 3D city in the same view is at least arguable. Low risk for private personal use, **real risk if distributed**.
  - Using it in a game is not explicitly forbidden (visualisation use is allowed; analysis and extraction are not).
- **Coverage:** Google advertises "2,500+ cities in 49 countries". **Dublin** has photogrammetry in Google Earth, but the API is blocked for EEA accounts (above). For **Lagos** I could not confirm photogrammetry. Outside covered cities the tileset falls back to terrain plus satellite drape (flat buildings), which is useless for driving. Check by flying to Yaba in Google Earth web.

### 2.2 Alternatives for the far field

| Source | What | Licence / cost | Fit |
|---|---|---|---|
| **Our own bake (Overture + OSM + DEM)** | Extruded LOD buildings, terrain and imagery we generate | Overture buildings ODbL/CDLA mix, OSM ODbL, Copernicus DEM free | **Default for Lagos and Dublin.** Fully under our control, cacheable, offline. Export far LODs as our own tiles (or 3D Tiles 1.1 glTF) so the same streaming code works. |
| Cesium ion: World Terrain + Bing imagery + **Cesium OSM Buildings** | Global terrain, imagery, 350M grey buildings | ion account and terms; OSM Buildings derived from OSM (ODbL) | Viable via `CesiumIonAuthPlugin`. Grey boxes, so little better than our own. |
| [StrandedKitty/streets-gl](https://github.com/StrandedKitty/streets-gl) | Eye-candy OSM 3D renderer (WebGL2, TS) | MIT; last commit 2025-08-21; data frozen Sept 2023 | **Read it for procedural roof, road and tree generation ideas.** Not a dependency. |
| [OSMBuildings](https://github.com/OSMBuildings/OSMBuildings) | 2.5D OSM buildings | BSD-style; last commit 2020 | Stale. |
| MapLibre GL JS / Mapbox GL JS | 2.5D extrusions on a map | MapLibre BSD-3; Mapbox v2+ proprietary | Wrong paradigm for a first-person sim. Good for a minimap or route planner. |
| Bing Maps 3D | — | Bing Maps for Enterprise retired (free tier June 2025, enterprise June 2028) → Azure Maps (no photogrammetry API) | Dead end. |
| **Dublin open LiDAR (NYU, 2015)** | 300 pts/m² ALS plus photogrammetry imagery, ~2 km² city centre | **CC BY 4.0** ([NYU archive](https://archive.nyu.edu/handle/2451/38596), [GIM article](https://www.gim-international.com/content/article/downtown-dublin-as-a-lidar-point-cloud)) | Centre only, **not Finglas**. Use it for accurate heights and roof shapes in the city centre, or as a Gaussian-splat or point far-field. |
| Google Open Buildings 2.5D Temporal | Building presence and heights at ~1 m effective resolution, 2016–2023, Africa included | CC BY 4.0 / ODbL | **Good height source for Lagos** where OSM and Overture lack heights. |

### 2.3 How existing projects drive on real-world data

- **Cesium for Unreal plus Google tiles** (many viral "drive or fly anywhere" demos: AxlRozzSHDW's whole-planet demo, Nils Bakker's paper-plane prototype, FloorYUKA). They enable "Create Physics Meshes" on the tileset and use Chaos Vehicles. Users report that driving is **"very bumpy and unusable"** on photogrammetry unless they lower the tileset's maximum screen-space error (16 → 2), because melted cars, kerbs and trees are in the mesh ([Cesium forum](https://community.cesium.com/t/driving-in-cesium-for-unreal-world/41753)). [80.lv write-up](https://80.lv/articles/ue5-powered-game-prototype-that-lets-one-explore-the-enitre-world-in-3d).
- **Hop.Earth** (browser, by DVLPLONDON, viral in August 2026): "drive almost any road on Earth". It **generates the world in real time from OpenStreetMap plus satellite elevation**, with simple geometry, procedural streetlights, a night mode and multiplayer races. It is still buggy (terrain fails to load). ([Dexerto](https://www.dexerto.com/gaming/genius-new-browser-game-lets-you-drive-anywhere-on-earth-using-real-world-map-3395030/), [Supercar Blondie](https://supercarblondie.com/hop-earth-free-world-map-driving-game/)). **This is our architecture, at lower fidelity.** It proves that OSM plus DEM streaming is the viable "anywhere" path.
- **Teleoperator**: an OSM-type bake plus landmark art (§1.1). No tiles.
- **Forensic Rock** (accident reconstruction): Cesium for Unreal plus Google tiles, used for **visual context, not vehicle contact**.
- **Common pattern:** physics never touches photogrammetry directly. The car drives on a **clean road/terrain collider built from vector data** (OSM centrelines, widths, DEM). Photogrammetry is visual only, sometimes flattened under roads. That is exactly what `TileFlatteningPlugin` is for.

---

## 3. Vehicle physics for a wheel sim

| Option | Licence | Activity | Tyre / drivetrain | Verdict |
|---|---|---|---|---|
| **Rapier** `@dimforge/rapier3d-compat` 0.21.0 ([repo](https://github.com/dimforge/rapier.js)) | Apache-2.0 | 2026-07-12 / npm 2026-09-25 | `DynamicRayCastVehicleController` is Bullet-style. Per-wheel `suspensionStiffness`, `Compression`, `Damping`, `maxSuspensionTravel`, `sideFrictionStiffness`, `frictionSlip` (a crude clamp, **no slip curve**), `maxSuspensionForce`. No engine, gearbox or differential. | **Good chassis, colliders and queries. Replace the tyre model with our own.** Deterministic and fast (WASM). |
| **Jolt** `jolt-physics` 1.1.0 ([JoltPhysics.js](https://github.com/jrouwe/JoltPhysics.js)) | MIT | 2026-08-23 | `WheeledVehicleController`: engine torque curve, gearbox, differentials, anti-roll bars, **longitudinal and lateral friction curves vs slip**. Known flaw: it clamps longitudinal and lateral impulses **independently**, so there is **no friction circle** and no power-oversteer ([tuning guide](https://hub.jmonkeyengine.org/t/jolt-vehicle-tuning-guide/49569)). | The best out-of-the-box JS vehicle. Customise the curves. Fine for a driving instructor. |
| cannon-es `RaycastVehicle` | MIT | 2024-01 (npm 2022) | Bullet-style | Unmaintained. Avoid. |
| ammo.js (Bullet) | Zlib | 2026-09-22 | btRaycastVehicle | Heavy, old API. No advantage. |
| [aunyks/tread](https://github.com/aunyks/tread) (`@hivoltagexyz/tread`) | BSD-style | 2024-06 | **Pacejka 2002 and Harsh & Shyrokau 2019 tyre models in JS/TS** | Use it as a reference or source for our tyre function. Small and stale, but the maths is the point. |

**Recommended design:**

1. Use a Rapier (or Jolt) rigid body for the chassis and world colliders (trimesh roads and kerbs from our bake, box colliders for buildings).
2. Our own wheel loop in a **fixed 240–500 Hz sub-step** (inside a worker if needed):
   - per-wheel ray or shape-cast (Rapier `castShape` with a cylinder or sphere, to avoid ray "teeth" on kerbs)
   - spring-damper load Fz
   - slip ratio κ and slip angle α with low-speed relaxation-length smoothing
   - **combined-slip Pacejka MF** (or brush model) scaled by a friction ellipse
   - forces applied at the contact points
   - a drivetrain with engine map, clutch, gearbox (manual for driving lessons), open or LSD differential, ABS/TC flags.
3. **Force feedback (G29):** the main torque is the **self-aligning torque** of the front tyres, `Mz = −Fy·(t_p(α) + t_m)`. The pneumatic trail `t_p` falls roughly linearly to about 0 near peak slip (`t_p ≈ t0·max(0, 1 − |α|/α_peak)`), which is the "going light" cue before understeer. The mechanical trail `t_m` comes from caster. Pipeline: steering-rack ratio → column torque, plus viscous damping ∝ steering velocity, Coulomb friction, a low-speed "dry-park" torque, road-surface texture (kerb, cobbles, potholes from the bake's surface tags), and collision jolts. Add a soft-clip limiter and a 30–60 Hz low-pass. Send updates at ≥60 Hz over WebHID. G29 uses the classic Logitech FF protocol. Linux `hid-lg4ff.c` (GPL; read it for byte layouts only):
   - constant force: `[0x11, 0x08, level, 0x80, 0,0,0]`
   - range: `[0xf8, 0x81, lo, hi, 0,0,0]`
   - autocenter: `0xfe 0x0d …` / `0xf5` off

   Verify these bytes against our existing implementation.
4. Codebases to learn from:
   - [VDrift](https://github.com/VDrift/vdrift): GPL-3, last commit 2026-04-07. Pacejka tyres and a full drivetrain in C++. Study only; do not copy (GPL).
   - Speed Dreams (SourceForge, GPL): the "Simu" tyre models.
   - [OpenDS](https://github.com/neoana/OpenDS): GPL, jMonkeyEngine. The GitHub mirror's last commit is 2017; newer versions are commercial. **Its driving-task and scenario XML (lane-change, reaction tests) is a good model for instructor exercises.**
   - [CARLA](https://github.com/carla-simulator/carla): MIT, last commit 2026-09-02. Use its **Traffic Manager** and **ScenarioRunner** concepts for AI traffic, right-of-way and junction logic, plus OpenSCENARIO for lesson scripts.

---

## 4. "Tell me about this place": narration

| Source | Licence | How |
|---|---|---|
| **OSM `wikidata=Q…` / `wikipedia=` tags** on POIs, streets and areas | OSM ODbL; **Wikidata CC0** | Already in our extracts. Query Wikidata (`wbgetentities`) for label, description, instance-of, inception and image. CC0 means no attribution needed (credit it anyway). |
| **Wikipedia summaries** | CC BY-SA 4.0 (text) | `https://en.wikipedia.org/api/rest_v1/page/summary/{title}` → `extract`. Nearby: `action=query&list=geosearch&gscoord=lat|lon&gsradius=≤10000`. **Attribution plus share-alike**: show "From Wikipedia, CC BY-SA" with a link. Rewritten narration derived from it stays BY-SA. |
| **Overture places** (~60M+ POIs) | Multi-licence: Meta and others **CDLA-Permissive-2.0**, Foursquare-sourced **Apache-2.0** | Names, categories, confidence. Good for "you're passing X pharmacy". Filter `confidence > 0.7`. |
| **OpenTripMap API** ([dev.opentripmap.com](https://dev.opentripmap.com)) | Data ODbL (OSM + Wikidata + Wikipedia); free key with a rate limit | Pre-ranked "interesting" POIs with descriptions. Caching is allowed (unlike Google Places). |
| Local knowledge | Ours | Hand-written lines for Finglas and Yaba landmarks beat any API. Store them in `research/data`. |

**Narration pipeline:** while driving, take POIs within about 150 m ahead (ranked by Wikidata sitelinks count, OpenTripMap `rate`, and whether they are visible). Generate a one-to-two sentence script offline in the bake, so there is no runtime LLM dependency (an optional "ask Claude more" button can be added later). Speak at most one item per about 30 s of driving, never during instructor prompts.

**Text-to-speech in Electron:**
- `window.speechSynthesis` works in Electron on macOS using the system voices. It is free, offline and has decent "Siri-like" premium voices if the user has downloaded them. Wait for `voiceschanged` before calling `getVoices()`.
- [Kokoro-82M via `kokoro-js`](https://www.npmjs.com/package/kokoro-js): Apache-2.0 model and code. Runs locally in **WebGPU** (or WASM) through Transformers.js. 54 voices, 24 kHz, near-commercial quality. About 80–300 MB depending on quantisation. **Best quality-to-licence trade-off.** Pre-generate common phrases in the bake, synthesise the rest live.
- Piper: the maintained repo [OHF-Voice/piper1-gpl](https://github.com/OHF-Voice/piper1-gpl) is now **GPL-3.0** (the old MIT `rhasspy/piper` was archived in October 2025). Fine for personal use, but it complicates any distribution.
- macOS `say` via `child_process` in the main process: zero dependencies, offline.
- Cloud TTS (ElevenLabs, Google, Azure) has the best voices, including **Nigerian-accented English**. It costs money and needs the network.

---

## 5. Electron specifics

- **Versions:** `electron@44.5.1` (npm 2026-09-30) ships **Chromium 152.0.7977.130** and **Node 24.21.0** (from the v44.5.1 `DEPS`). WebGPU has been on by default in Chromium for macOS since Chrome 113, and Electron does not disable it.
- **Our `desktop/main.cjs` is correct:**
  - `protocol.registerSchemesAsPrivileged({scheme:'app', privileges:{standard, secure, supportFetchAPI, stream}})` gives a secure context, which WebGPU and WebHID require.
  - The `enable-unsafe-webgpu` and `ignore-gpu-blocklist` switches are harmless on Apple Silicon but **not needed**. Consider dropping `enable-unsafe-webgpu` because it also exposes unsafe APIs.
  - Request the adapter with `powerPreference: 'high-performance'`, and set `backgroundThrottling:false` (already done).
- **WebHID:** the documented approach ([Electron devices tutorial](https://electronjs.org/docs/latest/tutorial/devices)), which we already follow:
  - `ses.setDevicePermissionHandler` pre-grants devices (we allow Logitech VID 0x046d).
  - `ses.setPermissionCheckHandler` allows `'hid'`.
  - The `select-hid-device` event auto-picks a device when `navigator.hid.requestDevice` is called.
  - `hid-device-added` / `-removed` events fire only while a selection is pending.
  - The default WebHID blocklist applies; `app.commandLine.appendSwitch('disable-hid-blocklist')` lifts it if needed.
  - Note: our check handler returns `false` for every other permission (for example `fullscreen`, `clipboard-sanitized-write`). Widen it if those break.
- **Packaging a Mac `.app` from Linux:**
  - **`@electron/packager` 20.3.0 (BSD-2) supports `--platform=darwin --arch=arm64` on Linux.** Our `package:mac` script already does this.
  - **electron-builder 26.15.3 cannot build macOS targets (dmg, pkg) on Linux**; its docs say "macOS only".
  - On Apple Silicon **every binary must carry at least an ad-hoc signature**, or macOS reports "damaged". Packager renames the app and rewrites `Info.plist` and cannot sign on Linux, so after copying to the Mac run:
    ```sh
    xattr -cr "Eko Drive.app"                         # drop quarantine (AirDrop/download adds it)
    codesign --force --deep --sign - "Eko Drive.app"  # ad-hoc sign, no Apple account needed
    ```
    Alternatively, ad-hoc sign on Linux with `rcodesign` (the `apple-codesign` crate from indygreg's PyOxidizer project, MPL-2.0; verify the current repo).
  - Transfer as **`tar` or `zip -y`** so that the framework **symlinks survive**; a plain zip breaks `Electron Framework.framework`.
  - If we ever flip `@electron/fuses` without signing, pass `resetAdHocDarwinSignature: true`.
  - Notarization is not needed for personal use.

---

## 6. "Do this first": ranked by win per effort

| # | Change | Effort | Why |
|---|---|---|---|
| 1 | **Tone mapping → `AgXToneMapping` or `NeutralToneMapping`**, plus a 3D LUT grade (`Lut3DNode`) and a proper exposure curve per time of day | 1 h | ACES over-saturates sunlit Lagos colours. AgX gives the filmic "photo" response Teleoperator offers. |
| 2 | **Sky IBL:** PMREM from SkyMesh into `scene.environment`, refreshed on sun change | 2–3 h | Car paint, glass and metal currently have nothing realistic to reflect. This is the single biggest PBR fix. |
| 3 | **SunLight (r186 CSM)** replaces the 180 m DirectionalLight frustum. 3 cascades, about 600–800 m far | 2–4 h | Shadows all the way to the horizon, crisp near the car. |
| 4 | **TRAA (or TAAU at 0.67–0.75 scale)** replaces SMAA. Add a `velocity` MRT and reuse it for motion blur | 0.5–1 day | Kills shimmer on poles, wires, window grids and lane lines. TAAU recovers performance on Retina. |
| 5 | **Baked sky visibility** per vertex in `bake_world.py` → `aoNode` | 1–2 days | Teleoperator's main trick: grounded, believable street canyons at zero runtime cost. |
| 6 | **`@takram/three-atmosphere/webgpu`**: AtmosphereLight + aerialPerspective + real sun/moon from date and lat/lon (replaces SkyMesh + linear Fog) | 1–2 days | Physically correct haze and distance colour. Harmattan becomes a turbidity or aerosol setting. Real sunrise times for Dublin and Lagos. |
| 7 | **Facade upgrade:** interior mapping (box-projected fake rooms), per-floor night lighting, grime streaks toward the street, roughness variation, window reflections from the IBL | 2–4 days | Facades fill most of the frame while driving. |
| 8 | **Road surface:** asphalt detail plus macro noise, patches and utility cuts, worn markings (retroreflective), kerb AO, **wetness and puddles plus roads-only SSR**, rain particles | 3–5 days | The road fills about 40 % of a driver's screen **[estimate]**. |
| 9 | **Night:** ClusteredLighting for streetlights, projector or IES headlights, emissive windows plus bloom | 2–3 days | Long drives span night. Night is where cheap renderers look worst. |
| 10 | **Trees:** instanced plus octahedral impostors and TSL wind. Car paint flakes, LightProbeGrid per tile | ongoing | Polish. |
| — | Skip for now: SSGI, VXGI, volumetric clouds (until takram's WebGPU clouds land), Nanite-style meshlets, Google tiles | | Low gain per ms, or blocked. |

---

## 7. Architecture: hybrid near-field procedural + far-field "photo" layer

```
                 ┌─────────────── WorldStreamer (tile grid 250 m, ENU floating origin) ────────────────┐
 lat/lon ──►     │ Ring 0  0–400 m   PROCEDURAL HI   roads(ribbons+markings), buildings(full facade,   │
 (city or        │                                   interior map), props/instanced, trees mesh,       │
  anywhere)      │                                   PHYSICS colliders (Rapier), CSM cascades 0–1      │
                 │ Ring 1  0.4–2 km  PROCEDURAL LO   BatchedMesh flat-shaded buildings, tree impostors, │
                 │                                   no colliders, CSM last cascade                    │
                 │ Ring 2  2–20 km   FAR-FIELD       pluggable provider (below), unlit + aerial persp.  │
                 └───────────────────────────────────────────────────────────────────────────────────────┘
 Far-field providers (strategy interface: load(regionOBB, excludeMask) → Object3D, attribution()):
   a) SelfBaked (default, offline, everywhere): Overture/OSM LOD1 extrusions + Copernicus DEM + optional imagery
   b) GooglePhotorealistic (only where licensed: non-EEA billing, ToS accepted): 3DTilesRendererJS
        + ReorientationPlugin(lat,lon) + LoadRegionPlugin(mask: exclude Ring 0–1 disc)
        + TileFlatteningPlugin(shapes = our road corridors) + GoogleAttributionsManager → HUD credit
   c) CesiumIon (terrain + imagery + OSM Buildings) via CesiumIonAuthPlugin
   d) LocalPointCloud / splat (e.g. NYU Dublin LiDAR, CC BY) via three r186 GaussianSplat
```

Rules:
1. **Physics, AI traffic, the instructor's lane logic and narration triggers use only our vector data** (OSM/Overture roads with lanes, widths, junctions, signals, speed limits). Never use photogrammetry for these. Even where Google tiles exist, they are pixels only, and their ToS forbids extracting geometry.
2. **Seam handling:** tile meshes inside the Ring 0–1 radius are discarded (LoadRegion mask, or a TSL `discard` by distance and footprint mask). Use a 50–100 m dithered cross-fade band, hidden by aerial perspective. Fade with TRAA and dither, as Teleoperator does.
3. **Lighting match:** photogrammetry has baked daylight. Render it with `MeshBasicNodeMaterial`, scale its brightness by the sky's current illuminance, and apply the same aerial perspective and LUT. At night, darken it to about 5 % and overlay emissive points from OSM streetlights and building windows. Accept mismatched shadows beyond 2 km.
4. **Coordinates:** each session picks an ENU origin at the start lat/lon. Rebase when the car is more than 2 km from the origin. 3DTilesRendererJS's `ReorientationPlugin` supports the same origin, and takram's `AtmosphereContext` takes the ECEF→world matrix.
5. **"Anywhere" bootstrap**, Hop.Earth-style: on choosing a new place, a worker fetches Overture/OSM extracts for a 3 × 3 km area (Overture GeoParquet via DuckDB in our bake tool, or a pre-baked tile server) and builds Ring 0–1 in about 5–15 s **[estimate]**. Ring 2 comes from the provider. Cache our own tiles freely (we own them); never cache Google's.
6. **Landmarks:** as Teleoperator does, allow per-landmark hand-made overrides (`assets/lm/<id>/` facade atlas or GLB) keyed by OSM ID, for example Finglas Village, Yaba market, the Third Mainland Bridge.

---

## 8. Key risks and open questions

- **Google tiles in Ireland:** blocked for new EEA-billed projects. Do not build anything that depends on them. If ever used, it needs a non-EEA billing entity, and the ToS §3.2.3(e) "non-Google map" question must be settled first.
- **Lagos photogrammetry:** unverified. Check Google Earth web around Yaba and Victoria Island. If it is absent, the self-baked far field is the only option there anyway.
- **3DTilesRendererJS on `WebGPURenderer`:** not explicitly documented. Prototype before committing (material plugins may be WebGL-only).
- **takram atmosphere at street scale:** designed for globe and ECEF scenes. Verify precision with our local frame and that it coexists with SunLight CSM.
- **G29 FF protocol bytes:** re-verify against `hid-lg4ff`. The G29 must be in PS3 mode on a Mac.
- **Performance on base M1:** budget 16.6 ms. CSM, TRAA, GTAO, aerial perspective and bloom together come to roughly 6–9 ms **[estimate]**, which leaves room for geometry. SSGI does not fit.

## Sources

- three.js r186 source (tag `r186`): https://github.com/mrdoob/three.js — `examples/jsm/lights/SunLight.js`, `lighting/ClusteredLighting.js`, `lighting/LightProbeGrid.js`, `tsl/display/{SSGINode,SSRNode,TRAANode,TAAUNode,MotionBlur}.js`, `generators/CityGenerator.js`
- Teleoperator bundle: https://teleoperator.mindblown.ai/ (`/?mb=game`, `app.js`); Mindblown: https://mindblown.ai/
- takram three-geospatial: https://github.com/takram-design-engineering/three-geospatial, WebGPU storybook https://takram-design-engineering.github.io/three-geospatial-webgpu
- 3DTilesRendererJS: https://github.com/NASA-AMMOS/3DTilesRendererJS (plugins API `src/three/plugins/API.md`)
- realism-effects https://github.com/0beqz/realism-effects · N8AO https://github.com/N8python/n8ao · postprocessing https://github.com/pmndrs/postprocessing · three-gtvbao https://github.com/norio/three-gtvbao · three-ss-fidelity https://github.com/bhouston/three-ss-fidelity · nanite-webgpu https://github.com/Scthe/nanite-webgpu · three-mesh-bvh https://github.com/gkjohnson/three-mesh-bvh
- Google pricing and usage: https://developers.google.com/maps/documentation/tile/usage-and-billing · https://developers.google.com/maps/billing-and-pricing/pricing · policies https://developers.google.com/maps/documentation/tile/policies · EEA https://developers.google.com/maps/comms/eea/map-tiles · ToS https://cloud.google.com/maps-platform/terms · https://blog.afi.io/blog/what-is-the-google-photorealistic-3d-tiles-api/ · https://github.com/vvoovv/blosm/issues/644 · Cesium/Google terms https://cesium.com/legal/terms-for-google/
- Driving on tiles: https://community.cesium.com/t/driving-in-cesium-for-unreal-world/41753 · https://80.lv/articles/ue5-powered-game-prototype-that-lets-one-explore-the-enitre-world-in-3d · https://hitmarker.net/news/explore-the-entire-planet-in-an-unreal-engine-game-demo-with-google-tiles-520737 · https://cesium.com/blog/2025/11/10/forensic-rock-accelerates-accident-reconstruction/
- Hop.Earth: https://www.dexerto.com/gaming/genius-new-browser-game-lets-you-drive-anywhere-on-earth-using-real-world-map-3395030/ · https://supercarblondie.com/hop-earth-free-world-map-driving-game/
- streets-gl https://github.com/StrandedKitty/streets-gl · https://wiki.openstreetmap.org/wiki/Streets_GL · OSMBuildings https://github.com/OSMBuildings/OSMBuildings · Cesium OSM Buildings https://cesium.com/platform/cesium-ion/content/cesium-osm-buildings/ · Bing retirement https://learn.microsoft.com/en-us/bingmaps/articles/
- Dublin LiDAR https://archive.nyu.edu/handle/2451/38596 · Google Open Buildings 2.5D https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_Research_open-buildings-temporal_v1
- Physics: Rapier https://rapier.rs/javascript3d/classes/DynamicRayCastVehicleController.html · https://github.com/dimforge/rapier.js · Jolt https://github.com/jrouwe/JoltPhysics.js · Jolt tuning https://hub.jmonkeyengine.org/t/jolt-vehicle-tuning-guide/49569 · cannon-es https://github.com/pmndrs/cannon-es · ammo.js https://github.com/kripken/ammo.js · tread https://github.com/aunyks/tread · VDrift https://github.com/VDrift/vdrift · OpenDS https://github.com/neoana/OpenDS · CARLA https://github.com/carla-simulator/carla · FF background https://support.forza.net/hc/en-us/articles/360012861313-FM7-Wheel-Introduction · lg4ff https://codebrowser.dev/linux/linux/drivers/hid/hid-lg4ff.c.html
- Narration: OpenTripMap https://dev.opentripmap.com · Overture places https://docs.overturemaps.org/guides/places · Wikipedia REST https://www.mediawiki.org/wiki/API:REST_API/Reference · kokoro-js https://www.npmjs.com/package/kokoro-js · piper1-gpl https://github.com/OHF-Voice/piper1-gpl · Web Speech https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis
- Electron: https://electronjs.org/docs/latest/tutorial/devices · https://electronjs.org/blog/electron-40-0 · https://www.electron.build/docs/architecture · https://packages.electronjs.org/packager/v20.3.0/interfaces/Options.html · ad-hoc signing https://github.com/electron-userland/electron-builder/issues/5850
