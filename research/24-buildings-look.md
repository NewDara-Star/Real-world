# 24: How our buildings look, next to real Finglas and the best open renderers

Date: 2026-10-05. Question: from a car on a Finglas road, what makes our
houses, shops and sheds read as fake, what are the real buildings like,
and how do the best open city renderers do it? Research only; nothing
changed in code. Techniques only from other projects; no code copied.

What was looked at:
- Our code: `tools/bake/bake_world.py` (heights), `game/src/client/world.ts`
  (`building()`, `hipRoof()`, `isShopFront()`), `facade.ts` (walls, windows,
  shopfronts), `cities.ts` (Finglas palettes), `gardens.ts` (house fronts),
  `public/tex/CREDITS.md`.
- Our screenshots on the Mac GPU, daytime: `game/shots/svc/001-008`,
  `own/001`, `happy-medium/010` and `019`.
- The baked world `public/world/finglas.bin`, measured with a script
  (numbers below).
- OSM building tags for the Finglas box (53.380..53.412 N, 6.323..6.269 W),
  pulled from Overpass on 2026-10-05: 20,924 building ways.
- Source code of OSM2World (MIT) and Streets GL (MIT), read on disk.
- Dublin City Council's *Finglas: a Regeneration Strategy* (2005) and the
  housing-history sources listed at the end.
- CC BY-SA photos on Wikimedia Commons, looked at and deleted (none kept,
  none used as textures). Geograph refused the fetch (403). The owner's
  own photos from the street would beat everything here; the Finglas
  house details in §1 that are marked *estimate* need checking against them.

## 1. What real Finglas is

**History.** Finglas stayed a country village until the 1950s. Dublin
Corporation then built "several major housing developments … in the
1950's, 60's and 70's" (DCC Regeneration Strategy 2005, p. 11) to rehouse
inner-city families: Finglas East, South and West, with estates named after
republicans (Barry, Casement, Plunkett, Mellows, McKee, Clune, Clancy;
Wikipedia). Private builders put up estates alongside (Ballygall, parts of
Glasnevin North). Joseph Brady's *Dublin 1950-1970: Houses, Flats and High
Rise* (Four Courts, 2016) is the full history; its review in the Dublin
Review of Books names the look in one line: "concrete streets, magnolia
streetnames, pebbledash terraced houses, and box hedges".

**The houses** (Corporation estates, most of what a driver sees):
- Two storeys. OSM agrees: of the 1,799 buildings with `building:levels`,
  1,654 say 2, 93 say 1, 40 say 3.
- Short terraces and semi-detached pairs. In our baked world, 13,801 of the
  15,164 house-sized footprints (40-180 m²) share a wall with a neighbour
  (91%). OSM maps each dwelling as its own `building=house` (14,192 of
  them), so a terrace of six is six polygons.
- Walls: concrete block with dashed render (pebbledash or wet dash), often
  painted cream, white, magnolia or grey, owner by owner; brick fronts are
  mostly on the private 1960s-70s estates and in bands on some groups
  (photos at Ballygall and Glasnevin Avenue: cream render upper storeys,
  red-brown tile roofs, low red-brick garden walls with piers).
- Roofs: pitched, concrete interlocking tiles, dark grey or red-brown;
  hipped ends on many terraces and semis, gables on others. OSM roof tags
  are thin (1,081 buildings, 5%): `pitched` 641, `gabled_row` 311 (an
  undocumented value, about 10,000 uses worldwide, meaning one gabled roof
  running along a row of houses), `gabled` 124, `flat` 3. Chimney stacks on
  the ridge, usually shared on the party wall between two houses
  (*estimate*: these houses were built for solid fuel).
- Eaves about 5.2-5.5 m above the ground (*estimate*: 2.4 m ceilings plus
  floors, a step or two up from the path); a white or black uPVC fascia and
  gutter along every eave.
- Front of each house (*estimate*, to check on photos): a front door, often
  with a side light and a small canopy or a later porch (flat-roofed or
  lean-to, very common); one wide ground-floor window; two windows upstairs,
  one wide, one narrow (box room or bathroom). White uPVC replacement
  windows nearly everywhere, sills about 0.9 m above the floor, set back
  into the wall with a sill below. Gable ends mostly blank or with one
  small window. Back walls aren't seen from the road.
- Satellite dishes and TV aerials on a good share of houses.

**The village and the main roads.** The 1960s-70s redevelopment left
"long low blocks set back behind surface car parks", "generally one and two
storey" (Regeneration Strategy p. 12): Finglas Main Centre (two storeys,
with a seven-storey office block on Jamestown Road), the Iceland centre,
Drogheda Mall (a single-storey parade behind a council car park), and a
1950s two-storey parade of six shops with flats over them on Church Street
(pp. 24-28). Houses on the main roads (Jamestown Road's residential
stretches, Cappagh Road, Mellowes Road) are just houses. OSM has 106
buildings with a `shop` tag, 113 `building=retail`, 125 `commercial`.

**Business parks** (North City, Northern Cross, Tolka Valley trading
estates, McKee Avenue and Jamestown Road industry): portal-frame units with
a split-face block plinth one to two metres high, profiled metal cladding
above (greys, teal, blue), roller-shutter loading doors, a glazed office
corner or strip, a shallow pitched or flat roof hidden by a metal fascia.
Almost no windows on the shed itself.

## 2. Ours, measured

| Thing | What the code does | Effect on screen |
|---|---|---|
| Shopfronts | `isShopFront()`: any wall within 15 m of a road of class 1-5 is a shop, and one building in three on residential roads (class 6) | Measured on `finglas.bin`: about 900 buildings on major roads plus about 4,300 on residential streets get roller shutters and painted sign bands (the residential count approximates the hash). OSM has about 350 commercial buildings. `happy-medium/019` (Saint Margaret's Road) shows rows of shutters on both sides of a housing street. |
| Roofs | Every Dublin house under 900 m² and 11 m gets its own `hipRoof()` | A terrace of six becomes six pyramids with valleys between (`svc/007`, `own/001`). |
| Wall colour and material | Random per footprint from 9 colours; 4 of them pass the `r/g > 1.35` brick test | 44% of houses are red brick, flipping house by house inside one terrace (`svc/007`: brick, grey dash, brick). |
| Heights | Tagged 2 storeys → 2 × 3.2 + 0.4 = 6.8 m; untagged → 5.6 m, or 8.4 m for 15% at random | Heights in the bake: 11,962 at 5.6 m, 1,613 at 6.8 m, 2,093 at 8.4 m. Houses in one terrace step up and down by 1.2-2.8 m; one house in seven is three storeys, where OSM says one in 45. |
| Window grid | Floors every 3.2 m; windows at 1.02-2.56 m in each floor; bays 2.4-3.8 m; `u` runs on round corners | On a 5.6 m wall the upper windows run from 4.22 m into the eaves at 5.6 m: their tops are cut off (`own/001`, `svc/007`). Windows wrap corners (research 16). |
| Doors and openings | A door every fourth bay on the ground floor of every wall | Doors and full window rows on gable ends, side walls and party walls; where neighbours' heights differ, a windowed party wall shows above the lower house. |
| Depth | All flat: frames and glass are colour, no reveal, no sill, no fascia or gutter, no chimney, no porch | Facades read as printed boxes from 10 m; roofs have a thin 35 cm eave with no fascia. |
| Big buildings | Over 900 m² or 11 m: flat roof with parapet, same house window grid | Business park sheds look like four-storey office blocks full of house windows. |
| Glass | Flat dark glass behind a white frame | Reads as black holes at noon; fine at night (lit windows). |

What's good and should stay: real footprints, the CC0 brick and render
scans tinted by each building's colour, the eave underside, night windows,
front gardens with walls, piers and hedges in front of the houses. Next to
Streets GL at the same spot (research 22) we are already ahead at eye
height; the problems above are about the houses telling the wrong story,
not about texture quality.

## 3. How others do it

**OSM2World** (github.com/tordanik/OSM2World, MIT, read 2026-10-05).
- Defaults per building type (`BuildingDefaults.java`): sheds and garages
  one level with no windows, industrial and churches no windows, default
  2.5 m per level.
- Walls get windows only when `building:levels` is known; columns per wall
  are `round(wallLength / (2 × windowWidth))`, spaced evenly, so every wall
  gets whole windows (`ExteriorBuildingWall.placeDefaultWindows`). Window
  defaults: 1 m wide, height half the level, sill ("breast") at 0.3 of the
  level (`WindowParameters`). Near windows are real geometry, far ones a
  texture (`GeometryWindow` / `TexturedWindow`, picked by LOD).
- Walls split at corners (`BuildingPart.splitIntoWalls`), so each wall is
  laid out on its own.
- **Terraces:** `SideHippedRoof` finds the outline segments whose nodes
  touch another building and turns the ridge so the roof is hipped only on
  the free end and stops flat at the party wall. Roof shapes cover the full
  Simple 3D Buildings set (gabled, hipped, side_hipped, half-hipped, …).

**Streets GL** (github.com/StrandedKitty/streets-gl, MIT, read 2026-10-05).
- Walls: `WallsBuilder.getWalls()` counts `windowCount = round(wallLength /
  windowWidth)` per wall (a wall ends at a sharp corner), stretches the
  window width to fit, and sets the vertical UV to `levels` across the wall
  height, so a storey is `wallHeight / levels` and a window can never be cut
  by the roof.
- Facade textures are tiles of one window bay per material (brick, plaster,
  block, wood, glass) with diffuse, normal and a mask (roughness, metalness,
  tint); the building colour tints through the mask
  (`extruded.frag`). Night windows from a noise texture per window cell.
- Roof shapes per tag (`tile3d/builders/roofs/*`); hipped and complex roofs
  from a straight skeleton (their own library,
  github.com/StrandedKitty/straight-skeleton, MIT).

**Tokyo and BoundlessNYC** (research 16, 17): whole bays per wall, building
class drives the facade layout, interior mapping, weathering, and within
~150 m real geometry (reveals, sills, lintels, shopfronts) swapped in for
the nearest buildings while the shader facade stays for the rest. NYC's
typologies come from joining footprints to municipal tables; for Finglas
the equivalent is Tailte Éireann's **HVD Building Groups** (which buildings
form one terrace, CC BY 4.0, research 17 §8).

**Techniques, named:**
- *Split grammars* for facades: floors, then bays, then window/door/plain
  tiles per wall (Müller et al. 2006, "Procedural Modeling of Buildings",
  CGA shape; Wonka et al. 2003, "Instant Architecture"). Our shader already
  does a crude version; the fix is to drive it from per-wall data (front,
  side, party, levels) instead of one formula for all walls.
- *Interior mapping* (van Dongen 2008): a ray-box test against virtual
  floors and walls behind the glass, in the shader, so windows show rooms
  with parallax. Variants use a cubemap or a small atlas of rooms; for
  houses, curtains and blinds per window do as much as the room.
- *Straight skeleton* roofs: hipped roofs on any polygon (L-shapes, bays),
  with the eaves at one height.
- *Near-field kit swap*: modular pieces (bay, door bay, plain, corner, roof
  section, porch, chimney) placed on the nearest buildings by type; the
  shader facade beyond (BoundlessNYC; our `docs/blender-assets.md` §6).
- *Weathering*: dirt at the base, streaks under sills and from the eaves,
  darker under eaves and in corners (baked AO per vertex or a sky-visibility
  map; research 17 item on large-scale AO).

## 4. The differences, ranked by how much they hurt from the driver's seat

Cost: S = under a day, M = days, L = weeks or modelling work.
"Data" says where the fix comes from.

1. **Houses wear shopfronts.** About 5,000 buildings get roller shutters
   and sign bands; Finglas has about 350 commercial buildings, nearly all in
   the village, parades and business parks. Every residential street the
   test routes use is affected. Fix: a shopfront only when the building is
   a shop (Overture `class` retail/commercial, OSM `shop`/`amenity` inside
   the footprint, an Overture place inside it), and only on the wall facing
   the road. Drop the one-in-three rule for Dublin (keep it for Lagos,
   where it's true). Cost **S**. Data: we have it (OSM, Overture class,
   places already in `finglas.json`).

2. **Terraces drawn as rows of separate hipped houses, each its own
   material.** 91% of house footprints share a wall; each gets a pyramid
   roof and a random brick-or-render finish, so a terrace reads as a row of
   different little houses with valleys between. Fix: group footprints into
   terraces in the bake (shared edges, as measured here; later Tailte
   Éireann Building Groups), build one roof per group: ridge along the row,
   hipped or gabled ends (OSM `roof:shape` where present, `gabled_row`
   means gabled; else a seeded mix per estate), stopped at party walls the
   way OSM2World's `side_hipped` does. Finish chosen per group; paint tint
   per house. Party walls get no facade. Cost **M**. Data: footprints we
   have; roof tags for 5%; the rest is a rule per estate.

3. **Windows and doors in the wrong places.** Upper windows cut by the
   eaves (3.2 m floors on a 5.6 m wall), windows wrapping corners, doors and
   window rows on gables, sides and party walls. Fix: storey height =
   wall height / levels (Streets GL), whole bays per wall (Streets GL,
   OSM2World, Tokyo), and a per-wall role in the vertex data: front, side,
   back, party. The front is already found for every house by `gardens.ts`;
   that logic should move to one place the facade and the gardens both read
   (one source of truth). Front: the Corporation layout (door with side
   light plus one wide window below; one wide and one narrow above). Side:
   blank or one small window. Party: nothing. Cost **S-M**. Data: we have
   it.

4. **Heights jump inside a terrace.** 5.6 m, 6.8 m and a random 8.4 m in
   the same row; one house in seven is three storeys, where OSM says one in
   45. Fix: for Dublin houses, eaves = levels × 2.7 + 0.3 m (about 5.7 m for
   two storeys) whether the level count is tagged or guessed, no random
   third storey, and one height per terrace group (median). Later, GSI lidar
   per building (research 17). Cost **S**. Data: OSM levels, Overture
   `num_floors`; lidar later.

5. **Too much brick, and the wrong render.** 44% red brick; Corporation
   Finglas is mostly dashed render, painted. The render set (Poly Haven
   `white_plaster_rough_02` at 55% contrast) is a fine plaster, not the
   coarse aggregate of pebbledash. Fix: palette per estate type (Corporation:
   render in creams, whites, greys, with a minority of brick ground floors;
   private 1960s-70s: brick fronts, render upper); a pebbledash set, either
   a CC0 scan if one exists (check Poly Haven, ambientCG) or baked from a
   procedural material in Blender by the owner's local Claude. Cost **S**
   for the palette, **S-M** for the texture. Data: estate type from OSM
   names and landuse, or a hand-drawn area list for Finglas.

6. **Flat, edgeless houses.** No window reveals or sills, no fascia or
   gutter, no chimneys, no porches or canopies, no dishes. These are the
   cues that make a house read as a house at 10-30 m. Fix, in order of
   value per hour: a fascia board and gutter along every eave (geometry in
   `hipRoof()`, **S**); chimney stacks on the ridge at shared party walls,
   one per pair (**S**, once terraces exist); window reveals and sills as
   shader depth near the camera (**M**) or as the §6 kit pieces (**L**);
   porches and door canopies from the kit (**L**, modelling). Data: none
   needed beyond the terrace groups and fronts.

7. **Business parks and big shops look like apartment blocks.** Anything
   over 900 m² gets the house window grid on 3.2 m floors under a parapet.
   Fix: by class (Overture `class`, OSM `building=industrial/warehouse/
   retail/commercial`, `landuse=industrial`): a block plinth, profiled metal
   cladding (the corrugated set exists, painted grey, teal or blue), roller
   doors on one wall, an office glazing strip, no house windows. Cost **S-M**.
   Data: we have it.

8. **Glass reads as black holes.** Flat dark glass and a white frame. Fix:
   interior mapping (van Dongen) with net curtains and blinds per window,
   plus a Fresnel sky reflection; this is roadmap 13. Cost **M**. Data: none.

Smaller, later: sheds of 14-25 m² get tiled hipped roofs and windows (OSM
says 4,053 `building=shed`, mostly in back gardens; Overture's `class`
would mark them: no windows, felt or metal roof); hipped roofs from the
long axis only, wrong on L-shaped footprints (straight skeleton); the
window grid turns into a grey checkerboard past ~100 m (`happy-medium/010`);
no ridge or hip tiles on roofs.

## 5. Where this sits in the roadmap

Items 1, 3, 4 and 7 are data and rule changes to `bake_world.py` (carry
`class`, `num_floors`, roof tags; terrace groups; per-wall roles) and to
`world.ts`/`facade.ts`; they need the baked format to grow (`LGW3`) and the
cascade that comes with it (old `.bin` files, `places.json`, tests). Item 2
is the biggest single step and the base for 6 (chimneys, fascia) and for
the house kits in roadmap item 13 (`docs/blender-assets.md` §6), which
need to know which wall is the front and which houses form one terrace
before they can place a single piece. Doing 1-4 first makes the kits
cheaper and keeps the shader facade right everywhere the kits don't reach.

## Sources

- Dublin City Council, *Finglas: a Regeneration Strategy* (2005), PDF:
  https://www.dublincity.ie/sites/default/files/media/file-uploads/2018-05/Finglas_Regeneration_Plan.pdf
  (read for facts; council publication, not reused).
- Dublin Review of Books, review of Joseph Brady, *Dublin 1950-1970: Houses,
  Flats and High Rise*: https://drb.ie/article/the-city-spreads-out/ (quoted line only).
- Four Courts Press, the book: https://www.fourcourtspress.ie/books/2016/dublin-1950-1970
- Wikipedia, Finglas: https://en.wikipedia.org/wiki/Finglas (CC BY-SA, facts only).
- O'Neill, Gunnigan, Clarke (2015), "Evolution of the construction of Dublin
  City Council's housing, with emphasis on wall construction", *Structural
  Survey*, doi:10.1108/SS-09-2014-0034 (paywalled; not read, worth getting
  for wall build-ups and finishes by decade).
- OpenStreetMap building tags, Overpass query 2026-10-05, © OpenStreetMap
  contributors, ODbL. Taginfo for `roof:shape=gabled_row`:
  https://taginfo.openstreetmap.org/tags/roof:shape=gabled_row
- OSM2World, MIT: https://github.com/tordanik/OSM2World (files named in §3).
- Streets GL, MIT: https://github.com/StrandedKitty/streets-gl ;
  straight-skeleton, MIT: https://github.com/StrandedKitty/straight-skeleton
- J. van Dongen, "Interior Mapping: A new technique for rendering realistic
  buildings", CGI 2008:
  https://www.proun-game.com/Oogst3D/CODING/InteriorMapping/InteriorMapping.pdf
- P. Müller, P. Wonka, S. Haegler, A. Ulmer, L. Van Gool, "Procedural
  Modeling of Buildings", SIGGRAPH 2006, doi:10.1145/1141911.1141931.
- P. Wonka, M. Wimmer, F. Sillion, W. Ribarsky, "Instant Architecture",
  SIGGRAPH 2003, doi:10.1145/882262.882324.
- Overture buildings schema (`class`, `num_floors`, `roof_shape`,
  `facade_color`, …): https://docs.overturemaps.org/schema/reference/buildings/building/
- Tailte Éireann HVD Buildings and Building Groups, CC BY 4.0:
  https://data.gov.ie/dataset/high-value-dataset-buildings (research 17).
- Photos looked at, not kept (Wikimedia Commons): "Bilingual signs Finglas"
  (Darren J. Prior, CC BY-SA 4.0), "Finglas Retail Store Front" (CC BY-SA
  4.0), "Finglas Garda Station" and "Church of Our Mother of Divine Grace,
  Ballygall" (geograph.org.uk, CC BY-SA 2.0), "Trading estate in the Tolka
  Valley" (geograph.org.uk 593692, CC BY-SA 2.0), "The Ardmore Hotel,
  Finglas Road" (geograph.org.uk 492291, CC BY-SA 2.0).
