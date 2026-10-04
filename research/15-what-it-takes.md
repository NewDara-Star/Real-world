# 15: What it takes to build a real-world driving simulator

Date: 2026-10-04. This merges research 06–14 into one picture: every system a
real-world driving simulator needs, how the industry builds it, where we are,
and the order we fix things in. The game in one line: **a driving school for
the Irish test (Finglas, automatic) plus a real-world explorer.**

Sources: 09 (open-source sims read line by line: VDrift, Stunt Rally,
Rigs of Rods, TORCS, PhysX/Jolt vehicles), 10 (Forza, Assetto Corsa/ACC,
rFactor 2, iRacing, BeamNG, GT7 from public developer material), 11 (the
G29 and force feedback, from the Linux drivers and sim practice, plus an
audit of our code), 12 (browser driving games: Bruno Simon's folio,
Sketchbook, pmndrs racing, a Claude-built F1 game, others), 13 (driving-school
simulators, real-world map sims, Irish open data), 06/07 (Teleoperator,
djentic, Mars GT).

## The big lesson

Our physics core is not the problem. Every report found our tyre model and
drivetrain are in the same class as the open-source sims and ahead of every
browser game. What made driving feel "all over the place" is **the layer
between the physics and the person**: how often and how smoothly the
simulation runs, how the force reaches the wheel, where the eye sits, and
what you hear. Forza-level feel is that layer done carefully.

## The systems

| # | System | How the best do it | Where we were | Status |
|---|---|---|---|---|
| 1 | **Fixed-rate physics** | Constant step, several per frame, leftover time carried; the drawn car is interpolated between the last two steps. Forza 360 Hz, AC 333, ACC 400, iRacing 360, BeamNG 2000. | 240 Hz but the step size changed every frame; nothing interpolated; a hitch replayed in a burst. | **Fixed (this round):** fixed 1/240 s with an accumulator, interpolated pose, hitches dropped. |
| 2 | **Force feedback delivery** | Computed from rack torque every physics step, sent on a steady clock (Logitech driver: 500 Hz, one command per slot per tick, skip if the USB queue is behind). Damper always on. Centring spring off under real FFB. Min force for the gear dead band. Zero on pause/focus loss. | Once per frame, from the last sub-step only; an unbounded write queue (stale forces played late, the classic "wheel turns itself"); the wheel's own spring fighting the tyre force; no damper (a headless model oscillated to full lock at 30 fps); effect stopped/restarted at every zero crossing; force left on when the map opened. | **Mostly fixed (this round):** latest-value writer with one report in flight; firmware damper (stronger when slow); centring spring off; refresh instead of stop/start; min force; force averaged over the frame; zero on map/pause/blur/hidden plus a 150 ms watchdog. **Still to do:** a wheel worker at ~500 Hz clocked off input reports, with torque extrapolated between frames (research 11 §6). |
| 3 | **Steering input** | Wheel 1:1, linear, no deadzone, rotation set to the car (900°, 14:1 for a Polo). Pad/keyboard: speed-limited lock, response curve, hidden yaw help, all off for wheels. | Physics path 1:1; old path scaled the wheel by speed; on-screen wheel turned half as far as the real one; keys rate-limited twice. | **Fixed:** 1:1 everywhere for the wheel, on-screen wheel matches (±450°), one key rate (asymmetric), ramped pedals on keys. **To do:** pad slip-angle cap and yaw help (off for the wheel). |
| 4 | **Cockpit camera** | Head on a spring-damper neck driven by acceleration; pitch/roll partly locked to the horizon; FOV set from screen geometry (AC default ~56° vertical). | Camera bolted to the body: every bounce and kerb straight into the eye; 68° vertical FOV. | **Fixed:** sprung neck (~1.3 Hz), 35 % pitch/roll, smoothed vertical jolts, FOV setting (default 56°). |
| 5 | **Tyres, suspension, drivetrain** | Pacejka-family tyres, combined slip, low-speed handling, raycast or multi-point contact, real drivetrain data. Forza 2023 went to 8 contact points per tyre at 360 Hz for kerbs. | Rapier + Pacejka + DSG (research 08), tuned to Polo figures. | **Good.** To do: kerb faces (a ramped kerb profile / multi-point contact), surface grip table, wet grip, ESC, low-speed "sticky" state. |
| 6 | **Engine and road sound** | Recorded rpm loops in on-load and off-load layers (AC, VDrift, RoR), or granular (Forza Horizon 5, Codemasters). Road and wind noise rising with speed; tyre squeal from slip relative to the grip peak. | Three oscillators; no road or wind noise; pitch not tied to firing rate. | To do. Needs CC0/CC-BY recordings of a 3-cylinder (or the owner records a real one). |
| 7 | **Road data** | CARLA and SCANeR build towns from OpenDRIVE; driving-test sims need exact lanes, turn lanes, roundabouts, signals, signs. | Overture-derived network: 0 lane tags, 0 roundabouts in Finglas. Finglas is known for mini-roundabouts. | To do, high priority: OSM via Overpass for lanes, turn lanes, roundabouts, speed limits (1,674 Finglas roads tagged). |
| 8 | **Examiner and instructor** | Carnetsoft, Green Dino, Virage, Doron: a virtual instructor with a fixed procedure list, short spoken feedback, logs and a debrief. Users hate instant, unexplained penalties (City Car Driving). | About a dozen checks; not grouped by RSA heading; no manoeuvres; no end-of-test report. | To do: the full RSA sheet (18 headings), tolerances and minimum durations, the real fail rule, the three manoeuvres, mock test from the centre, lesson mode. |
| 9 | **World and elevation** | Real terrain (lidar DTM), buildings, street furniture, vegetation. | Flat world. | To do: GSI open lidar for hills (hill start), furniture density from OSM. |
| 10 | **Traffic and pedestrians** | SUMO-style trips, calibrated car-following, social-force pedestrians, cyclists, parked cars, buses. | Rule-following traffic and people; random turns. | Roadmap items (already planned). |
| 11 | **Look** | Sky reflections, colour grade, auto-exposure, TAA, cascaded shadows, AO only in shade, height fog. | Fixed exposure, SMAA, one shadow box. | Later: matters less for test practice than 1–8. |
| 12 | **Testing and measurement** | Sims tune feel with telemetry; FFB tools measure latency and clipping. | Headless physics tests; nothing on the real wheel. | To do: an in-game wheel test page (direction, dead band, report rate, write latency, hands-off oscillation, G HUB spring check). |

## Settings the owner should check (until the test page exists)

- Wheel check → the source line should say "force feedback on". If it says
  "no force feedback", click Connect wheel.
- "Reverse force feedback" **unticked** (ticked turns centring into pushing).
- In G HUB: rotation 900°, sensitivity 50, **centring spring off**, or quit
  G HUB while driving.

## Decisions taken

- 3D models: the owner's local Claude builds them in Blender
  (`docs/blender-assets.md`); no AI-generated meshes (research 14).
