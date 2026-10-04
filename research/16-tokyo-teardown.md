# 16: Teardown of jeantimex/tokyo ("Procedural Tokyo")

Date: 2026-10-04. Source: https://github.com/jeantimex/tokyo, cloned at commit
`def9476` (one shallow commit, pushed today). About 8,600 lines of JavaScript:
`src/` (client, ~5,500) and `tools/pipeline/` (compiler, ~2,800). I read all of
the client and the important parts of the compiler. The live demo
(https://jeantimex.github.io/tokyo/) is **blocked by our network proxy**
(github.io CONNECT refused), so nothing here comes from running it; it all comes
from the source. The compiled tiles are not in the repo (they are rebuilt from
raw data, several GB per area), so I couldn't measure tile sizes myself.

Licence: `package.json` says `"license": "MIT"` and the README says "Code: MIT",
but **there is no LICENSE file** in the repo. That doesn't change anything for
us, because we only take techniques. Data terms it lists: PLATEAU (MLIT Japan),
GSI elevation and aerial photos, OSM (ODbL; a compiled area is a derived
database), Poly Haven textures (CC0), ez-tree (MIT), takram three-geospatial
(MIT).

## 1. What it is

It's a **city viewer, not a driving game**. You get a free orbit/pan camera
(three's `MapControls` plus WASD) over four 3.4 x 2.8 km areas: Tokyo Station,
Shiba (Tokyo Tower), Shibuya and Fujinomiya (with Mt Fuji as a backdrop). There
is no player vehicle and no physics. The cars are ambient traffic that keeps to
a radius around the camera.

- **Real data:** PLATEAU CityGML (building footprints, measured heights,
  storeys, use codes, LOD2 roof/wall shells, aerial roof and wall photo
  textures, road surface polygons, bridges, street furniture, vegetation),
  OSM via Overpass (road graph with lanes, one-way, maxspeed and layer;
  railways; parks and water; trees; crossings; signals; named shops and POIs;
  `building:colour`/`building:material`), and GSI Japan's DEM (5 m, with
  10 m filling gaps) plus its seamless aerial photo.
- **Generated:** everything the data doesn't carry: facades and windows,
  interiors, rooftop plant, balconies, road paint, utility poles and wires,
  traffic, night lighting, water ripples, signs, birds.
- **No Google tiles, no Street View, no photogrammetry meshes.** The
  "realism" comes from real geometry plus a lot of procedural shading.
- **Renderer:** `THREE.WebGLRenderer` (three 0.186), **not WebGPU**. All
  material work is GLSL string patching through `onBeforeCompile`, so none of
  it ports directly to our TSL node materials. The ideas port; the code doesn't.
- The README says it follows BoundlessNYC's architecture: an offline
  compiler that writes compact binary tiles, and a client that streams and
  meshes them.

## 2. How it works

### Data pipeline (`tools/pipeline/`)

- `config.mjs`: an area is a centre plus a block of Japanese 3rd-level grid
  squares (JIS X 0410, about 1 km each; `src/shared/geo.js` does the mesh
  codes). Adding a city is one entry.
- `fetch.mjs`: PLATEAU per grid square through the PLATEAU data catalogue API
  (deduplicated by `gml:id`, because Tokyo lists one square under every ward it
  touches); four Overpass queries with endpoint fallback (roads/rail, land,
  extras, POIs); GSI DEM PNG tiles; GSI aerial photo at zoom 17 (~1 m/px).
  Raw size per area: 0.2 to 3.6 GB, mostly PLATEAU photos. The User-Agent is a
  fixed project string with no personal data.
- `compile.mjs` (583 lines) writes the per-area output. Its parts:
  - `terrain.mjs`: decodes GSI's PNG elevation encoding into **one Float32
    height grid at 5 m for the whole area** (`terrain.bin`). Every tile samples
    the same grid, so there are no seams. Building bases are checked against
    the terrain and the error is logged (median 0.1 m).
  - `citygml.mjs`: a streaming regex reader of CityGML (no XML library).
  - `roadsplit.mjs`: where PLATEAU gives only the whole right-of-way outline,
    it splits it into carriageway (the OSM centreline buffered by lanes x 3 m,
    clipped to the outline) and sidewalk (the remainder), using
    `polygon-clipping`.
  - `markings.mjs`: lane lines placed by **measuring the real carriageway**.
    It samples every 2.5 m along the OSM line, casts sideways to the kerb on
    both sides, and takes the true centre and width. It drops samples whose
    width jumps (junctions, bays), uses OSM `turn:lanes` for arrows (with a
    default layout per lane count), and adds stop lines and painted speed
    limits.
  - `roadprofile.mjs`: road heights. Street bridges over a dip run straight
    bank to bank. The expressway and its ramps are lifted by OSM `layer`
    (7/11/15.5/20 m clearance). Ramps are graded to a maximum of 6% by
    iterating until nothing changes, and a node shared with a ground street is
    pinned to the ground, so ramps always land.
  - `landscape.mjs`, `furniture.mjs`, `extras.mjs`, `signs.mjs`, `rails.mjs`,
    `meshes.mjs`, `photos.mjs`: trees, poles and wires, parked cars, bus stops
    and other props; shop signs from OSM names; PLATEAU photo atlases per tile
    (roofs at 2048, walls at 1024, plus a 512 "small" version of each).
- Output (`public/tiles/<area>/`): `manifest.json`, `terrain.bin`, one binary
  `t_x_z.bin` per **256 m tile**, `roads.json` (graph with a level per point),
  `rails.json`, `structures.json`, optional per-tile PLATEAU meshes
  `x_x_z.bin` and photo atlases. The deployed site is about 400 MB for the
  four areas, aerial photos included.
- Tile format (`src/shared/tileformat.js`): one little-endian binary format
  with its encoder and decoder in the same file, shared by Node and the
  browser. It holds buildings (usage, storeys, flags, base, height, a hint
  packing OSM colour and material, footprint polygons, optional LOD2
  surfaces with u16 photo UVs), ground areas (kind and code), props (kind,
  variant, u16 rotation, x, z, scale), wires, walls and barriers, and signs
  (with UTF-8 text). There is a version check, and `npm test` round-trips it.

### Client streaming and meshing

- `src/world/streamer.js`: keeps 256 m tiles within `radius` (default 900 m)
  of the camera focus. It loads nearest first and unloads beyond radius plus
  250 m hysteresis. Tiles go to a **pool of 2 to 4 Web Workers**
  (`tileWorker.js`) with at most 2 jobs per worker in flight. The worker
  fetches, decodes and meshes the tile, then sends back typed arrays as
  transferables. The main thread only wraps them in `BufferGeometry`.
  Per-tile LOD by distance from the eye to the tile's nearest point: tree
  models within 160 m (half that in dense woods), sign text within 230 m,
  full-resolution photo atlases within 600 m (roofs) and 900 m (walls),
  otherwise the small ones. Every switch has a 1.25 to 1.3 margin so it
  doesn't flicker.
- `src/world/meshing.js`: pure functions with no three.js import, so the same
  code runs in the worker and in Node tests. Each tile becomes about 7 meshes
  (terrain, roads, paint, decals, buildings, PLATEAU models, photo roofs) plus
  instanced props.
  - Terrain is a regular grid on the shared height grid, with normals from
    central differences.
  - Ground polygons are lifted by kind (road 4 cm, carriageway 6 cm,
    sidewalk 20 cm with a vertical kerb face, paint 15 cm) and drawn with
    polygon offset. Paint gets a stronger offset than road.
  - **Buildings:** walls sink 4 m below the base so they meet sloping
    ground. PLATEAU use codes map to a category (house, apartment, mixed,
    commercial, public, glass tower). The category picks a palette, texture
    layer and window bay width, and **each wall gets a whole number of bays**
    (`bays = round(len / BAY)`, `bay = len / bays`), so windows never wrap a
    corner. Simple house footprints get hipped or gabled roofs over their
    minimum-area rectangle. Flat roofs get a parapet and seeded rooftop plant
    (stair housings, AC condenser rows, water tanks), and apartment blocks get
    balconies on the sunniest long face. Where PLATEAU has LOD2 shells, those
    replace the generated walls and roofs. Tokyo Tower is built member by
    member (`tower.js`).
- `src/world/drape.js`: **the technique that matters most for us later.**
  Every ground-layer triangle (road, sidewalk, paint) is clipped against the
  terrain grid cells and their diagonals, so each output triangle is coplanar
  with the terrain triangle under it, even across tile boundaries. Kerb
  segments are cut at the same lines, so kerb tops share vertices with the
  sidewalk edge. The result is that paint never sinks into a slope.
  `tools/tests/road-markings.test.mjs` checks this with an independent
  vertical ray cast against the compiled areas.
- `src/shared/decks.js`: bridge decks as a `surface(x, z)` function. It
  returns the highest deck whose corridor contains the point, blended back to
  the terrain over 8 m. The same function serves the mesher, the traffic and
  the camera.

### Materials (`src/world/materials.js`, `textures.js`)

- **Texture arrays, not atlases:** walls (6 layers) and ground (4 layers) are
  each a `DataArrayTexture` at 1024 px, with a matching normal-map array. That
  is 4 samplers for all surfaces. Albedo is stored as **detail**: divided by
  the layer's mean, so the shader multiplies it onto the vertex colour (we
  already do the same with `TexSet.avg`).
- Ground anti-tiling: a second sample at 3.7x scale mixed 40%, plus
  low-frequency value noise (`vnoise(st * 0.045)`) on brightness and
  roughness.
- Facade shader: weathering (rain streaks, a dirty base, run-off under the
  roofline). Per-bay window rectangles by category. Frames and mullions
  measured in metres from the window edge, anti-aliased with `fwidth`, and
  faded out where the grid would alias. Shopfronts on the ground floor of
  commercial and mixed buildings, with a sign band that glows at night.
  **Interior mapping:** a ray-box intersection with a room 4.5 m deep behind
  each pane, with shaded side walls, ceiling, floor and back wall, a furniture
  band, blinds or curtains part-way down, and a fade to the average room in the
  distance. **Night windows:** the on-rate depends on category; whole office
  floors are lit or dark; towers are mostly dark glass. A share of rooms
  "live": each switches on its own 90 to 330 s clock with a one-second fade.
  Lamp colour is warm for homes, a single tube type per office building, and
  the odd TV blue. Sun glint in panes uses three specular lobes and a per-pane
  wobble. At night, tower glass reflects a procedural ground field of lights.
- Wall photos (PLATEAU): blended in with distance (140 to 420 m). Up close
  you see the generated facade, painted in the photo's average colour.
- Open ground shows the aerial photo. Roads keep their own textured surface.

### Lighting and post (`environment.js`, `atmosphere.js`)

- One 4096 shadow map. Its extent grows in 1.3x steps with camera distance
  (220 to 1800 m), the normal bias scales with the extent, and the position is
  snapped to texels. We do the snapping already; the growth with distance only
  matters for a flying camera.
- Image-based light: the procedural sky (without the sun disc) is rendered
  through `PMREMGenerator.fromScene` into `scene.environment`, and **re-baked
  only when darkness has changed by more than 0.04**.
- Day and night are two separate values: `night` (city lights on) goes 0 to 1
  as the sun drops from 9 to 0 degrees; `dark` follows the sun from 5 to -13
  degrees (nautical twilight). The light source switches from sun to moon below
  -5.5 degrees, when neither casts a visible shadow. Sun and moon positions are
  real (takram `getSunDirectionECEF`) for the live Tokyo clock.
- Post (pmndrs `postprocessing`, WebGL): window/water screen-space reflections
  (panes marked in the colour buffer's alpha), N8AO at half resolution,
  takram aerial perspective and sky (patched to mirror the sky below the
  horizon instead of drawing a planet), optional takram volumetric clouds
  limited to the area and casting shadows, mipmap bloom, then ACES.

### Night lamp light (`src/world/lamplight.js`)

This is the cleverest cheap trick in the repo. Street lamps and **every NPC
car's headlamp and tail-lamp footprint** are flat quads on a hidden layer. Each
frame at night they are drawn from straight above by an orthographic camera
into a 2048 half-float light map around the focus, using **`MaxEquation`
blending**, so overlapping pools keep the brighter value and never pile up
into glare. The light's **height goes into alpha**. Every lit material (patched
globally through `ShaderChunk.lights_fragment_end`) reads the map at its world
position and adds `rgb * diffuseColor` to direct diffuse light, but only on
surfaces that face up and lie within 2.5 to 5 m of the stored height. So a lamp
under a flyover doesn't light the deck above, and the light tints asphalt as
asphalt and paint as paint. The map's extent steps with view distance and
snaps to texels. The car beams share the cars' instance matrices
(`beams.instanceMatrix = mesh.instanceMatrix`), so they cost no extra
transform updates.

### Water (`mirror.js`, `reflections.js`)

The city is rendered a second time, mirrored at the nearest visible water level
with an oblique near plane (Lengyel), into a half-resolution target. The ground
shader samples it with ripple offsets. Clouds in the water come from the cloud
system's weather map, read where the reflected ray meets the cloud base. Window
reflections use screen-space ray marching (56 growing steps, 8 bisection
steps), driven by an alpha mask.

### Traffic (`src/world/traffic.js`) and the rest

- The road graph comes from OSM. Lanes are offset from the centreline (keep
  left), and junction clusters closer than 26 m are merged with union-find.
  Stop lines are set back by half the widest road plus 5.5 m. Car following
  is a simple target-speed rule (`lead + (gap - 2.5) / 1.4`, clamped
  accelerations); **it is not IDM**. A junction is held by one approach at a
  time through a claim token with an expiry time. Oncoming straight-through
  traffic can share it, minor roads give way to bigger ones, and nobody
  enters without room on the far side. Signals run on a fixed 64 s cycle from
  `uTime`, shared with the lens shader, so the signal heads cost nothing on
  the CPU. Routes are random turns weighted towards straight on and bigger
  roads. A car stuck for 45 s, or left behind by the camera, respawns near the
  focus.
- Cars are procedural tapered boxes merged per type (kei, sedan, van, truck,
  bus): one `InstancedMesh` per type with per-instance colour, and lamps and
  glass coded per vertex.
- Trains on the real OSM lines, birds placed entirely in the vertex shader
  (a small data texture per flock), Mt Fuji backdrop (a 120 m DEM grid 60 km
  wide under two aerial photos and a snow line), and invented neon ads.

## 3. Against our game

| Area | Tokyo | Ours | Verdict |
|---|---|---|---|
| Purpose | City viewer, free camera | Driving school + explorer, player car with physics, FFB | Different products. Their world is richer; our driving is in another league. |
| Renderer | WebGL, GLSL patches | WebGPU, TSL (`facade.ts`, `graphics.ts`) | Ideas port, code doesn't. |
| Terrain | 5 m DEM, draped roads, bridge decks, graded ramps | Flat | **Theirs is far ahead.** We need this for the hill start (roadmap 7). |
| World loading | 256 m tiles streamed by radius, meshed in 2–4 workers | Whole place parsed and meshed on the main thread at load (`world.ts` `build`), 200 m chunks culled by distance | Fine for Finglas (0.6 MB). Won't scale to a large place. |
| Building data | Usage, storeys, measured height, OSM colour and material, LOD2 shells | Height only (`bake_world.py` reads `num_floors` and `class`, then drops them) | Theirs drives the facade from the data; ours guesses. |
| Facade windows | Whole bays per wall, category layouts, interior mapping, live night windows, weathering | `u` runs continuously round the building (`world.ts` `building()`), bay width from the seed, so **windows wrap corners**; no interiors; night glow by hash | Theirs is better and cheap to match. |
| Textures | `DataArrayTexture` (4 samplers for everything) | Two 2D atlases with insets and explicit gradients (`textures.ts`, `facade.ts` `sampleSet`) | Arrays are cleaner. Our comment worries about drivers, but on WebGPU 2D arrays are core. |
| Anti-tiling | Second sample at 3.7x + noise | Single sample (plus procedural blotches on some surfaces) | Small win for them on roads and grass. |
| Night lighting | Light map, max blend, height-aware, NPC headlight beams | Additive discs per lamp (`nightfx.ts`), which add up where they overlap; one `SpotLight` for the player only | **Theirs is clearly better** for night lessons. |
| Environment light | PMREM of the sky, re-baked on change | No `scene.environment` (roadmap 11) | They show how cheaply it's done. |
| AO / AA | N8AO half-res; no AA beyond MSAA | GTAO, SMAA, bloom | Even. |
| Road markings | Measured from real kerbs, OSM turn arrows | SUMO lane geometry with Irish markings (`roadrender.ts`) | Ours is better suited to a driving test (lane-exact). |
| Traffic | Target-speed following, junction tokens, random turns, respawn near camera | IDM on SUMO lanes, right of way, pedestrians, reactions to the player (`trafficnet.ts`) | **Ours is better.** Theirs is ambience. |
| Testing | Tile format round-trip; geometric paint-clearance test over real data | Headless sim tests (traffic, examiner, routing) | Their geometric test is worth copying as an idea. |

## 4. What to adopt, ranked

Ranked by value to a driving-test sim in Finglas, then by cost. Efforts are
for one person in our codebase.

1. **Night lamp light map** (roadmap 16). Replace the additive discs in
   `nightfx.ts` with an orthographic top-down pass into a half-float target
   using **max blending** (WebGPU has a `max` blend operation; check that
   three's WebGPU backend maps `MaxEquation` in r186). Store the light height
   in alpha, and read it in the world material's lighting as diffuse light
   times albedo, on up-facing surfaces only. Draw the NPC cars' headlamp and
   tail-lamp footprints into the same map, sharing the traffic instance
   matrices. The player keeps a real `SpotLight`. This fixes overlapping pools
   that blow out and gives every car visible beams, which matters for night
   driving and dipped-headlight practice. *Effort: 1 to 1.5 days.*
2. **Whole window bays per wall.** In `world.ts` `building()`, give each wall
   its own `u` starting at 0 and a bay width fitted as `len / round(len /
   target)`, and pass the bay width per vertex (or `u` in bay units, as
   Tokyo does). Walls under about 1.8 m get no windows. This stops windows
   wrapping corners. *Effort: 2 to 3 hours.*
3. **Carry building class and floors into the bake.** Overture gives `class`,
   `num_floors` and (where mapped) `facade_color`, `facade_material`,
   `roof_shape`; we read some of these and throw them away. Write them into
   the `.bin` and let the facade choose layout, floor height and on-rate by
   category (house, terrace, apartments, retail, industrial, civic), the way
   Tokyo does from PLATEAU use codes. *Effort: about 1 day (bake + format +
   shader).*
4. **Interior-mapped windows and live night windows** (roadmap 13). Port the
   ray-box room and the per-room on/off clock to TSL. Category-dependent
   on-rates; office buildings lit by whole floors. *Effort: 0.5 to 1 day once
   items 2 and 3 are in.*
5. **Sky environment map** (roadmap 11). Render the `SkyMesh` (without the
   sun) through PMREM into `scene.environment` and re-bake only when the
   darkness or sun height has moved past a threshold. Also split "lights on"
   from "dark" as two curves on sun elevation (lights on 9° to 0°, dark 5° to
   -13°). *Effort: half a day.*
6. **Elevation their way** (roadmap 7, when we have the lidar DTM):
   - One height grid for the whole place, and one shared `sampleGrid` used by
     the mesher, the physics ground query, traffic and the examiner.
   - A terrain mesh per chunk on that grid.
   - **Drape** every road, footpath and paint polygon by clipping it to the
     terrain triangles, and cut kerb segments at the same lines.
   - Walls sunk below the base.
   - Bridges as deck corridors in one `surface(x, z)` function, and graded
     approach ramps with nodes pinned to the ground.
   - A Node test that ray-casts the paint against the road surface on the
     real Finglas data.

   Doing this in the order Tokyo does avoids months of z-fighting and buried
   markings. *Effort: 3 to 5 days, plus the data work.*
7. **Texture arrays instead of atlases** in `textures.ts`. A 2D array texture
   per map type (albedo; normal + roughness) removes the inset and
   explicit-gradient workaround in `sampleSet` and stays at 2 samplers
   however many sets we add. Keep the atlas path only if we ever need the
   WebGL2 fallback on a driver that fails. Add the cheap second-scale sample
   plus noise to break up repetition on asphalt and grass. *Effort: half a
   day.*
8. **Worker meshing with a pure, three-free mesher.** Move `Builder` work for
   chunks into workers that return transferable typed arrays, and stream
   chunks by radius with hysteresis. It isn't needed for Finglas today, but it
   will be for "real-world explorer" places bigger than a few km², and the
   three-free mesher becomes testable in Node. *Effort: 2 to 3 days.*
9. **Shop signs from OSM names** (explorer polish). Put a fascia board with
   the real shop name over the shopfront nearest each named OSM shop, with
   text drawn into a per-chunk canvas atlas only when the chunk is near.
   Finglas village and the Main Street shops would read as real. *Effort: 1
   to 2 days.*
10. **Distance LOD per chunk for props** (with roadmap 15): detailed trees
    near, simple shapes far, switched with a margin. *Effort: half a day when
    we add real tree models.*

## 5. What not to adopt

- **Their traffic model.** Target-speed following, token-claimed junctions,
  random turns and respawning near the camera are fine for scenery, but wrong
  for an examiner that judges right of way. Ours is already better.
- **`roadsplit.mjs` and carriageway-measured markings.** These exist because
  PLATEAU gives road polygons without lanes. We have SUMO lane geometry, which
  is more exact for test routes.
- **The takram atmosphere and clouds, n8ao and pmndrs postprocessing as
  used here.** They're wired to the WebGL composer. We have GTAO, bloom and
  SMAA on WebGPU. If we want physical aerial perspective later, check whether
  takram's TSL/WebGPU build covers r186 before planning it.
- **Water mirror and screen-space window reflections.** The mirror re-renders
  the whole scene, which doesn't pay off for the Tolka in Finglas. The SSR
  alpha-mask idea is worth remembering for wet roads (roadmap 14/16), but an
  environment map comes first.
- **PLATEAU wall photos and aerial-photo ground.** Ireland has no PLATEAU
  equivalent. For orthophotos we'd need a CC0/CC-BY source; never Google or
  Bing.
- **Birds, Tokyo Tower, invented neon ads, the Mt Fuji snow line.** Charming,
  but not relevant to the test. A coarse-DEM horizon of the Dublin Mountains
  might be worth it one day, with no photo, tinted and hazed.
- **Procedural box cars.** We have a real glTF car and Blender-made models
  coming (`docs/blender-assets.md`).
- **`onBeforeCompile` and global `ShaderChunk` patching.** That's the WebGL
  way. In TSL we compose nodes instead, including adding the lamp map in the
  world material's lighting.

## 6. Summary

Procedural Tokyo is a well-built WebGL city viewer on real Japanese open data
(PLATEAU, OSM, GSI DEM and photos), with lots of procedural shading on top and
no driving. Compared with us, its world is better and its traffic is worse.
The highest-value things to take:

1. The lamp light map (max blending, height in alpha, NPC headlight beams).
2. Whole window bays per wall, and building class and floors carried through
   the bake.
3. Interior-mapped windows with live night windows.
4. A PMREM sky environment map re-baked on change.
5. When elevation arrives, their single height grid, terrain-triangle draping
   of roads and paint, deck corridors, and a geometric clearance test.
