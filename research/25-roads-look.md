# 25: How our roads look, against Irish standards and good games

Date: 2026-10-05. Question: how far are our streets (surface, markings,
kerbs, footpaths, junctions, signals, signs) from real Finglas roads and the
Irish manuals, what do good games and open renderers do that we don't, and
what should we fix first? Research only; no code changed.

What was checked:
- Our code: `roadrender.ts`, `roadsigns.ts`, `facade.ts`, `textures.ts`,
  `tools/bake/build_net.sh`, `bake_net.py`, `public/tex/manifest.json`.
- The baked Finglas network, measured headless (`finglas.net.bin`, via the
  tests' `loadNet`): lane widths, crossings, which markings get drawn.
- OSM tags for the Finglas bbox (Overpass, 2026-07-24 data): 1,144 road ways,
  323 crossings, 106 signal nodes.
- Screenshots from the Mac: `game/shots/svc/001-008`, `sig/003`,
  `paint/003`, `happy-medium/003, 009`, `fix5/006`, `lights2/004`,
  `tragedy/020` (night, 22:56). Stills, not video.
- The Irish Traffic Signs Manual (TSM) chapters 1, 7 and 9, final version 3,
  October 2025, and DMURS v1.1 (2019): read in full where cited below.
- Code read (licences checked first): osm2streets (Apache-2.0), Streets GL
  (MIT), OSM2World (MIT). Nothing copied.

## 1. Our numbers against the standard

| Marking / element | Ours (code) | Irish standard | Source |
|---|---|---|---|
| Lane width | 3.20 m on every one of 8,720 road lanes (SUMO default); carriageway 6.4 m everywhere | Arterial/Link 2.75-3.5 m, preferred 3.0/3.25; Local streets 5-5.5 m carriageway (2.5-2.75 m lanes) | DMURS 4.4.1 / Fig 4.55 |
| Kerb upstand | 0.12 m (`PATH_Y 0.15 - ROAD_Y 0.03`) | 125 mm standard; 60 mm in centres / local streets | DMURS 4.4.8 |
| Kerb stone | no kerb top, only a vertical face in footpath colour | separate kerb unit (precast or granite) with its own top | (OSM2World draws a 0.15 m kerb strip) |
| Footpath | 2.0 m (SUMO default, 7,894 of 8,100 pieces) | min 1.8 m, desirable 2.5 m | DMURS Fig 4.34 |
| Broken centre line, urban | 110 mm, 3 m mark / 6 m gap | RRM 002B: 100 mm, **3 m / 3 m** | TSM 7.3.13, Table 7.1 |
| Centre line near junctions | broken, trimmed 1.5 m short | **continuous** RRM 001 for 20 m (min 8 m; 2 m if road < 5.3 m) back from every stop and yield line | TSM 7.2.5, 7.2.18, 7.16.37 |
| Where centre lines go | every two-way edge > 4 m long: 3,793 edges, 155 km | omit under 5.0 m wide, optional 5-6 m; continuous lines generally not in urban areas | TSM 7.3.14, 7.3.26 |
| Lane line | 100 mm, 2 m / 4 m | RRM 003A default **4 m / 8 m**; RRM 003B 2 m / 2 m on junction approaches (min 5 marks at 50 km/h) | TSM 7.3.45-47 and figure p. 7/23 |
| Edge line | continuous yellow 120 mm, 0.25 m in from the kerb, on roads >= 60 km/h (132 edges) | RRM 025 **broken** yellow 2 m / 2 m; urban kerbed roads "not generally"; continuous yellow (RRM 026) motorway only | TSM 7.3.53-56, Table 7.4 |
| Single yellow line | none | RRM 007: 100 mm, 150-300 mm from the edge (parking restriction) | TSM 7.6.2 |
| Stop line | 300 mm, 0.4 m before lane end | **200 mm** (300 mm only at level crossings and bridges); >= 600 mm from the major road's edge | TSM 7.2.2-7.2.4 |
| Yield line | **two** lines, 150 mm, 0.6 m mark / 0.3 m gap, 0.4 m apart (UK diagram 1003) | **one** 200 mm line, 1000 mm mark / 1000 mm gap (500/500 on narrow lanes) | TSM 7.2.15 |
| Roundabout entry | same double broken line | No Entry Line RRM 019: one continuous + one broken (1000/1000) line, 200 mm, 300 mm apart | TSM 7.2.20, 7.13.3 |
| Yield triangle M 115 / STOP word M 114 | none | triangle in each lane 2.1-2.75 m before the line; STOP letters 1.6 or 2.8 m tall | TSM 7.5.3-7.5.7 |
| Roundabout island | flush grass, no line | continuous line RRM 001 about 300 mm from the island edge | TSM 7.13.7 |
| Mini-roundabout | white disc 1.8-4 m across | disc 1-4 m plus **three circulation arrows** (RRM 033, 3.25 or 4.45 m); no rings | TSM 7.13.13-15 |
| Zebra | 0.5 m white stripes, 0.5 m gaps, 3.6 m long (SUMO crossing width 4.0 m), nothing else | 100 mm pedestrian lines 2.4 m apart (normally); kerb-side black 0.5-1.3 m; stripes 0.5-0.715 m; transverse yield line 200 mm, 500/500, 1-2 m back; Belisha beacons | TSM 7.16.3-7.16.9 |
| Zig-zags | none | 8 x 2 m marks on approach, >= 3 on exit, 200-250 mm from the kerb, 600 x 200 mm terminal line; a centre row when carriageway > 6.2 m | TSM 7.16.45-50 |
| Signal-controlled crossing | two lines of 120 mm studs, 0.25 / 0.25 m | two **continuous** 100 mm pedestrian lines (M 131) 2-5 m apart; stop line normally 2.0 m before (1-5 m) | TSM 7.12.5, 7.16.33-35 |
| Yellow box | none | 200 mm border, 150 mm diagonals at 2.0 m (box side <= 9 m) or 2.5 m | TSM 7.9.5 |
| Signal position | one pole per approach on the kerb side, 1.1 m out from the lane edge, 0.6 m before lane end: the stop line is drawn **0.2 m past** the pole | stop line normally 1-2 m **before** the nearside primary; at least one primary and one **secondary** (far side, usually right) per approach | TSM 7.2.9, 9.4.2, 9.4.14 |
| Signal head | box: lens 220 mm, 360 mm pitch, lowest lens centre 2.6 m | 200 mm aspects, 240-380 mm pitch, lower edge of lowest aspect 2.1-3.05 m; >= 450 mm from the kerb | TSM 9.2.5-9.2.6, 9.4.7 |
| Sign plates | centre 2.1 m: lower edge 1.65-1.73 m | urban desirable lower edge 2.3 m (2.5 m by cycle tracks); 450 mm min clearance in towns | TSM 1.3.16, 1.3.22 |
| Road surface | all asphalt | OSM: 244 of 804 residential ways in Finglas are `surface=concrete` (estate roads), 500 asphalt | Overpass |
| Asphalt colour | vertex 0x85868a, about 0.23 linear, texture normalised to mean 1 | aged asphalt reflects about 0.10-0.18, new 0.05; concrete about 0.25-0.40 | US EPA cool pavements compendium, Fig. 4 |
| Paint colour | 0xe9e7e0, about 0.81 linear, flat, no wear | EN 1436 daylight luminance factor classes B2-B5 = 0.30-0.60 for white on asphalt | EN 1436 (cited, not read in full) |
| Paint at night | same material as by day | retroreflective (glass beads), EN 1436 RL classes from 100 mcd m^-2 lx^-1 | EN 1436 |

Width counts: our crossings are 4.0 m (all 4,000 SUMO crossing lanes);
signalised crossings may be 2-5 m so that's fine, zebras are normally 2.4 m.

## 2. What the screenshots show

- **Daytime residential (svc/001, svc/003, lights2/004):** the road reads as
  a light grey sheet with large repeated black cracks (the 3 m asphalt tile
  repeats every 3 m), crisp sticker-white dashes and no kerb stone. Footpath
  and road are close in brightness. No gullies, ironwork or patching.
- **Signal junction (fix5/006, svc/006):** the head stands at the stop line
  on the left; the crossing is two dotted stud lines; the far side has no
  signal. At the stop line the driver's eye is about 2 m behind the line,
  the head about 3 m to the left and 1.0-1.7 m above the eye: roughly 30-40
  degrees up, which is above a hatchback's windscreen header. From the
  cockpit the light can't be seen at the moment it matters (estimate from
  the geometry; not checked in the cockpit view).
- **Roundabout (happy-medium/009):** UK-style double broken give-way line;
  flush grass island with no kerb and no line round it.
- **Distance (fix5/006 and svc/001 crops):** fish-scale arcs centred on the
  camera across big flat areas, which is a texture-filtering signature (see
  4.6), not geometry.
- **Night (tragedy/020, 22:56):** the road and its markings are black;
  nothing picks up the headlights.

## 3. How good games and open renderers do it

- **Markings drawn by the road shader from lane coordinates.** Many city
  sims place dashes per pixel from (distance across the lane, distance along
  it): no z-fighting, analytic anti-aliasing with `fwidth`, and wear by
  noise. Streets GL (MIT) bakes markings into dedicated road textures
  (`asphalt_road_diffuse.png` vs `asphalt_unmarked_road_diffuse.png`) laid
  across the road width. Our `FACADE_ROAD_LINED` path already does this for
  the plain ribbons; the SUMO streets use separate quads instead.
- **Layers and decals.** CARLA's Road Painter (MIT) paints a base asphalt
  plus up to three more materials through masks on a render target, then
  scatters decals (patches, cracks, manholes, oil) with random scale and
  rotation; lane markings are their own material on their own meshes.
  ([docs](https://carla.readthedocs.io/en/latest/tuto_M_custom_road_painter/))
- **Texture arrays, not atlases.** Streets GL packs surfaces into a
  `sampler2DArray` of 512 px layers with anisotropy 16. Each layer mips on
  its own, so a tile never bleeds into its neighbour at distance (read in
  `createProjectedMeshTexture.ts`, `projected.frag`).
- **Breaking up tiling.** Streets GL includes a `textureNoTile` chunk (the
  Quilez technique: random per-cell offsets blended smoothly). Better
  published options: Heitz and Neyret 2018 (histogram-preserving blending),
  Mikkelsen 2022 hex-tiling (JCGT 11/3/5).
- **Normal-map and specular filtering.** As a normal map mips down its
  normals average out; without raising roughness to match (Toksvig 2005;
  Tokuyoshi and Kaplanyan, geometric specular AA, JCGT 10/2/2) distant
  surfaces sparkle and form moiré. Temporal AA (Streets GL writes motion
  vectors for it) then removes what's left. Thin lines under 1 px need one
  of the two: analytic coverage or temporal accumulation. We have SMAA only.
- **Junction polygons.** osm2streets (`geometry/general_case.rs`): for each
  pair of adjacent roads, intersect their edge polylines, project the hit
  back onto each centre line, trim there, and build the junction polygon
  from those corners; `render/intersection_markings.rs` then rounds the
  footpath corners. SUMO's `--junctions.corner-detail 6`, which we use, does
  the same job. osm2streets' own markings are schematic (0.25 m lines,
  2 m / 1 m dashes), not to any manual, so take the geometry, not the paint.
- **Kerbs.** OSM2World (MIT, `RoadModule.java` `KERB` lane type) draws the
  kerb as its own 0.15 m strip with a top and a front face in a kerb
  material, 0.12 m high, 0.03 m when tagged `kerb=lowered|rolled`, flush
  when `kerb=flush`.
- **Wet roads.** Lagarde's rain write-up: wetness darkens porous albedo,
  lowers roughness, fills puddles from a height or porosity mask; markings
  stay brighter than wet asphalt.
- **Retroreflection.** Real paint has glass beads that send headlight light
  straight back. A game term: add paint brightness proportional to headlight
  irradiance times a narrow lobe around the light-to-eye direction (the
  headlamps sit close to the eye, so it's nearly the view direction).

## 4. Findings, ranked

Ranked by how much each hurts, from the driver's seat, realism and the
test's accuracy. Cost: S = under a day, M = days, L = a week or more.

### 4.1 Signals can't be seen from the stop line (test-critical) - M
One primary per approach, beside the line, and the line is 0.2 m past the
pole. The manual puts the line 1-2 m before the primary and always adds a
secondary on the far side (normally right, aimed 2.5 m behind the stop
line), plus duplicate primaries on islands of multi-lane approaches. Without
the secondary the learner stopped at a red has to lean or guess; the
examiner's red-light faults are then unfair.
Fix: in `roadsigns.ts` place the primary 1.5 m beyond the stop line
(move the line back in `roadrender.ts`, one constant both read), add a
secondary head on the far-side offside for every approach, keep >= 450 mm
from the kerb. Check in the cockpit view on the Mac.

### 4.2 Junction markings are British, not Irish - S
Yield line drawn as the UK double 600/300 line; Irish is one 200 mm line,
1 m / 1 m. Roundabout entries need the No Entry Line (continuous + broken).
Stop line 300 mm, should be 200 mm. Missing: yield triangle (M 115) in each
lane, STOP word (M 114) where a stop sign stands, the 20 m continuous
centre line before every stop/yield/signal line, the continuous line round
roundabout islands, the mini-roundabout arrows. Drawn on 919 approaches
inferred from minor links plus 213 from OSM signs. These are the markings
the theory test and the examiner talk about.
Fix: new constants in `roadrender.ts` from TSM 7.2 and 7.13; a
`stopLineSetback` shared with the signal placement. Triangles and words
need a small marking-glyph set (canvas or SDF) drawn flat.

### 4.3 Centre and lane lines: wrong rhythm and too many - S
Centre 3 m / 6 m should be 3 m / 3 m in town; lane lines 2 m / 4 m should
be 4 m / 8 m, changing to 2 m / 2 m for at least 5 marks before signals and
roundabouts. We paint a centre line on all 155 km of two-way road; the
manual omits it under 5 m and in Finglas many estate roads have none (OSM
`lane_markings=no` on 56 ways, `yes` on 123, the rest untagged). Too many
lines make every estate road look like an arterial road and teach the wrong
habit about where the centre is.
Fix: rules by road class and width; carry OSM `lane_markings` through
`bake_net.py`; when unknown, mark only Link/Arterial classes, plus the
junction stubs from 4.2.

### 4.4 Pedestrian crossings - S to M
Signalised crossings use UK-style studs; Irish ones are two continuous
100 mm lines. Zebras lack the pedestrian lines, the transverse yield line
1-2 m back, the zig-zags (which tell the driver "crossing ahead, no
overtaking or parking here") and the Belisha beacons. No dropped kerbs or
tactile paving anywhere: every crossing has a 12 cm step (OSM: 49 Finglas
crossings tagged `tactile_paving=yes`, 87 `no`). Also check which crossings
count as zebras: `bake_net.py` treats `crossing=uncontrolled` with
`crossing:markings=yes|lines` as marked (about 40 in Finglas); Irish zebras
need beacons or RUS 066, so most of those are probably plain dropped-kerb
crossings, and the examiner would fault a driver for not yielding at one.
Verify on the owner's photos before changing.
Fix: crossing markings from TSM 7.16; beacons as a model (on the
furniture list); flush kerb plus blister paving at every crossing end
(red at controlled, buff at uncontrolled, per the UK tactile guidance DMURS
refers to).

### 4.5 Gaps and steps in the geometry (likely the green spike) - S
`stripe()` and the footpath loop emit one quad per polyline segment with no
join, so at every bend the outside of the strip opens a wedge and the
inside overlaps; the ground (grass at y = 0) shows through the wedge under
the 3 cm road. The `width + 0.02` overlap hides only the lane-to-lane seam.
Walking areas (the footpath corners at junctions) are filled at 0.15 m
with no kerb face, so the 12 cm step at every corner is open. Roundabout
islands are flush.
Fix: build each ribbon as one strip with mitred (or rounded) joins and
shared vertices; kerb walls along walking-area edges that border a
carriageway; raise roundabout islands with a kerb. Reproduce the spike
first: find it, log the lane and vertex, confirm the wedge.

### 4.6 Moiré and shimmer at distance - M
Likely causes, in order (not yet confirmed one by one):
1. Atlas mip bleeding: each cell has a 6-texel inset at 1024 px, which is
   under one texel from mip 3 on; anisotropic taps near each `fract()` wrap
   then sample the neighbouring texture.
2. Tile repetition: asphalt repeats every 3 m, footpath every 1.8 m.
3. Normal maps mipped without roughness compensation.
4. SMAA only: 100 mm lines go under a pixel at about 30-40 m and break up.
Test: `?notex` (procedural path); forced LOD clamp; mip levels tinted.
Fix: a 2D array texture (WebGPU supports it; three has `DataArrayTexture`)
so each set mips alone; hex-tiling or the Quilez offset trick; Toksvig
roughness from the normal length; TRAA (three's addon) or analytic
coverage for markings; anisotropy 16 where the GPU allows it.

### 4.7 Surface doesn't match Finglas - S to M
About a third of Finglas residential roads are concrete (OSM), with
transverse joints that the driver sees and hears; we draw all asphalt. Our
asphalt is about 0.23 albedo where aged asphalt is about 0.10-0.18, and the
paint is 0.81 and perfect where real paint is 0.3-0.6 and worn through to
the aggregate in the wheel tracks. No gullies along the kerb, manholes,
utility-cut patches (which in Dublin run along the kerb and across
junctions), or road studs on the N2.
Fix: carry `surface` into the bake; a concrete-slab material with joints
every 4-6 m (measure on photos); tone asphalt to ~0.13-0.15 and paint to
~0.5 new / ~0.35 worn, then check on the Mac screen; a decal pass for
patches, gullies and ironwork placed along the kerb by rule.

### 4.8 Markings vanish at night - S to M
Tragedy/020 at 22:56 shows no lane at all. Real markings are the brightest
thing in the headlights. Fix: a retroreflective term on paint (and studs)
from the player's headlights, plus street-lamp pools (ROADMAP item 16).

### 4.9 Every lane is 3.2 m - M
All lanes 3.2 m: estate roads come out 6.4 m and arterials too narrow or
too wide at random. Lane position faults ("too close to the kerb",
"crossing the centre") depend on this. OSM has no `width` tags in Finglas
(0 of 1,144 ways), so widths need another source: the 123 mapped separate
sidewalk ways (kerb-to-kerb gaps), building frontages, or the owner's
measurements. Until then, defaults by class from DMURS ranges.

### 4.10 Yellow edge line where Ireland wouldn't paint one - S
A continuous yellow line just inside the kerb on 60 km/h+ roads reads as a
single yellow parking line (RRM 007) to an Irish driver. The edge line is
broken 2 m / 2 m and not generally used on kerbed urban roads. Same rule in
the shader's Dublin ribbon path (`facade.ts`, code -3).

### 4.11 Signs too low - S
Lower edges at 1.65-1.73 m; urban desirable is 2.3 m. Pedestrians walk
under them in real life and the plates read as too big from the car.

## 5. Order to do it in

1. 4.1 and 4.2 together (they share the stop-line setback). Test: a
   cockpit screenshot at a red at Jamestown Road, and a test that the
   secondary exists for every signalled approach.
2. 4.5 (cheap, removes visible holes).
3. 4.3, 4.10 (rules only).
4. 4.4 crossings.
5. 4.6 texture arrays and AA, then 4.7 surface, then 4.8 night.
6. 4.9 widths, with a measuring source decided first (ask the owner).

## Sources

Standards (Government of Ireland publications; read for dimensions, no
artwork copied; licence not stated as open):
- Department of Transport, *Traffic Signs Manual* ch. 7 Road Markings,
  final version 3, Oct 2025:
  https://www.roadguidelines.ie/wp-content/uploads/2025/11/TSM-Chapter-7-Final-Version-3-October-2025.pdf
- TSM ch. 9 Traffic Signals, Oct 2025:
  https://www.roadguidelines.ie/wp-content/uploads/2025/11/TSM-Chapter-9-Final-Version-3-October-2025.pdf
- TSM ch. 1 Introduction and sign location, Oct 2025:
  https://www.roadguidelines.ie/wp-content/uploads/2025/11/TSM-Chapter-1-Final-Version-3-October-2025-2025-10-22.pdf
- Index of all TSM chapters: https://www.roadguidelines.ie/traffic-signs/traffic-signs-manual/
- *Design Manual for Urban Roads and Streets* v1.1, 2019:
  https://www.roadguidelines.ie/wp-content/uploads/2025/10/Design-Manual-for-Urban-Streets-Version-1.1-2019-Low-Res.pdf
- US EPA, *Reducing Urban Heat Islands: Compendium*, ch. "Cool Pavements"
  (public domain US government work):
  https://www.epa.gov/sites/default/files/2017-05/documents/reducing_urban_heat_islands_ch_5.pdf
- EN 1436 road marking performance (luminance factor and RL classes):
  cited from memory of the class table, not read in full here; check before
  using the numbers in code.

Data:
- OpenStreetMap via Overpass (ODbL), Finglas bbox 53.380-53.412 N,
  6.323-6.269 W, data timestamp 2026-07-24.

Code read (techniques only, nothing copied):
- osm2streets, Apache-2.0: https://github.com/a-b-street/osm2streets
  (`osm2streets/src/geometry/general_case.rs`,
  `src/render/lane_markings.rs`, `src/render/intersection_markings.rs`)
- Streets GL, MIT: https://github.com/StrandedKitty/streets-gl
  (`src/app/render/textures/createProjectedMeshTexture.ts`,
  `src/resources/shaders/projected.frag`, `textureNoTile.glsl`)
- OSM2World, MIT: https://github.com/tordanik/OSM2World
  (`core/src/main/java/org/osm2world/world/modules/RoadModule.java`)

Techniques:
- CARLA Road Painter (CARLA is MIT): https://carla.readthedocs.io/en/latest/tuto_M_custom_road_painter/
- Inigo Quilez, texture repetition: https://iquilezles.org/articles/texturerepetition/
- Heitz and Neyret 2018, by-example noise / histogram-preserving blending: https://eheitzresearch.wordpress.com/722-2/
- Mikkelsen 2022, Practical Real-Time Hex-Tiling, JCGT 11(3):5: https://jcgt.org/published/0011/03/05/
- Tokuyoshi and Kaplanyan, geometric specular anti-aliasing, JCGT 10(2):2: https://jcgt.org/published/0010/02/02/
- Sébastien Lagarde, Water drop 2b, dynamic rain and its effects: https://seblagarde.wordpress.com/2013/01/03/water-drop-2b-dynamic-rain-and-its-effects/

Not used: GPL/AGPL or unlicensed projects (movsim, shapeml, Blosm,
3DStreet, Streetmix). No Street View. Photos were not opened for this note;
the next modelling pass should check concrete joint spacing, kerb units and
gully spacing on Geograph or the owner's own photos.
