# Running order

The plan for the driving simulator, in order. Update this file as items move.
Rule: research how the industry does each thing first (simulators, game
engines, published data), then build. See `research/` for the notes.

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
   centring spring off. Also still: textures on the real GPU.
2. **Wheel test page and wheel worker.** Measure direction, dead band, input
   report rate, write latency and hands-off oscillation on the real wheel;
   then move the wheel into a worker at ~500 Hz with torque extrapolated
   between frames (research 11 §6).
3. **Road data for Finglas** from OSM (Overpass): lane counts, turn lanes,
   roundabouts and mini-roundabouts, speed limits. Our Overture network has
   none of these (research 13).
4. **Examiner to the full RSA sheet:** 18 headings, tolerances and minimum
   durations, the real fail rule, an end-of-test report, then the three
   manoeuvres (reverse round a corner, turnabout, hill start) and a mock test
   from the Finglas centre. Lesson mode with an instructor whose cues fade.
5. **Sound:** engine from recorded rpm loops (on/off load), road and wind
   noise, tyre squeal from slip against the grip peak.
6. **Physics next:** kerb faces, surface grip (grass, wet), ESC, pad/keyboard
   yaw help (off for the wheel), the danfo on the new model.
7. **Elevation:** open lidar terrain for hills (needed for the hill start).
8. **Live weather** from Open-Meteo: rain, wet roads, fog; wet grip in the tyres.
9. **NPC traffic:** real trips, IDM/MOBIL calibrated to highD/NGSIM, brake
   lights and indicators, cyclists, parked cars, buses (Dublin Bus model from
   `docs/blender-assets.md`).
10. **Pedestrians:** social force model, trips, crossings, animated models.

## Next: look (Teleoperator, djentic and Mars GT teardowns, `research/06-…`, `07-…`)

11. Sky reflections: render the sky into a cubemap for `scene.environment`;
   clearcoat car paint. Colour grade and auto-exposure keyed to sun height and
   weather; height fog coloured by the sky.
12. Bake sky visibility (large-scale AO) into the world, and apply GTAO only in
   shade; cascaded sun shadows (`CSMShadowNode`, staggered refresh); temporal
   anti-aliasing plus sharpen (`TRAANode`) instead of SMAA; adaptive quality by
   pixel budget.
13. Building fronts: facade images per Finglas house style, with metadata that
   drives real 3D porches, eaves and window reveals; interior-mapped windows;
   weathering. Mapillary photos where coverage exists (needs `MAPILLARY_TOKEN`).
14. Road shader: wear, patches, cracks, worn paint, wetness, reflections.
15. Street furniture density from Overture/OSM (4,363 street lamps, bins, bus
    stops, post boxes), trees with wind, front garden walls and hedges.
16. Night: real lamp light spread, wet-road light streaks.

## Then

17. Lagos polish (danfos, keke, okada behaviour, power cuts), then new places
    via `tools/bake/add_place.py`.

## Done

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
