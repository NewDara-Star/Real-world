# Running order

The plan for the driving simulator, in order. Update this file as items move.
Rule: research how the industry does each thing first (simulators, game
engines, published data), then build. See `research/` for the notes.

## Raised from the owner's Mac (2026-10-04, local Claude ran the app)

Seen by running the desktop app at 13:00 in Finglas. For the cloud dev to
slot into the order below:

- **Dev-only autodrive** (`?autodrive=1`): hand the player car to the AI
  driver along the sat-nav route, so a local Claude (or a test) can drive a
  route and screenshot it. Driving by key bursts between screenshots left
  the road within 100 m.
- **The wheel silently overrides the keyboard.** With the G29 plugged in,
  `wheel.ts` takes steer and pedals from the wheel only, so its idle pedals
  zero the keyboard; nothing on screen says so ("nothing behind their back").
  Show it, or let the keyboard drive while the wheel's pedals are idle.
- **Name:** the window title still says "Eko World — walk real Lagos" in
  Finglas (and the Electron window is "Eko Drive"). The owner wants one name
  of our own, e.g. "World Drive". Owner's decision; then change it everywhere.
- **House numbers:** map search finds streets only. The bake keeps no
  addresses at all (no OSM `addr:*`, no Overture addresses theme), so a home
  address can't be found. Import whichever has Finglas coverage (check both;
  Eircode/GeoDirectory are closed). Never hard-code the owner's address.
- **Front gardens:** between road and houses is open lawn. Real Finglas
  estates show footpath, kerb, garden wall with piers, hedge, driveway, bins
  and lamp posts; that strip is most of the view from the car. The models
  exist (`public/models/`, item 15); placing them is the biggest realism win.
- **Models need to look real, not just measure right.** Today's street
  furniture is correct in size and names but plain. Next pass uses reference
  photos per asset. Buildings are boxes with one repeated window and trees are
  low-poly blobs (house kits §6 and trees §5 in `docs/blender-assets.md`).
- **Owner's decision needed:** reference photos from Geograph (CC BY-SA) and
  Wikimedia Commons (per-file licences). Proposal: use them only as modelling
  reference, never as textures or in the repo, like the Mapillary question.

## Now

The research in `research/09`–`15` (open-source sims, Forza/AC/iRacing/BeamNG,
the G29 and force feedback, browser driving games, driving-school sims) says
the physics core is fine and the feel problems are in the layer between the
physics and the driver. `research/15-what-it-takes.md` is the full map.

1. **Try the new feel on the G29** (user). Fixed so far: force feedback
   writes no longer queue up, the wheel's firmware damper is on, its own
   centring spring is off, force is zeroed on pause/map/focus loss, fixed
   240 Hz physics with smoothing, a sprung driver's head, a cockpit field of
   view setting, 1:1 on-screen wheel. Check: Wheel check says "force feedback
   on", "Reverse force feedback" unticked; in G HUB 900°, sensitivity 50,
   centring spring off.
2. **Wheel test page and wheel worker.** Measure direction, dead band, input
   report rate, write latency and hands-off oscillation on the real wheel;
   then move the wheel into a worker at ~500 Hz with torque extrapolated
   between frames (research 11 §6).
3. **Road data for Finglas.** Built: the network comes from real OSM (52
   roundabout junctions, 24 mini-roundabouts as give-way-to-the-right
   junctions with a painted circle, 228 multi-lane sections, 83 signals, real
   limits); Overture is only the fallback. Still open:
   - a test that watches AI cars yield to the right at a mini-roundabout;
   - a drive through them on the Mac;
   - the examiner's roundabout rules (item 4), roundabout arrows and markings;
   - Irish open records (research 17, CC BY): Tailte Éireann buildings, GSI
     lidar heights per building, Dublin City Council lamps, trees and signal
     sites (to check SUMO's signals).
4. **Examiner to the full RSA sheet:** 18 headings, tolerances and minimum
   durations, the real fail rule, an end-of-test report, then the three
   manoeuvres (reverse round a corner, turnabout, hill start) and a mock test
   from the Finglas centre. Lesson mode with an instructor whose cues fade.
5. **Sound:** engine from recorded rpm loops (on/off load), road and wind
   noise, tyre squeal from slip against the grip peak.
6. **Physics next:** kerb faces, surface grip (grass, wet), ESC, pad/keyboard
   yaw help (off for the wheel).
7. **Elevation:** open lidar terrain for hills (needed for the hill start); one
   height grid that roads, paint and the physics all read, with a test on real
   Finglas data (the Tokyo approach, research 16).
8. **Live weather** from Open-Meteo: rain, wet roads, fog; wet grip in the tyres.
9. **NPC traffic:** real trips, IDM/MOBIL calibrated to highD/NGSIM, brake
   lights and indicators, cyclists, parked cars, buses (Dublin Bus model from
   `docs/blender-assets.md`). Lane changes limited by forward speed (no
   sliding sideways when stopped; research 17). Spawns weighted by road class,
   later by Dublin's junction counts; a driver profile per place (assertive
   share, gap acceptance, junction blocking), which Lagos needs (research 18).
10. **Pedestrians:** human-looking people are in for Finglas (research 20):
    33 Microsoft Rocketbox people (MIT) built by
    `tools/assets/people/build_people.mjs`, drawn as instanced skinned meshes
    from baked animation textures (`crowd.ts`), stride matched to walking
    speed, near/far detail; the player and other players are real people too
    (`avatar.ts`). Still open: social-force walking and trips, waiting at
    crossings with the right idles, a native-WebGPU check on the Mac, and
    Lagos people from MakeHuman/MPFB2 (CC0; about 3 days) since Rocketbox has
    few Black civilians and no West African clothing.

## Next: look (Teleoperator, djentic and Mars GT teardowns, `research/06-…`, `07-…`)

11. Sky reflections: render the sky into a cubemap for `scene.environment`;
   clearcoat car paint. Colour grade and auto-exposure keyed to sun height and
   weather; height fog coloured by the sky.
12. Bake sky visibility (large-scale AO) into the world, and apply GTAO only in
   shade; cascaded sun shadows (`CSMShadowNode`, staggered refresh); temporal
   anti-aliasing plus sharpen (`TRAANode`) instead of SMAA; adaptive quality by
   pixel budget.
13. Building fronts from the house-type kits (`docs/blender-assets.md` §6,
    built by the owner's local Claude in Blender): the game places the
    pieces per building by type and size, swaps colours, and paints real
    shop names from OSM on the shop-parade fascias. Order: Dublin
    Corporation terrace kit, then shop parade, flats, Lagos compound. Until
    the kits arrive, facade images per Finglas house style, with metadata that
   drives real 3D porches, eaves and window reveals; interior-mapped windows;
   weathering. Mapillary photos where coverage exists (needs `MAPILLARY_TOKEN`).
14. Road shader: wear, patches, cracks, worn paint, wetness, reflections.
    Windows: a whole number of bays per wall (ours wrap round corners), rooms
    behind the glass, night windows switching on and off; carry Overture's
    building class, floors and facade colour through the bake (research 16).
15. Street furniture density from Overture/OSM (4,363 street lamps, bins, bus
    stops, post boxes), trees with wind, front garden walls and hedges.
    Models built (`tools/assets/build_street_furniture.py`, in `public/models/`):
    lamp post, signal head and pole, post box, bus stop pole and shelter, wheelie
    bin, bollard, telecom cabinet, garden wall pier and 1 m section. Not yet
    placed in the world; when they are, the game draws materials with
    `extras.surface` (walls, cabinet plinth) from its texture atlas. Trees and
    hedges still to build.
16. Night: a top-down light map for street lamps and every car's headlights
    (overlaps take the brighter, not the sum; research 16), wet-road streaks.

## New places from cities' own 3D models (research 19)

- `tools/bake/import_citymodel.py`: read a city's open 3D model (CityGML or
  CityJSON via cjio and citygml-tools; PLATEAU via its MIT converter; lidar
  via laspy/PDAL), reproject, join to Overture, and write real heights and
  roof types into the world file (1–2 days), then real roof meshes (2–4 days).
  Wall and roof colours from photo textures, not the textures themselves.
- Easiest rich places first: Tokyo (PLATEAU, left-hand traffic), the
  Netherlands (3D BAG + AHN lidar; the simplest test of the importer),
  Helsinki/Espoo, Berlin, Hamburg or NRW, Zürich, Vienna, New York,
  Hong Kong, Luxembourg. About 50 of the ~90 sources surveyed fit our
  licence rule; check each licence on the owner's Mac before importing
  (government portals are blocked from the cloud sandbox).
- Finglas gets the lidar path (GSI heights); Yaba stays on Overture plus
  Google Open Buildings 2.5D heights (CC BY).

## From the city teardowns (research 16–18), slotted in when their item comes up

- World data and bake: footpath widths measured from the building line; an
  automatic accuracy report from `add_place.py` (what matched, what's
  missing); a provenance table of every data source and its licence; a
  population-density grid (Meta or WorldPop, licence to check) for
  pedestrians, parked cars and people per building from floor area; land use
  mapped by how people use it.
- Look: building style per neighbourhood, not per city, with notes on
  Finglas house types; street furniture as culled instances with a separate
  shadow set.
- Lagos: clamp road widths to the gap between building frontages (road class
  is unreliable there).
- Rendering and loading: texture arrays instead of the two atlases (plus a
  second sample to hide tiling); worker meshing with a three-free mesher and
  tiles streamed by distance; far-LOD tiles for the explorer (research 16 §8,
  17 item 10). Needed before any big place; Finglas is fine as it is.
- Explorer polish: shop fascia signs from OSM names; a map toggle that shows
  open reference images (land use, plan zones) over the world for checking.
- Process: before/after URL flags for visual changes (removed once decided),
  and headless triangle-count and z-fighting checks.
- **Owner's decision needed:** Mapillary photos are CC BY-SA (share-alike),
  which isn't on our licence list, yet item 13 plans to use them. Allow
  them for facade images, use them only for checking, or drop them.

## Then

17. Lagos polish (danfos, keke, okada behaviour, power cuts), then new places
    via `tools/bake/add_place.py`.

## Done

- Real textures confirmed on the Mac's GPU (owner)
- Checks and hooks: `npm run check` (typecheck + pass/fail tests for physics,
  force feedback, traffic, examiner, credits and privacy); git hooks for
  credits, privacy, Story: paragraphs and a second-Claude review on push
- The danfo on the real physics (HiAce-class spec); the old bicycle model deleted
- Research 09–15: how real sims are built; the feel fixes from it (FFB
  pacing, damper, fixed-step physics, sprung head, FOV setting)
- Car physics: Rapier rigid body, raycast suspension, Pacejka tyres, DSG
  automatic, ABS/TCS, wall and traffic collisions, tyre-torque force feedback
- World map launcher (NASA Earth, places, one-command baking)
- SUMO road network: lanes, junction rules, signals, footpaths, crossings
- Rule-following traffic and pedestrians; the examiner (RSA-style faults)
- Map, sat-nav with spoken directions and road arrows; pause menu
- Real CC0 textures (atlas); the real car model with interior; mirrors
- Car controls: PRND, indicators, wipers, lights, head checks, parking brake
- Traffic reacts to the player: backs off, changes lane, overtakes
