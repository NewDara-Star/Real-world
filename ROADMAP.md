# Running order

The plan for the driving simulator, in order. Update this file as items move.
Rule: research how the industry does each thing first (simulators, game
engines, published data), then build. See `research/` for the notes.

## Now

1. **Check the textures on the Mac** (user). Atlas textures fixed the black city
   in testing, but they haven't been seen on the real GPU yet. If anything still
   looks wrong: pause → "Real textures: off", and send a screenshot.
2. **Car physics upgrade** (approved).
   - Rigid-body chassis with raycast suspension: Rapier
     (`DynamicRayCastVehicleController` lineage, from Bullet's `btRaycastVehicle`).
   - Pacejka Magic Formula tyres with a published coefficient set (MF-Tyre is
     the industry standard; Tread is a JS reference).
   - Real car data for a typical automatic hatchback: mass, centre-of-gravity
     height, weight split, wheelbase, track, gear ratios, torque curve.
   - Proper collisions (cars, walls, kerbs) from the physics engine.
   - Force feedback from the front tyres' self-aligning torque, as in sim racing.
3. **Live weather** from Open-Meteo (free, no key; runs on the user's machine).
   - Rain particles, wet roads (darker, glossier, reflections), puddles, fog, wind.
   - Wipers get their job; the examiner adds a "use dipped lights in rain" check.
4. **NPC traffic upgrade.**
   - Real trips: origin-to-destination routes that cars drive and return
     (SUMO-style demand), not random turns.
   - Calibrate car-following and lane changing (IDM + MOBIL) against published
     fits to real trajectory data (highD, NGSIM).
   - AI cars show brake lights and indicators, and use them at junctions.
   - Proper models: generic cars, van, Dublin Bus (see `docs/blender-assets.md`).
5. **Pedestrians upgrade.**
   - Social force model (Helbing–Molnár; what PTV Viswalk and others use):
     they keep their distance, pass each other, form lanes.
   - Trips: home to shop, bus stop, school; groups; waiting at crossings.
   - Animated models.

## Next: look (from the Teleoperator teardown, `research/06-…`)

6. Colour grade and exposure per time of day; fog warm toward the sun, thinner
   with height.
7. Bake sky visibility (large-scale AO) into the world; proper sun shadows (CSM
   with a static cache); temporal anti-aliasing plus sharpen instead of SMAA.
8. Building fronts: facade images per Finglas house style, with metadata that
   drives real 3D porches, eaves and window reveals; interior-mapped windows;
   weathering. Mapillary photos where coverage exists (needs `MAPILLARY_TOKEN`).
9. Road shader: wear, patches, cracks, worn paint, wetness, reflections.
10. Street furniture density from Overture/OSM (4,363 street lamps, bins, bus
    stops, post boxes), trees with wind, front garden walls and hedges.
11. Night: real lamp light spread, wet-road light streaks.

## Then

12. Instructor mode: Finglas test routes, RSA marking sheet, reversing
    manoeuvres, hill start, roundabouts.
13. Real OSM data via Overpass for lane counts, turn lanes and roundabouts.
14. Lagos polish (danfos, keke, okada behaviour, power cuts), then new places
    via `tools/bake/add_place.py`.

## Done

- World map launcher (NASA Earth, places, one-command baking)
- SUMO road network: lanes, junction rules, signals, footpaths, crossings
- Rule-following traffic and pedestrians; the examiner (RSA-style faults)
- Map, sat-nav with spoken directions and road arrows; pause menu
- Real CC0 textures (atlas); the real car model with interior; mirrors
- Car controls: PRND, indicators, wipers, lights, head checks, parking brake
- Traffic reacts to the player: backs off, changes lane, overtakes
