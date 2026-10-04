# 17: BoundlessNYC teardown, and open digital twins we could use

Date: 2026-10-04. Two parts: a teardown of
[mkturkcan/boundless-nyc](https://github.com/mkturkcan/boundless-nyc) (cloned
at commit `b4e36e0`, one squashed commit dated 2026-10-04, v0.2.0), and a
short survey of open 3D city data, with Ireland first. Tokyo (jeantimex/tokyo)
is covered in `16-tokyo-teardown.md`, so it isn't repeated here. Items already
on the list in 16 §4 are referenced, not restated.

We only take techniques. BoundlessNYC's code is MIT, but our rule is still to
take no code.

Marking: **[unverified]** means I couldn't check it from here (data.gov.ie,
docs.3dbag.nl and data.mendeley.com are blocked by this sandbox's proxy) or
it comes from memory.

## 1. What BoundlessNYC is

A city-scale digital twin of Manhattan, the Bronx, Brooklyn and Queens,
compiled from NYC municipal records, built for **synthetic training data for
perception** (CARLA-style). It isn't a driving game. Parts:

- `boundlessjs/`: a three.js r185 **WebGL2** client (Vite, plain JS). It
  streams tiles, simulates traffic and pedestrians, and renders RGB plus
  semantic, instance and depth ground truth.
- `boundlessjs/tools/pipeline/`: a Node "city compiler" (`fetch.mjs`,
  `compile.mjs` at 5,264 lines, `classify.mjs`, `rooftops.mjs`, …) that turns
  open data into binary tiles.
- `server/`: an Electron host that steps the client in fixed time and serves a
  TCP API. `PythonAPI/` is a CARLA-like Python client (spawn actors, attach
  sensors, `world.tick()`).
- Export of a recorded take to OpenUSD for Blender Cycles.
- A browser demo on a Hugging Face Space, and the compiled city, models and
  textures (3.1 GB, 3,738 files) in a **public** Hugging Face dataset
  (`mehmetkeremturkcan/boundless-nyc`; the README says "private", but the HF
  API shows `private: false`).

**Licences:** code MIT. Docs and figures CC BY 4.0. The compiled city is
**ODbL** (it contains OSM data). Vehicle, prop and pedestrian models are
CARLA's **CC BY 4.0**. Rocketbox avatars are MIT. Textures and HDRIs are CC0
(Poly Haven, ambientCG). Fonts are OFL or Apache. **Catch:** the CARLA 0.10
"photoreal" pedestrians contain Epic **MetaHuman** parts. The author flags
these as unusable for datasets or AI training and ships a procedural
fallback. `LICENSING.md` is a model of how to document a mixed-licence
project.

**It does not use** LiDAR point clouds, photogrammetry meshes, Gaussian
splats, or generative models at runtime. Everything is procedural geometry
driven by records. Imagery is used in only two places: NAIP near-infrared
orthophotos to find Central Park tree crowns (vegetation index plus
watershed segmentation), and NY State orthos for measuring landmarks in plan.
Google Street View is listed as "evaluated and not used". The author viewed
it only for comparison, which is stricter than many projects.

## 2. Data and pipeline

The core idea is to **join every building to several municipal tables by ID**,
so its look comes from records, not random numbers:

| Source (NYC Open Data, public) | Fields used | Becomes |
|---|---|---|
| Building Footprints | polygon, roof height, ground elevation, year, BIN, BBL | massing, base height |
| PLUTO (tax lots, by BBL) | floors, year built, building class, land use, historic district | facade **typology** (tenement, prewar, rowhouse, glass, loft…) and palette |
| DOB facade inspection filings (by BIN) | exterior wall material | real wall material per building (masonry, terracotta, glass, metal…) |
| Street Centerline (CSCL) | width, travel lanes, parking lanes, one-way, speed, bike lane, level codes | carriageway, kerbs, footpaths, markings, lane graph, bridge ramps |
| Street Tree Census + daily Forestry points | species, trunk diameter, position | trees by species archetype, tree pits |
| Hydrants, bus shelters, LinkNYC, bike racks, subway entrances, bus lanes | positions | instanced furniture |
| OSM (Overpass) | `building:colour`, missing footprints, micro-maps of parks and campus | colour, gap-fill, landmark detail |
| NYC 3D model (CityGML LoD2, 916 MB) | real roof shapes for a few landmarks | "real roof, procedural walls" hybrid |
| FHWA MUTCD PDFs (public domain) | arrow and letter outlines | road arrows and lettering extracted from the official vectors |

Every source has its own row in `boundlessjs/DATA_SOURCES.md` (dataset ID,
cache file, fields, licence, and what was tried and rejected).

**Compiler output.** The output is 512 m near tiles (2,884) and 2,048 m far
tiles (210). The tile format is a magic number, then a JSON header listing
the sections, then aligned typed-array sections. Contents: building rings and
per-building attribute records; road records (class, width, lanes, parking,
level, speed, name, junction "mouth" distance per end); furniture records (20
bytes each); a terrain grid; and ground "soups" (asphalt, footpath, kerb,
white, yellow and green paint, grass, brick, gutter, red bus lane), already
triangulated. Far tiles hold int16 positions at 1/8 m with **baked
directional shading** in the vertex colours, plus a 33×33 terrain grid.

**Terrain is flat by default.** Real terrain (IDW over building bases plus
USGS 3DEP) is behind `TERRAIN=real`. The comment says the flat plane removes
clipping and gaps between overlays. That works for a sensor-data sim. We
can't do it, because the hill start needs real slopes.

**Junctions.** Endpoints are re-centred per node. Kerb corners are the
intersection of adjacent road edges, with a Bézier kerb return and a
per-stub "mouth" distance that caps, kerbs, footpaths and crossings all
share, so they meet without gaps. Footpaths are then made **vectorially from a
signed distance field**: the union of carriageways and junction caps gives the
kerb line, marching squares extracts contours on a world-aligned grid (so
tiles join), then Douglas–Peucker, earcut, and kerb faces extruded along the
road side. **Footpath width is measured** by casting rays from the kerb to
the nearest building footprint (median of three samples) and clamping to what
NYC builds.

## 3. Rendering and streaming

- **Streaming** (`world/streamer.js`): near tiles within 1 km (unloaded past
  1.32 km), 5 fetches at once, **one tile assembled per frame**, and far tiles
  out to 13 km. Far buildings inside the near ring are discarded in the shader
  by a "near mask" once the near tiles are in. Late subscribers (pedestrian
  graph, traffic) are **replayed** every tile already loaded.
- **Facades**: one merged mesh per tile, drawn by a shader driven by the
  per-building record (floor height, window width, shop height, blind party
  walls). Within 150 m, the nearest ~48 buildings get "dressed" with real
  geometry (window reveals, sills, lintels, AC units, cornices, shopfronts)
  from a procedural kit, and a per-tile 256×256 **hide texture** discards the
  shader facade for exactly those buildings. Repeated parts are pooled
  `InstancedMesh`es.
- **City-scale sky visibility (AO) bake**: in the compiler, building heights
  are rasterised to a 2048² grid over the whole city. A horizon scan (8
  azimuths, radii 12 to 190 m, eye 8 m up) gives sky visibility, which gets a
  3×3 blur. Terrain height goes into a second channel. At runtime, every
  material samples it by world XZ and scales **indirect light only**. AO fades
  out with height above the local street, and up-facing surfaces skip it. At
  night the height ramp is inverted, because ambient light then comes from
  the street. This is the cheap stand-in for Lumen-style GI.
- **Instancing**: a custom culled instancer, one `InstancedMesh` per pool.
  Each frame it copies only in-frustum instances into the draw buffer, keeps a
  second set for the near shadow cascade (shown only during the shadow pass),
  and uses low-poly proxies for the cached far cascade. They dropped
  `BatchedMesh` because `WEBGL_multi_draw` is emulated on ANGLE/D3D11: 45k
  driver draws per pass, about 250 ms per frame.
- **Textures**: CC0 PBR sets packed as **KTX2/Basis** (ETC1S for colour and
  roughness, UASTC for normals). VRAM fell from ~1.2 GB to ~210 MB. Wall
  photo textures are **mean-normalised and multiplied by the per-building
  palette colour**, the same trick our `facade.ts` uses (`avg`).
- **Lighting and post**: cascaded shadows, where the far cascade re-renders
  only on sun movement, 64 m of travel or tile changes. Also TAA, n8ao, LUTs,
  HDRI skies that relight the scene (sun found from the brightest texel), and
  weather (rain or snow as camera-wrapped instanced quads, puddles, wet
  facades, roof snow, all on one set of uniforms).
- **Performance, honestly**: their own notes give 38 ms per frame (~26 fps)
  at Harlem 125th St on an RTX 3060 laptop, with 563 draws and 16 M
  triangles, down from 3.2 fps. It is heavy. The target is offline-quality
  dataset frames, not 60 fps driving.

## 4. Traffic and simulation

- IDM car following (a 1.9, b 2.6, T 1.15 s, s0 2.2 m) on a lane graph built
  from CSCL lane counts, with turn-ratio routing, U-turns at dead ends and
  jam-aware junction entry.
- **Signals are one global 40 s clock** with two phases (N–S, then E–W, with
  amber and all-red), chosen by the axis a signal head faces. That suits the
  Manhattan grid and is wrong anywhere else. Our SUMO programmes are better.
- **Lane-change kinematics** (worth copying): a car moves sideways only while
  moving forward, at most v·tan 8°. The body yaw follows the real motion
  (rear axle dragged along), so a lane change takes about 23 m and a stopped
  car never crabs sideways. They measured it: before the fix, a share of
  cars sat more than 2° off their lane, mostly mid lane change.
- Pedestrians on a footpath graph, crossing only when the remaining WALK time
  lets them finish.
- No player car physics. The vehicles are kinematic actors under API control,
  and there is a legacy grapple-gun "game mode". **On driving feel we have
  nothing to learn from it.**

## 5. Process and tools (the part most worth copying)

- **Every visual change sits behind a URL flag** (`?lb14=0`, `?cs34=0`, …)
  that restores the old behaviour, so A/B shots are taken in one session. The
  flipside: `materials.js` is 6,801 lines with dozens of flags that are never
  retired. Copy the habit, add a rule to delete a flag once it has won.
- **Measured fps had a bug we share.** Their fps averaged a dt clamped to
  50 ms, so it showed 22 to 25 fps while the real rate was 3.2. **Ours has
  the same flaw**: `main.ts` clamps `dt` to 0.1 s, then computes
  `fps = frames / sum(clamped dt)`, so below 10 fps it reports about 10, and
  `adaptQuality` acts on the wrong number. Fix: count frames against
  unclamped wall time.
- **Headless instruments**: per-layer fps and triangle counts (hide one layer
  at a time); a **z-fight hunter** that renders the same view twice with the
  camera dollied 1.5 cm, diffs the frames, and raycasts the worst tiles to
  name the fighting meshes; a **temporal flicker hunter** (short moving
  sequences, to catch shadow shimmer, TAA ghosting and LOD pops); and a tile
  differ that compares two compiled sets before swapping them.
- **Calibration against reference photos**: luma and RGB of shade and sun
  measured on Wikimedia Commons photos and matched in renders. That beats
  tuning by eye.
- **Typology docs** (`docs/typology/*.md`): per building type, measured
  dimensions and sampling weights (lot widths, floor-to-floor, stoop height,
  siding colour shares). We should write the same for Finglas house types
  before modelling them (roadmap 13).

## 6. Compared with our game

| Area | BoundlessNYC | Us | Verdict |
|---|---|---|---|
| Data joins | Footprint ↔ tax lot ↔ facade filing ↔ OSM colour, by ID | Overture footprints, a guessed height, class mostly thrown away | **They win.** Ireland has analogues (§8). |
| Roads | CSCL lanes and widths; SDF footpaths; widths measured from the building line | SUMO lanes and junction shapes; fixed footpath width | Our lane logic is better for an examiner. Their kerb and footpath geometry is better. |
| Streaming | 512 m tiles, 1 km near ring, far LOD to 13 km, one assembly per frame | Whole place loaded; 200 m chunks hidden by distance | Fine for Finglas; needed for the explorer (16 §4 item 8). |
| Facades | Shader facade plus near-field real geometry, hide-mask swap | One TSL shader with codes; no real geometry | Their near-field swap is the pattern for roadmap 13. |
| Ambient light | City sky-visibility bake | Per-vertex AO and GTAO | **Adopt the bake** (roadmap 12). |
| Instancing | Culled per-pool instancing with shadow sets | Merged chunks; a few `InstancedMesh`es | Needed once furniture density goes up (roadmap 15). |
| Signals | Global 40 s two-phase clock | SUMO programmes | **Ours wins.** |
| Traffic motion | IDM; speed-bound lane changes | IDM-like; lateral slide at a fixed 1.3 m/s even when stopped | Adopt their lane-change rule. |
| Player physics, FFB | None | Pacejka, DSG, G29 FFB | Ours; nothing to learn. |
| Backend | WebGL2 with string-patched shaders | WebGPU with TSL | Ours is newer; port ideas, not shader code. |
| Terrain | Flat by default | Flat today, lidar planned | Neither; we need slopes. |

I checked one of their fixes against our three r186 and found it doesn't
apply: "three sorts opaques by object origin, and baked world-space meshes all
sit at the origin". The WebGPU `Renderer` in r186 sorts by the geometry's
bounding-sphere centre (`Renderer.js` around line 3300), so our origin-placed
chunks already sort correctly.

## 7. Ranked: what to adopt

New items only (16 §4 covers window bays, class and floors into the bake,
interior mapping, the sky environment map, the elevation recipe, texture
arrays, worker meshing, shop signs and prop LOD).

1. **Lane changes bound to forward speed** (`trafficnet.ts`, the `c.lat`
   easing at lines ~558 and ~599). Cap the lateral rate at `v·tan 8°` instead
   of a fixed 1.3 m/s, and turn the body by `atan(lateral / forward)`. NPCs
   stop crabbing sideways in queues, which a learner watches closely.
   *Effort: 1–2 hours.*
2. **Fix the fps meter** (`main.ts` ~554/647): count frames against
   unclamped wall time, keep the clamped dt for physics only. Otherwise
   adaptive quality is blind below 10 fps. *Effort: 15 minutes.*
3. **Sky-visibility bake** (roadmap 12). In `bake_world.py`, rasterise
   building heights to a grid (2 to 4 m cells for Finglas), horizon-scan 8
   azimuths at 5 to 7 radii, and write an RG8 texture (visibility, ground
   height) next to the `.bin`. In `facade.ts`, sample it by world XZ, scale
   indirect (hemisphere and environment) light only, fade it with height
   above ground, and skip up-facing roofs. It's one more sampler, so count
   against the 16 limit. *Effort: 0.5–1 day.*
4. **Irish record joins, the PLUTO equivalent** (feeds 16 §4 item 3).
   Tailte Éireann **HVD Buildings** (Prime2 building polygons) and **HVD
   Building Groups** (which buildings form a named terrace), both CC BY 4.0
   since 2025/26, plus GSI lidar **nDSM** (DSM minus DTM) for real heights
   per footprint, replacing Google Open Buildings 2.5D. Terrace membership
   matters a lot in Finglas: party walls without windows, shared roof lines,
   end-of-terrace gables. Optionally CSO Census small-area "period built"
   for a typology prior (1950s–70s council estates and so on).
   *Effort: 1–2 days. Downloads must run on the owner's machine (data.gov.ie
   is blocked here).*
5. **Furniture and signals from Dublin City Council point data**: Public
   Lighting DCC (lamp positions, CC BY), Tree DCC (species, height, spread,
   stem diameter; CC BY), and DCC traffic signal and SCATS site locations to
   check SUMO's guessed signals (already in research 13). Same pattern as
   their tree census to species archetype. Finglas is mostly in the DCC area.
   Check the north edge, which may be Fingal. *Effort: 1 day.*
6. **A/B flags and headless instruments.** Adopt the `?feature=0` convention
   for each new visual change, with a rule to remove the flag once decided.
   Add a Playwright script for per-layer draw and triangle counts and a
   z-fight dolly diff. SwiftShader is deterministic enough for the diff;
   check this. This will pay off once lidar draping (16 §4 item 6) starts
   fighting the road paint. *Effort: 0.5 day for the flags and counts, 1 day
   for the z-fight tool.*
7. **Footpath and verge widths from the building line.** Cast rays from the
   kerb to the nearest footprint (or garden wall from OSM) and take the
   median. Finglas streets are kerb, footpath, grass verge, then a wall, so
   the widths vary street by street. Use the SDF contour method only if the
   SUMO junction shapes leave gaps at corners. *Effort: 1–2 days, after the
   OSM lane work (roadmap 3).*
8. **Typology notes for Finglas house types** before Blender work: measured
   lot widths, floor heights, porch and canopy sizes, render and brick shares,
   and window counts per type (council terrace, semi-d, 1970s estate, shop
   parade). These become bake rules and Blender briefs. *Effort: half a day
   of research per type.*
9. **Culled instancing with a shadow-caster set** when furniture goes in
   (roadmap 15, 4,363 lamps plus trees): compact in-frustum instances on the
   CPU, with a separate set for the shadow box. **[unverified]** whether
   three r186's `BatchedMesh` on WebGPU/Metal has the ANGLE problem. Measure
   before choosing. *Effort: 1 day.*
10. **Far LOD tiles** for the explorer: int16 positions, baked side shading,
    and a near mask that discards far buildings once near ones load. Not
    needed for Finglas. *Effort: 2 days, later.*
11. **A per-dataset provenance table** like their `DATA_SOURCES.md` (ID,
    fields used, licence, attribution line, what was tried and rejected). It
    could extend `public/tex/CREDITS.md` or the table in research 13.
    *Effort: 1 hour.*

## 8. What not to adopt

- **The global 40 s signal clock** and anything else that assumes a grid.
- **Flat terrain by default.** We need the hill start.
- **WebGL2 `onBeforeCompile` string patching.** We're on TSL/WebGPU. Port the
  maths only.
- **Hand-coded landmark modules** (Central Park, 125th St, Times Square:
  dozens of files of bespoke builders). It's months of work per place and
  doesn't generalise to new places.
- **The CARLA-style TCP/Python API and perception outputs.** They aren't our
  product.
- **CARLA pedestrians (MetaHuman).** CARLA vehicles are CC BY 4.0 and would
  pass our licence rule, but they're US left-hand-drive cars with real brand
  shapes. Keep them as a stopgap at most, credited. Our Blender path is better.
- **4K HDRIs and a 3 GB asset bank.** That's wrong for a desktop app the owner
  downloads.
- **Flags that never die.** Their materials file shows where that ends.

## 9. Open 3D city data: survey

"Many open digital twins exist" is true for **data**: national and city 3D
building sets are common in Europe and Japan. It's much less true for **open
engines** that drive or simulate a real city. BoundlessNYC and Tokyo (16) are
rare. Streets GL and OSM2World are the other open OSM renderers worth knowing
**[licences unverified: Streets GL MIT, OSM2World LGPL, from memory]**.

Licence key against our rule (CC0, CC-BY or MIT; ODbL already accepted for
OSM-derived data):
✅ compatible · ⚠️ usable with care · ❌ not compatible.

| Dataset | Offers | Format | Licence | For us |
|---|---|---|---|---|
| **GSI Open Topographic Lidar** (GSI, OPW, TII, NYU, others) | DTM and DSM, 1 m (GSI) or 2/5 m (OPW flood projects, "main urban areas") | GeoTIFF | ✅ CC BY 4.0 ("Contains Irish Public Sector Data (Geological Survey Ireland)…") | **Yes**: terrain, plus nDSM building heights and tree crowns. Finglas coverage **[unverified]**: check in the GSI viewer. |
| **Tailte Éireann HVD Buildings / Building Groups** | Prime2 building polygons; terrace grouping | GeoJSON, GPKG, FGDB, CSV | ✅ CC BY 4.0 (updated 2026-01-20) | **Yes**: better footprints than Overture, plus terraces. This corrects research 13, which said Prime2 was mostly not open; the HVD layers now are. Attributes beyond geometry **[unverified]**. |
| **DCC Tree, Public Lighting, Traffic Signals/SCATS** | Points with attributes | CSV, SHP | ✅ CC BY (smartdublin.ie) | **Yes**: furniture, trees, signal check, traffic volumes. |
| **NYU 2015 Dublin aerial lidar and photogrammetry** | 300 pts/m², oblique images, ~2 km² city centre | LAZ, LAS, GeoTIFF | ✅ CC BY 4.0 | Not Finglas. Useful only for a city-centre explorer area or splat experiments. |
| **DCC Docklands SDZ 3D model** | LoD2 plus some LoD3 buildings (2018) | FBX | ❌ **CC BY-NC 4.0** | No (non-commercial). |
| **CSO Census 2022 small-area stats** | Dwelling type, period built per small area | CSV | ✅ CC BY 4.0 **[unverified]** | Typology prior per area. |
| **Overture** (in use) | Buildings, transport (ODbL); places (CDLA-Permissive-2.0) | GeoParquet | ✅ / ODbL as accepted | Already used. Keep `class`, `num_floors`, facade fields (16 §4 item 3). |
| **OSM / OSM Buildings** | Footprints, `building:levels`, `roof:shape`, colours | PBF, Overpass, GeoJSON tiles | ODbL (accepted) | Already planned for lanes. Read the Simple 3D Buildings tags too. |
| **Google Open Buildings 2.5D** (in use) | Heights from Sentinel-2 | COG | ✅ CC BY 4.0 / ODbL | Fallback outside lidar coverage. |
| **Copernicus GLO-30 DEM** | 30 m surface model | GeoTIFF | ⚠️ Copernicus DEM licence (free, attribution) | Fallback only (in research 13). |
| **PLATEAU** (Japan) | LoD1–3 buildings, roads, bridges, some textures | CityGML, 3D Tiles, FBX, OBJ, MVT | ✅ CC BY 4.0-compatible (also ODbL / ODC-BY parts) | Japan only. See 16 for how Tokyo uses it. |
| **3D BAG** (Netherlands) | All ~10 M buildings at LoD1.2/1.3/2.2 from AHN lidar | CityJSON, GPKG, OBJ, WFS | ✅ CC BY 4.0 | A template for what we would build from GSI lidar for Ireland. |
| **Helsinki 3D** | Semantic CityGML 2.0 plus a textured reality mesh | CityGML, mesh | ✅ CC BY 4.0 | An explorer place candidate with photogrammetry. |
| **Berlin LoD2** | All buildings, LoD2 | CityGML | ✅ dl-de/zero-2.0 (no conditions) | Explorer candidate. |
| **Hamburg LoD2** | All buildings, LoD2 | CityGML | ⚠️ dl-de/by-2.0 **[unverified]**: attribution, similar to CC BY | Probably fine; check the text. |
| **NYC 3D Building Model (DoITT)** | Citywide LoD2 (2014) | CityGML, multipatch | ✅ NYC Open Data terms (free use) | Only if we add NYC. BoundlessNYC already compiles it. |
| **swissBUILDINGS3D, Vienna, Zürich** | National or city LoD2/3 | various | ✅ open government licences **[unverified]** | Explorer candidates. |
| **Google Photorealistic 3D Tiles** | Photogrammetry of most cities | 3D Tiles via the Map Tiles API | ❌ No offline use, caching or extraction; must stream with Google attribution | **No.** It can't be baked, and it's Google imagery-derived, which is in the spirit of our Street View ban. |
| **Cesium ion** (World Terrain, OSM Buildings tiles) | Streamed terrain and buildings | 3D Tiles | ⚠️ ion terms of service; OSM Buildings data is ODbL | No: a service dependency. Use the OSM data directly. |
| **Mapillary** | Street photos, detections | API | ⚠️ CC BY-SA 4.0 | **Ask the owner.** Share-alike isn't on our list, but roadmap 13 plans to use it. |

**What our bake pipeline can take**: GeoTIFF (lidar, via `rasterio`, already
used in `bake_world.py`), GeoJSON/GPKG (Tailte Éireann, via `duckdb` spatial
or shapely, already used) and CSV points (DCC). CityGML and CityJSON would
need a parser. That's only worth it for a non-Irish explorer place
(Helsinki, Berlin, Netherlands). In that case CityJSON (3D BAG) is far simpler
than CityGML XML.

## Sources

- BoundlessNYC repo (README, LICENSE, LICENSING.md, DATA_SOURCES.md,
  BUILDING.md, docs/, source): https://github.com/mkturkcan/boundless-nyc
- HF dataset (checked public via API):
  https://huggingface.co/datasets/mehmetkeremturkcan/boundless-nyc
- GSI open lidar: https://data.gov.ie/dataset/open-topographic-lidar-data ·
  OPW release: https://www.gov.ie/en/office-of-public-works/press-releases/opw-releases-lidar-captured-as-part-of-flood-risk-management-projects-as-open-data
- Tailte Éireann HVD Buildings: https://data.gov.ie/dataset/high-value-dataset-buildings
  · Building Groups: https://data.gov.ie/en_GB/dataset/high-value-dataset-building-groups
- DCC Tree: https://data.smartdublin.ie/dataset/tree-dcc · Public Lighting:
  https://data.gov.ie/dataset/street-lighting-dublin-city · SCATS:
  https://data.smartdublin.ie/dataset?tags=SCATS
- Docklands 3D model (CC BY-NC): https://data.smartdublin.ie/dataset/3d-data-hack-dublin-resources
- NYU Dublin lidar: https://archive.nyu.edu/handle/2451/38684
- Overture licences: https://overturemaps.org/overture-january-2024-release-notes/
- PLATEAU: https://www.mlit.go.jp/plateau/start-guide/ ·
  https://wiki.openstreetmap.org/wiki/MLIT_PLATEAU
- 3D BAG: https://3dbag.nl/en/download ·
  https://wiki.openstreetmap.org/wiki/File:3DBAG_CC_BY_4.0_Waiver_signed_2026-06-02_public.pdf
- Helsinki 3D: https://www.hel.fi/en/decision-making/information-on-helsinki/maps-and-geospatial-data/helsinki-3d
- Berlin LoD2: https://gdi.berlin.de/geonetwork/srv/api/records/3c7c49af-00a4-3bcd-bc00-20e7f0f1b7bf
- Google Map Tiles API policies: https://developers.google.com/maps/documentation/tile/policies
