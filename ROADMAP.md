# Running order

The plan for the driving simulator, in order. Update this file as items move.
Rule: research how the industry does each thing first (simulators, game
engines, published data), then build. See `research/` for the notes.

## Raised from the owner's Mac (2026-10-04, local Claude ran the app)

Seen by running the desktop app at 13:00 in Finglas. For the cloud dev to
slot into the order below:

- **Dev autodrive:** built (`?autodrive=happy|sad|idiot|tragedy`, and a
  screenshot mode in the desktop app, see `game/README.md`). Headless on
  Finglas: happy drives with no examiner faults, idiot gets caught, sad
  reroutes after missed turns. It found: the examiner marked speeding once
  per km/h (fixed), judged some junctions on the wrong curve (fixed); the
  sat-nav started routes up to a lane's length ahead (constant "Rerouting"),
  lost its place on long straight segments and on routes that pass back by
  themselves, and sent routes into cul-de-sacs to turn round (all fixed);
  traffic couldn't be seeded (fixed); and
  **3 of Finglas's 83 signals run 6-7 minute cycles** (SUMO's
  `--tls.join` merged clusters, 11 phase groups): fix in `build_net.sh`
  (smaller join distance or capped cycle), still open. Also open: the fps
  meter ignores frames over 1 s, so a very slow machine reads 60.
- **The wheel silently overrides the keyboard:** fixed. Pedals take the
  harder press of wheel and keyboard; steering goes to whichever was touched
  last (A/D, or turning the wheel ~13°), with a message when it changes and
  in Wheel check; force feedback is off while the keyboard steers.
- **Name:** done. The owner chose "World Drive"; title, window, package and
  README use it. (Saved settings keep their `eko-` keys so nobody loses them;
  the deployed worker keeps its name.)
- **House numbers:** done. Map search finds "12 Cappagh Rd" (either order,
  abbreviations, 12a) from OSM's house numbers (4,036 with a street, about a
  quarter of Finglas houses; Overture's addresses theme has none for Ireland,
  checked; Eircode/GeoDirectory are closed). An unmapped number offers the
  street and says it isn't mapped. Dropped pins are named by the address
  there. More coverage needs mapping in OSM (the owner can add their own
  road's numbers there, which is the open way to do it).
- **Front gardens:** built (`gardens.ts`, `streetdetail.ts`). Each Finglas
  house gets its front (the wall facing the street) and its depth to the back
  of the footpath: about 15,000 gardens with walls (render or brick) with
  piers, wall plus hedge, or hedge; a gate path or a driveway (about 40%);
  party walls; bins. Walls stop the car. Lamp posts now stand at the 4,374 real
  OSM lamp positions (the LED model), plus OSM's mapped estate walls and
  hedges (`tools/bake/osm_features.py`). Streamed in 100 m cells near the
  player. Still open: **look checked on the Mac** (in software rendering the
  garden walls read much darker than the houses: check the wall material's
  base colour); a real hedge model (`hedge_privet_1m`, §5); dropped kerbs at
  driveways; a parked car in some driveways.
- **Models need to look real, not just measure right.** Today's street
  furniture is correct in size and names but plain. Next pass uses reference
  photos per asset. Buildings are boxes with one repeated window and trees are
  low-poly blobs (house kits §6 and trees §5 in `docs/blender-assets.md`).
- **Reference photos:** decided. Look at them to model, never store them
  (`.gitignore` refuses anything in `reference/` but previews), no logos or
  identifying features even for chains like Lidl or Tesco.

### Mac screenshot runs, 2026-10-04 night (real GPU: Apple M4, Metal 4)

Runs at 2db1189, 30 shots each, every 15 s: happy, idiot, sad at
`WORLD_TIME=13`; tragedy at `WORLD_TIME=18 WORLD_TIMESCALE=60` (18:00 to
01:30, so it covers dusk; started at the real clock, 23:00, it would miss it).
Shot numbers are `game/shots/<run>/NNN` (kept on the Mac, not committed).

- **City near-black in daylight on the Mac: the GTAO pass at "high". Fixed**
  (GTAO now rebuilds normals from depth; the MRT normal pre-pass read the
  world material's colorNode on Metal, so AO was 0 on every city pixel: shown
  with `?aoview`, and by switching the material's nodes off one at a time).
  Five launches at high afterwards: 43.3-43.5, all correct. The history:
  Deterministic, three launches each at the Finglas spawn, 13:00:
  `quality=medium` 43.7, 43.7, 43.7 (correct); `quality=high` 9.1, 9.1, 9.1
  (lower-half brightness). At high, buildings, ground, kerbs and garden
  pieces are one navy silhouette; cars, people, lamps, sky are fine. Only
  the high/ultra branch of `graphics.ts` `buildPipeline()` differs: the
  normal/depth pre-pass, `ao(...)` at `resolutionScale` 0.5 and
  `builtinAOContext`; on this M4 the AO term comes out ~0 for the city
  materials. It looked random because, with no `quality=` in the URL,
  `adaptQuality` drops to medium below 32 fps: the launches that stuttered
  while loading (happy right after the build; a 20:45 launch with a second
  instance open) rendered right. Ruled out on the way: the atlas
  (readback sum 1,501,971, brick avg 0.154/0.099/0.083, normals 124/149/249;
  `?notex` still dark), shadows (`receiveShadow=false` + `needsUpdate` on
  461 meshes, rebuilt, still dark), caches and saved state (fresh
  `--user-data-dir` dark), code age (c5943ce dark too). Workaround: run the
  Mac at `quality=medium`. Fix: find why AO is ~0 on the facade/ground
  materials (custom `normalNode` vs the pre-pass `normalView`?); confirm
  with five launches at high, brightness per launch.
- **Garden walls, piers and hedges render black at medium too. Fixed:** the
  prop and hedge mapping read `normalWorld` inside the colour node, where it's
  normalize(0) = NaN (seen in the generated WGSL via `__gfx.renderer.debug`);
  they now use `normalWorldGeometry`. History:
  (happy-medium/019 right, happy-medium/024 left: a ~1 m black slab along
  the gardens). Not the models' colour: the walls now carry a white base
  colour (fixed in 57877a2; they had the render's mean albedo, applied twice),
  and the hedges aren't a model at all (`streetdetail.ts` green box,
  `0x3f6a2e`, code -14), yet both are black. So it's in how the prop
  (-11..-13) and hedge (-14) codes render. `hedge_privet_1m` waits on this.
- **LED lamps at night:** at medium, no lamp head glows anywhere in
  tragedy-medium/008-028 although `LampLens` maps to `FACADE_LAMP`
  (`models.ts:15`); no light pools on the road (item 16, not built). Also:
  fully dark already at 18:58 (tragedy-medium/004; Dublin sunset ~19:00;
  fixed: the sun now follows each place's real path, `sun.ts`),
  and lit windows are flat cream rectangles.
- **Autodrive and people: fixed in the driver, one race left in the walkers.**
  The autodrive only asked "is anyone on the crossing of the link I'm about
  to enter?", so it drove into people anywhere else (business-park exits,
  mid-turn). It now stops for anyone in or heading into its path (obstacle
  stop, `autodrive.ts`; test `autodrive-people.test.mts` reproduces the hit).
  In the app: 0 hits in 5 happy runs (before: 2 of 2 within 45 s). Left for
  `trafficnet.ts`: walkers waiting at the kerb judge a car that's just moving
  off as no threat (`gapAt` only counts closing speed or < 5 m), step out as
  it enters, and the examiner marks "Failed to yield to a pedestrian on the
  crossing" (2 of 3 app runs). Walkers should treat a car stopped or moving
  off near their crossing as a threat until it has passed or clearly waits.
- **Happy at medium** hit pedestrians at the business-park exit
  (happy-medium/003) and the Jamestown Road roundabout (happy-medium/009),
  as in happy/004: fixed by the autodrive obstacle stop above; the five
  checking runs (shots/fix1-5) left the business park every time and two of
  them went through that roundabout (fix4, fix5), with no hits. Still open:
  it waited at one red on Saint Margaret's Road for 90 s and more
  (happy-medium/025-030), one of the 6-7 minute signal cycles? Tragedy
  gridlocked on Melville Road again (tragedy-medium/016-028), collecting
  kerb and footpath faults at 0 km/h.
- **Happy driver:** stopped at red lights (happy/005-006, 016-018), no
  signalling faults. It hit a pedestrian crossing at the Jamestown
  Business Park exit (G3, between happy/003 and 004; fixed, see the
  obstacle-stop item above), had a G2 "no left mirror
  check" turning left on red-to-green (happy/015), and sat at 0 km/h behind a
  stopped car for the last 75 s (happy/026-030; a red traffic car is angled
  across the centre line in happy/027-030).
- **Idiot:** speeding is now one fault per offence, not per km/h (idiot/019,
  022, 023). Still odd: two "No signal turning right" within the first 15 s
  (idiot/001); seven faults in one 15 s window including pedestrian and wall
  collisions each twice (idiot/007), possibly one incident counted twice;
  "selected R at 30 km/h" (event 5:39) produced no fault; and it sat stuck
  at 0 km/h after kerb hits for 2 min (idiot/010-018) and to the end
  (idiot/024-030).
- **Sad:** missed turn and reroutes worked (4 reroutes). Mounted the footpath
  at -1 km/h on Finglas Road (sad/019). Sat-nav banner shows the HTML entity
  literally: "Saint Helena&apos;s Road" (sad/026).
- **Tragedy:** gridlocked on Melville Road from tragedy/016 to the end (3.5
  min at 0-1 km/h), picking up kerb, footpath and vehicle collisions while
  stationary (tragedy/017-030): faults should not accrue at a standstill
  from being pushed. 18:43 already looks like night (tragedy/003); sunset in
  Dublin on 4 Oct is about 19:00.
- **Screens:** the autodrive's player car was the green box (fixed: it
  got in before the car model loaded); Wheel check opens over the
  view whenever the G29 is plugged in and covers every shot; the autodrive
  label overlaps the sat-nav's second line. Console: 54 TSL "return in inline
  Fn" warnings and missing Rocketbox bone tracks (Bip01_*) for the clips.
- **Keyboard with the G29 plugged in:** works. W and A drove and turned
  (27 km/h), with "Keyboard is steering. Turn the wheel to take over." on
  screen and "keyboard steering" in Wheel check. Wheel take-back and the
  ~13° threshold need the owner's hands; not tested.
- **House number search:** "48 Melville Way" answers "Melville Way (no. 48
  isn't mapped)" and offers the street: OSM's gap, as designed.

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
   - a test that watches AI cars yield to the right at a mini-roundabout
     (item 9, step 1); the junction rules themselves are now measured;
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
9. **NPC drivers, the self-driving way** (research 21: Autoware, Apollo,
   nuPlan, Waymo's sim-agent metrics, SUMO and Treiber's driver models).
   Architecture: each situation (light, stop line, give-way, roundabout,
   crosswalk, junction) puts a stop point or speed cap on the car's path and
   the lowest wins; IIDM/ACC car following; one "assertiveness" number per
   driver that sets all their habits; gap acceptance from arrival times at
   conflict points. Build order:
   1. Seeded randomness and a realism test (collisions, red lights, speed,
      acceleration, headway, gaps, junction blocking) run on today's code as
      the baseline. Includes the open test from item 3: watching AI cars
      give way at a mini-roundabout.
   2. The constraint architecture; driver profiles and small human noise.
   3. Real gap acceptance at give-ways, stop signs, roundabouts and
      mini-roundabouts (today it's a fixed 4.5 s for everyone).
   4. Keep-clear boxes (don't enter a junction whose exit is full); NPC
      indicators and brake lights.
   5. Routes and lane choice with MOBIL lane changes and merges; right turns
      across traffic waiting inside the junction.
   6. Zebra courtesy, parked cars and passing them, reactions to the learner,
      occasional human errors, buses (Dublin Bus model from the Blender brief).
   Real trips, calibration to NGSIM (public domain), cyclists.

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
    bin, bollard, telecom cabinet, garden wall pier and 1 m section. Placed so
    far: lamp posts, garden walls, piers and bins (`gardens.ts`,
    `streetdetail.ts`, drawing `extras.surface` materials from the texture
    atlas); the rest not yet. Trees: done for the near ones (ez-tree ash, oak
    and aspen, the nearest 160 within 170 m, `trees.ts`); the rest are still
    low-poly crowns. Grass blades on lawns and verges within
    28 m (`grass.ts`). Next for trees: baked impostor cards for distance (research 22,
    `docs/blender-assets.md` §5), Irish species (ash, sycamore, cherry,
    lime), generated with ez-tree (MIT, research 22) then baked; then roof clutter (HVAC, skylights) from OSM tags on flat roofs.
    Bus built (`tools/assets/build_bus.py`, `bus_dublin_dd.glb`, ~5k
    triangles): two decks of seats behind real window openings,
    `DestinationBlind`, the car's light materials and indicator names, wheel
    pivots at their centres. Traffic cars built too (`car_traffic_1-5.glb`,
    `tools/assets/build_traffic_cars.py`, ~7k triangles each). Dublin traffic now
    draws the cars and the bus (`setVehicleModels`), and Dublin's signals
    are the Irish pole and head models (`RoadSigns.useModels`). Each car has its own
    paint (greys, silver, black, white, blues, a few reds; the SUV stays black). Next: working
    brake lights and indicators on the models, turning wheels. Shopping list for the
    owner's Sketchfab downloads: a real compact-SUV base (the pack's SUV is a
    big American type, scaled down). The cars came from a CC-BY base (owner's decision 2026-10-05:
    vehicles may start from CC-BY or CC0 models, reworked in Blender and
    credited).
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
