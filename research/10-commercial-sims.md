# 10: How commercial driving games work inside, and what "Forza-level feel" needs

Date: 2026-10-04. Scope: public sources only (developer statements, official
support pages and patch notes, modding docs, papers, reputable write-ups). No
decompiling, no code copied; techniques and numbers only.

**How sure each claim is.** Every claim carries a tag:

- **[S]** sourced from the developer: official site, support page, patch notes, dev interview or talk.
- **[C]** community or secondary source: setup guides, modding forums, journalists quoting devs indirectly.
- **[X]** our inference or speculation. Treat it as a hypothesis to test.

Note on method: this sandbox's network proxy blocked most primary sites
(forza.net, gran-turismo.com, beamng.com, gdcvault, gtplanet, wikipedia), so
many facts below were read through search-engine extracts of those pages
rather than the pages themselves. The links are the original pages. Re-check
any number before building on it.

---

## Summary: what "Forza-level feel" is made of

"Feel" is not one system. Every commercial game that feels good gets these
seven things right. Our physics core (research 08) is already in the right
family. **Most of what feels "all over the place" is in systems 2, 3 and 4.**

| # | System | What the industry does | Numbers |
|---|---|---|---|
| 1 | **Fixed-rate physics, decoupled from rendering** | The simulation runs at a constant step, many steps per frame. Rendering shows a state interpolated between the last two physics steps. | Forza Motorsport 2 onward: 360 Hz [S, Guinness]. Forza Motorsport (2023): tyre contact now also at 360 Hz with 8 contact points per tyre, up from 1 point at 60 Hz in FM1–FM7 [S]. Forza Horizon 1: 320 Hz [C]. Assetto Corsa: 333 Hz [C, Kunos forum post]. ACC: 333 Hz up to v1.7, 400 Hz from v1.8 [C]. iRacing: 360 Hz inner loop, 60 Hz outer [C, iRacing staff]. BeamNG: 2000 Hz (0.5 ms steps) [S]. Colin McRae: DiRT: 1000 Hz [S, Guinness]. **Ours: 240 Hz, but the step size changes with frame time and nothing is interpolated.** |
| 2 | **Force feedback computed from the physics, at physics rate, sent at a steady rate** | Torque comes from the steering rack or column: the tyres' aligning torque through pneumatic and mechanical trail, plus suspension loads for road feel. A few synthetic layers sit on top (damper, centre spring, kerb/slip/road effects). Players get gain, filter, min force and per-layer scales. | AC: FFB updated every physics step (333 Hz) unless `FF_SKIP_STEPS` > 0 [C]. ACC: user-selectable FFB frequency, 400 Hz recommended [C]. iRacing: 60 Hz to the wheel, with 6 samples per tick at 360 Hz for wheels that support it; irFFB upsamples to 360/720 Hz with about 29 ms total delay [C, S-GitHub]. BeamNG: asks the driver for up to 2 kHz but the rate varies; smoothing slider 100–300 [S-docs extract]. Linux new-lg4ff driver for Logitech: 2 ms timer (500 Hz), up to 4 commands per tick [S-GitHub]. **Ours: once per render frame (~60 Hz), 8-bit, sampled from the last substep, plus the wheel's own hardware autocentre spring.** |
| 3 | **Steering input that is 1:1 on a wheel** | The wheel angle is the car's steering-wheel angle. No deadzone, linear, the lock matched to the car (soft lock), and no input assists for wheel users. | Forza: "input layers" of Normal steering "are turned off any time you use a wheel" [S, Forza support]. Forza Horizon defaults: steering linearity 50 (linear), inside deadzone 0 recommended [C]. AC car.ini sets `STEER_LOCK` (degrees, centre to one side) and `STEER_RATIO`, so the game knows the car's real wheel rotation [C]. rF2 and iRacing set the wheel's rotation per car ("Range set by vehicle") [C]. **Ours: 1:1 on the physics path (900°, 14:1, ±32°). The legacy non-physics path still scales wheel lock by speed (`drive.ts` around line 545); remove that.** |
| 4 | **Pad and keyboard steering that hides the physics** | A speed-sensitive lock limit, a rate limit (filter), a response curve (gamma), and on pads a hidden stability layer. | Forza Normal steering "influences the yaw inertia of the car to help maintain control during rapid lock-to-lock steering" [S, Turn 10 staff post]. AC pad: speed sensitivity, steering speed, gamma, filter, deadzone; Kunos suggest 65 % stability control on a pad and 0 on a wheel [C]. GT7: Countersteering Assistance, ASM, Steering Assist [S, GT7 manual]. AC "Advanced Gamepad Assist" mod: cap the steer angle at the front tyres' peak slip angle, add a caster-like self-steer [S-GitHub, MIT]. **Ours: speed-based lock limit using a lateral-g target, plus a rate limit. A reasonable start; no slip-angle cap, no self-steer.** |
| 5 | **Driver aids that a road car really has, on by default** | ABS, TCS and stability control are on by default. Arcade titles add hidden yaw damping. | Forza defaults for new players: ABS on, TCS on, STM on, Normal steering [C]. AC stability control "is a fictional force" [C]. **Ours: ABS and TCS modelled; no ESC (standard on EU cars since 2014).** |
| 6 | **Cockpit camera with a neck** | The head sits on a spring-damper "neck" driven by chassis acceleration. Roll and pitch can lock to the horizon (a comfort setting). FOV should match the screen's geometry. | iRacing: Roll Chassis %, Pitch Chassis %, Neck Motion %, G-force sliders, Lock to Horizon [S, iRacing support]. AC: G-force sliders (e.g. 0.4x), lock to horizon [C]. Forza: a "Camera Motion Effects" toggle [C]. **Ours: no head motion; cockpit FOV 68° vertical, which is about 104° horizontal on 16:9, roughly 2× the geometric value for a desktop monitor [X, arithmetic below].** |
| 7 | **Engine sound from recordings, keyed to rpm and load** | Crossfaded rpm loops in on-load and off-load layers (AC/FMOD, Wwise), or granular synthesis (Codemasters, Forza Horizon 5), or physical modelling (GT7). | FH5: "granular hybrid looping" on every car (FH4: 10–15 % of cars), updated up to ~90 times per second, 8+ mics per recording [C, Playground stream via press]. Codemasters: one engine cycle = one grain; drop or add grains to change speed [C, MCV]. GT7: AES synthesiser, physical modelling with no sampled waveforms [S, GDC 2024 abstract]. **Ours: three Web Audio oscillators.** |

Also important but not a separate system:

- **Latency and jitter.** Haptic studies put acceptable force round-trip
  delay at about 30–60 ms. Jitter feels worse than a steady delay: a varying
  60–140 ms feels less reliable than a constant 90 ms ([arXiv 2307.05451](https://arxiv.org/html/2307.05451v1) and the work it cites) [S, academic].
- **Hardware limits.** A G29 gives about 2.1 Nm peak (G923 about 2.2 Nm) [C].
  Its gears have a force deadband: light forces are not felt at all. Sims fix
  this with a min-force setting or a measured lookup table (LUT, built with
  WheelCheck and used by AC and BeamNG) [C].

---

## Per-game notes

### Forza Motorsport / Forza Horizon (Turn 10 / Playground, ForzaTech)

- **Physics rate.** FM2 ran at 360 Hz [S: [Guinness](https://www.guinnessworldrecords.com/world-records/87933-fastest-physics-engine-in-a-racing-videogame)].
  Forza Horizon 1 ran at 320 Hz, the same as FM4 [C: [Giant Bomb](https://www.giantbomb.com/games/3030-37648/)].
  In FM1–FM7 the *tyre contact* (where the tyre meets the track) was one point
  refreshed at 60 Hz. Forza Motorsport (2023) uses 8 contact points per tyre at
  360 Hz, "a 48× fidelity jump" [S, Turn 10 via
  [GTPlanet](https://www.gtplanet.net/forza-motorsport-new-tire-model-20210528/),
  [TechRadar](https://www.techradar.com/news/forza-motorsport-is-a-huge-generational-leap-from-previous-games-heres-why),
  [GamingBolt](https://gamingbolt.com/forza-motorsports-48x-improved-tire-physics-showcased-in-new-comparison-clip)].
  Why: with a single contact point, kerbs and rumble strips gave inconsistent
  suspension forces and brief losses of contact. **This is exactly our
  footpath-kerb problem** (research 08: "drive up it at any angle").
- **Tyres.** FM4 used tyre data from Pirelli's R&D; the model is Pacejka-heritage [C: [Microsoft "Making of FM4"](https://blogs.microsoft.com/next/2012/05/04/the-making-of-forza-motorsport-4-physics-pirelli-and-performance/)].
  FM (2023) adds real compounds with their own grip and wear.
- **FFB** (FM7 December 2017 rework, kept since; [S] Turn 10 wording via
  [GTPlanet](https://gtplanet.net/setting-your-wheel-up-for-forza-motorsport-7s-new-force-feedback-system)
  and the Forza support pages
  [FM7](https://support.forza.net/hc/en-us/articles/360012736414-FM7-Wheel-Setup-and-Tuning),
  [FH5](https://support.forza.net/hc/en-us/articles/4409761195923-FH5-Wheel-Setup-and-Tuning),
  [FH6](https://support.forza.net/hc/en-us/articles/51642814113427-Forza-Horizon-6-on-Wheel-Advanced-Wheel-Tuning)):
  "physically based": FFB "is created as the tire rolls along".
  - *Aligning torque scale* ("Force Feedback Scale" in Horizon): the main
    force, aligning torque from combined mechanical and pneumatic trail.
  - *Mechanical trail scale*: the static lever arm from suspension geometry.
  - *Pneumatic trail scale*: the dynamic lever arm from the contact patch; "higher = stronger limit feel".
  - *Road feel scale*: higher-frequency load inputs; "road feel comes from
    the individual wheel loads", so you can turn kerbs and cobbles up or down
    "without any ill-effects on aligning torque".
  - *Load sensitivity*, *Wheel damper scale* ("makes the wheel feel heavier
    without adding any information"), *Center spring scale* ("gravity through
    caster, KPI and scrub radius"; set too high it replaces real FFB).
  - Community G29 setups use a small centre spring (15–25) "to bridge
    mechanical slack" and a damper of 20–95 [C].
- **Wheel vs pad.** Normal steering is "multiple systems layered together;
  some alter inputs and some alter vehicle dynamics"; Simulation steering
  turns them off; the input layers are always off on a wheel [S, support
  pages above]. A Turn 10 staffer: Normal steering "influences the yaw
  inertia of the car to help maintain control during rapid lock-to-lock
  steering situations… less agile… but also more stable" [S, forum staff post,
  read via search extract]. **This is the hidden assist: more effective yaw
  inertia or yaw damping on pads, never on wheels.**
- **Wheel input options** (Horizon advanced settings) [C]: steering axis
  inside/outside deadzone, steering linearity (50 = linear), steering
  sensitivity (scales the steering ratio when the wheel's hardware rotation
  differs from the game's). Forza does **not** set the wheel's rotation per
  car; the official advice is to leave the wheel at 900° [C].
- **Camera.** "Camera Motion Effects" can be turned off; there is a slight
  built-in look-to-apex [C, forum].
- **Audio.** GDC 2010 "Forza Motorsport 3 Audio Design" (Caviezel, Shaw)
  asked "How much physics control do I really need to make it sound like a
  car?" [S: [GDC Vault](https://gdcvault.com/play/1013160/Forza-Motorsport-3-Audio-Design)].
  FH5 moved every car to "granular hybrid looping": track recordings up to
  redline and back, cut into per-rotation grains, thousands of files per car,
  played at up to ~90 updates/s, with 8 or more mics per car [C: Fraser Strachan
  on Playground's stream, via
  [Jalopnik](https://jalopnik.com/heres-why-forza-horizon-5-sounds-so-good-straight-from-1847343451),
  [GTPlanet](https://gtplanet.net/fh5-new-audio-20210713)].

### Assetto Corsa and ACC (Kunos)

- **Physics rate**: AC 333 Hz (Kunos post on assettocorsa.net, cited in
  [LFS forum "Physics engine rates of racing sims"](https://www.lfs.net/forum/thread/48927)) [C].
  ACC: 333 Hz up to 1.7, then 400 Hz [C]. Physics is multithreaded so FFB stays
  smooth whatever the frame rate [C: [DSOGaming](https://www.dsogaming.com/?p=81418)].
- **FFB rate**: `controls.ini [FF_SKIP_STEPS]`. 0 means FFB on every physics
  step; 1 halves the rate; 4 is for very old wheels [C: Steam and
  [OverTake](https://www.overtake.gg/threads/kunos-assetto-corsa-cpu-occupancy-99-warning-advice.131882/)].
  ACC has an "FFB frequency" option; 400 Hz is the norm [C:
  [Coach Dave](https://coachdaveacademy.com/tutorials/how-to-set-up-force-feedback-for-acc)].
- **FFB settings** (AC) [C: [get-good wiki](https://www.get-good.net/index.php/Assetto_Corsa_Wheel_Settings_Guide),
  [Brian Koponen G29](https://www.briankoponen.com/assetto-corsa-logitech-g29-g920-settings)]:
  - *Gain*: master multiplier.
  - *Filter*: smooths spikes.
  - *Minimum force*: lifts light forces above the wheel's deadband. Set it to 0 if you use a LUT, or it oscillates.
  - *Kerb, road and slip effects*: synthetic vibrations layered on top.
  - *Enhanced understeer*.
  - `assetto_corsa.ini [FF_EXPERIMENTAL]`: `ENABLE_GYRO` (a gyroscopic damping effect) and `DAMPER_MIN_LEVEL` / `DAMPER_GAIN` (typical 0.2 / 1.0).
  - Per car, `FF_MULT` (about 0.75–1.25) and `STEER_ASSIST` (1.0).
- **ACC FFB** [C: Coach Dave, Driver61]: from the steering column, with each
  GT3 car's rack, tie rods, caster and scrub radius modelled. *Dynamic
  damping* adds speed-dependent weight (100 % is "physically accurate").
  *Road effects* amplify real suspension telemetry rather than canned rumble.
- **Tyres.** AC uses a brush-type model whose parameters are measurable
  quantities [C: OverTake thread, Kunos quotes]:
  - `FRICTION_LIMIT_ANGLE`: peak slip angle.
  - `DX_REF` / `DY_REF`: grip coefficients.
  - `LS_EXPX` / `LS_EXPY`: load-sensitivity exponents, about 0.5–0.6.
  - `FALLOFF_LEVEL`: grip past the peak.
  - `RELAXATION_LENGTH`.
  - `FLEX`: extra slip angle with load.

  ACC's model adds 3-D carcass flex that depends on pressure and temperature,
  plus three thermal layers (surface, core, inner air) [C: Aris Vasilakos via
  [OverTake](https://www.overtake.gg/threads/assetto-corsa-competizione-blog-post-2-tyres.159095/)].
  **For us, AC's parameter set is a better way to express the Polo's tyre than
  raw B/C/E**, because each number maps to something you can look up or measure [X].
- **Steering**: car.ini `[CONTROLS] STEER_LOCK` (degrees of wheel, centre to
  one side), `STEER_RATIO` and `LINEAR_STEER_ROD_RATIO`. Example: 360° lock at
  15.5:1 gives about 23° at the road wheel [C, GTPlanet modding thread].
- **Pad**: speed sensitivity, steering speed, gamma, filter, deadzone. ACC
  adds Steer Assist [C]. Stability control is a fictional throttle-cutting aid;
  65 % is suggested on pad, 0 on wheel [C].
- **Audio**: FMOD Studio. The SDK ships "AC Audio Pipeline.pdf".
  - Each rpm loop has an *autopitch* rpm, and neighbouring loops crossfade: at 4,600 rpm you hear 40 % of the 4,000 loop and 60 % of the 5,000 loop.
  - On-load volume follows torque, roughly logarithmically.
  - Off-load sound is mostly friction and rises with rpm.

  [C: [assettocorsamods sound guide](https://assettocorsamods.net/goto/post?id=8266)]
- **Camera**: G-force sliders and Lock to Horizon. The "AC Head Physics" mod
  gives the head a 6-DOF spring-damper neck with stiffness and damping per axis
  [C: [OverTake download](https://overtake.gg/downloads/ac-head-physics.68266)].

### rFactor 2 (ISI, now Studio 397)

- FFB is steering-rack or column torque, "raw and uncompromising" [C].
  `Controller.JSON` settings:
  - *Steering torque capability*: the wheel's peak Nm, so the game can scale 1:1.
  - *Steering torque sensitivity*: 0 low, 1 linear, 2 high.
  - *Minimum steering torque*: 8–15 % on gear wheels.
  - *FFB smoothing*: 0–32; about 2–4 removes graininess, and higher values kill detail.
  - "Range set by vehicle" (per-car soft lock).

  [C: [simracingcockpit](https://simracingcockpit.gg/rfactor-2-wheel-settings/),
  [Brian Koponen](https://www.briankoponen.com/rfactor-2-logitech-g29-g920-settings/)].
- In 2010 ISI announced a new FFB system "with lower input lag and much faster,
  more direct steering rack forces" [C: [Wikipedia rF2](https://en.wikipedia.org/wiki/RFactor_2)].
- Tyres: a physical tyre model with carcass and tread nodes, contact-patch
  deformation and heat; flat spots show up as FFB vibration [C,
  [ISR dev blog](https://isrtv.com/development-blog/), [Polimi thesis](https://www.politesi.polimi.it/handle/10589/153184)].
- **Physics rate: not confirmed.** 400 Hz is widely repeated but we found no
  primary source [X].

### iRacing

- Physics: 60 Hz outer loop (real-time clock) with a 360 Hz inner loop [C,
  iRacing staff via [Granite Devices forum](https://community.granitedevices.com/t/iracing-360hz-ffb-with-simucube-2/10613)].
- FFB: 60 Hz through DirectInput. iRacing's David Tucker says DirectInput
  realistically manages 20–30 Hz with plain calls, so vendors write custom
  paths. Since 2024 S2 the game sends six 360 Hz samples per 60 Hz packet and
  the wheel plays them back; this "adds 16 ms of latency" but restores
  high-frequency detail [C, same thread;
  [Fanatec forum](https://admin.forum.fanatec.com/discussion/comment/119451/)].
- irFFB (community, [GitHub](https://github.com/nlp80/irFFB)) reads the
  360 Hz `SteeringWheelTorque` from telemetry, upsamples to 360/720 Hz,
  applies low-latency filters, and adds understeer/oversteer effects. It
  costs about 29 ms total delay [S-GitHub, C].
- FFB settings [C: [Brian Koponen G29](https://www.briankoponen.com/iracing-logitech-g29-g920-settings/)]:
  - *Wheel force (Nm)*: the wheel's real peak.
  - *Max force*: the column torque that maps to 100 %; higher means lighter. An "Auto" button sets it from a clean lap.
  - *Linear mode*: off by default; non-linear compresses the range, which suits weak wheels.
  - *Damping*.
  - *Min force*.
  - `steeringBumpStop_Deg` in app.ini for the soft-lock bump stop.
- Tyre: the "New Tire Model" built from first principles (how the patch of
  rubber moves, distorts and slides), not from fitted curves [S: Dave Kaemmer
  via [OverTake](https://www.overtake.gg/threads/new-tire-model-explained-by-dave-kaemmer.30055/)].
- Camera: Roll Chassis %, Pitch Chassis % (0 % = locked to horizon), Neck
  Motion % (a spring in the neck), Rotate with Velocity, and vertical, lateral
  and longitudinal head G-force [S: [iRacing support](https://support.iracing.com/support/solutions/articles/31000133498-active-roll-axis-cockpit-view-driverheadhorizon-)].

### BeamNG.drive

- Soft-body node-and-beam physics at 2000 Hz, with 0.5 ms steps [S:
  [BeamNG.tech architecture](https://documentation.beamng.com/beamng_tech/architecture/)].
  Rendering is decoupled: at the start of each frame the engine predicts when
  the next frame will start and runs enough 0.5 ms steps to reach it. Below
  20 fps it goes into slow motion rather than taking huge steps [S, same page].
- FFB docs [S: [Steering wheel setup](https://documentation.beamng.com/support/hardware/steering_wheel_setup)]:
  - "The sim sends FFB requests at a variable rate. Even if you set 2KHz, it
    won't always be a perfectly smooth constant stream. Some [wheels] will
    choke with a burst of 10KHz."
  - *Response Correction Curve*: a LUT, because wheels are not linear.
  - *Smoothing*: typically 100–300.
  - *Side acceleration strength*: G-force fed into the rim.
  - *Steering lock strength*: soft lock.
  - Input filters, "1:1 steering angle", linearity and deadzones.
  - One forum report says a filter removes everything above about 100 Hz [C].

### Gran Turismo 7 (Polyphony Digital)

- **Physics rate: not published** as far as we could find.
- Yamauchi calls tyres the hardest part, especially the contact patch with
  heat, wear and surface [S, evo interview via
  [BoxThisLap](https://boxthislap.org/kazunori-yamauchi-gran-turismo-tire-physics/)].
- Assists [S: [GT7 manual](https://gran-turismo.com/us/gt7/manual/drivingoption/03),
  [Update 1.31 notice](https://www.gran-turismo.com/us/gt7/news/00_1462138.html)]:
  - *Countersteering Assistance*: automatically catches rear slides.
  - *ASM*: stability control by braking.
  - *Steering Assist*: stops the player oversteering.
  - TCS and ABS.
- Audio: GDC 2024 "Sound Design of the Real Driving Simulator" (Kimura,
  Takeuchi, Minagawa) [S: [GDC Vault](https://www.gdcvault.com/play/1034189/-Gran-Turismo-7-Sound)].
  - AES (Advanced Engine Sound) is physical-modelling synthesis "without
    using any sampling waveforms", used for cars that cannot be recorded.
  - Over 1,700 cars recorded since GT1; dyno recording with engine, exhaust,
    intake and interior mics [C: [GTPlanet](https://www.gtplanet.net/recording-gt7-sounds-polyphony-digital-20240207/)].

### Codemasters (F1, DiRT, GRID)

- Colin McRae: DiRT physics at 1000 Hz [S: Guinness].
- F1 22 patch 1.06 added the tyres' self-aligning torque to FFB because "its
  peak always happens before the peak slip angle". The result is "a boost in
  torque around the centre", then the wheel loses torque past the peak, "so
  understeer and oversteer can be felt better and sooner" [S:
  [EA patch notes](https://www.ea.com/news/f1-22-patch-106-handling-force-feedback)].
  This is the effect our model already has in principle.
- Engine audio (F1 2010, Mark Knight): "a fundamentally granular approach".
  They analyse a rev sweep, a cycle is one grain, and to play faster "we're
  cutting out cylinders", to play slower they add them. Separate tools handle
  timbre (formant) shift [C: [MCV](https://mcvuk.com/business-news/publishing/heard-about-f1-2010/)].

### Euro Truck Simulator 2 (SCS)

- Physics-based FFB since 1.42. Before that it was a centre spring plus
  vibration effects, which is roughly where City Car Driving still is [C].
  Auto-centre is driven by the game, not the wheel [C].
- Steering *non-linearity* makes the centre less sensitive (useful at
  motorway speed, odd when parking); *sensitivity* matters only for pads [C:
  [Brian Koponen](https://www.briankoponen.com/euro-truck-simulator-2-logitech-g29-g920-settings/)].

### City Car Driving and other driving-school sims

- City Car Driving (Forward Development): an instructor and rule-compliance
  monitor, and traffic rules for the US, Canada, Australia, the EU, Germany
  and Russia, in both left- and right-hand traffic [C: Steam / store text].
- Its FFB is "incredibly basic, mostly a centering force and some vibrations
  on kerbs/grass" [C: [Brian Koponen](https://www.briankoponen.com/city-car-driving-logitech-g29-g920-settings/)].
  Its exams fail you for being 10 cm off a line. **This is the bar we are
  already above on rules. It is not a feel benchmark.**
- Research on simulator training [S, academic]:
  - Haptics matter for motor-skill transfer.
  - Sickness drops as visual fidelity rises, but not on static rigs ([meta-analysis, PMC9678991](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9678991/)).
  - A steering-feel model for simulators is damping + inertia + (aligning +
    jacking torque) × power-assist weighting
    ([TU Delft torque-based control](https://research.tudelft.nl/en/publications/experimental-validation-of-torque-based-control-for-realistic-han/);
    [SAE 2024-01-2994 on-centre feel](https://papers.sae.org/publications/technical-papers/content/2024-01-2994/)).
  - Steering-gear friction is a key parameter.
  - Consumer wheels already add a lot of friction and inertia of their own.

### Microsoft Flight Simulator (world streaming only)

- Tiles stream from Azure. The level of detail requested per tile depends on
  its estimated screen size and the available bandwidth. The engine
  recursively requests tiles in the view frustum and keeps a ring around the
  camera in memory [S: [Asobo "Designing Terrain System" (Fuentes)](https://WWW.ASOBOSTUDIO.COM/files/inline-images/Designing_Terrain_System_Fuentes_Lionel.pdf),
  [FSElite overview](https://fselite.net/content/an-overview-of-the-technical-details-for-the-new-microsoft-flight-simulator/)].
- It is relevant to us only as confirmation that our chunk streaming is the
  standard shape. Nothing here touches driving feel.

---

## Cross-cutting techniques (with numbers)

**Fixed step + interpolation** ([Gaffer on Games, "Fix Your Timestep"](https://gafferongames.com/post/fix_your_timestep/)) [S]:
accumulate frame time and step physics at a constant `h` while the
accumulator ≥ `h`. Render `lerp(previous, current, accumulator/h)`. Clamp
the frame time so a hitch can't spiral. BeamNG adds the "predict the next
frame start" refinement. Godot, Unity and Defold all ship this as "physics
interpolation" ([Godot docs](https://docs.godotengine.org/de/4.5/tutorials/physics/interpolation/physics_interpolation_introduction.html)) [S].

**Where FFB comes from**, in order of realism:

1. Canned effects (spring + vibration): City Car Driving, old ETS2.
2. Aligning torque from the tyres: F1 22, our current model.
3. Rack or column torque with trail split into mechanical and pneumatic, plus
   road feel from wheel loads: Forza since FM7, AC.
4. A simulated steering column with its own inertia, where the torque in the
   column spring is the output: iRacing, rF2, ACC [C/X: inferred from the
   telemetry names and the docs above].

All of them add, on top:

- a damper (speed- or rate-dependent),
- min force or a LUT for the deadband,
- a filter or smoothing (rF2: 2–4 of 32; BeamNG: 100–300),
- a gain or "max force" in Nm,
- a clipping indicator.

**Power steering** for a road car [S, patents and SAE]: assist is high at
parking speed and lower at speed. One measured Fiat Punto had about twice the
rim torque at 100 km/h as when parking. Real EPS rim torques are a few Nm
[X, typical]. A Polo-class car should be light when parking, firm and
self-centring at 50–100 km/h, and should go light when the fronts slide.

**Wheel hardware facts** for the G29:

- About 2.1 Nm peak [C].
- Helical gears, with a deadband and nonlinear response [C].
- The vendor-tool advice everywhere is "centering spring OFF", so it doesn't
  double up on the game's own spring [C].
- The Linux driver runs a 2 ms (500 Hz) command timer and emulates spring,
  damper and friction in software [S: new-lg4ff].

**FOV arithmetic** [X]: correct vertical FOV = 2·atan(screen height / 2 /
eye distance). A 27″ 16:9 monitor (33.6 cm tall) at 60 cm gives about 31°
vertical. A 14″ MacBook (about 19 cm tall) at 50 cm gives about 22°. Most
players won't accept fully geometric FOV on a single screen; the sim-racing
compromise is usually 40–55° vertical. Ours is 68° in the cockpit (three.js
`fov` is vertical), so distances look longer and the speed cue is distorted.
**For a driving-test trainer, where judging gaps matters, this is worth fixing.**

---

## Our game against the industry: what it must do, ranked

Each item has its effort (one person, focused), what it fixes, and how sure we are.

1. **Rebuild the FFB output path.** About 1.5–2 days. High confidence, sourced.
   Today `main.ts` reads the rack torque from the *last* substep once per frame,
   quantises it to 8 bits, sends it only on change, and leaves the G29's own
   hardware autocentre spring on underneath. There is no damper. That gives
   aliasing, stepping, and nothing to stop the wheel oscillating hands-off at
   speed. All of these read as "all over the place". Do what AC and iRacing do:
   - Average the rack torque over the substeps.
   - Run the FFB output on its own steady clock, not `requestAnimationFrame`.
     Aim for 250–500 Hz, matching the Linux driver's 2 ms timer. The rate
     WebHID allows on macOS must be measured first (see item 2).
   - Add a software damper on wheel angular velocity, which we have from the
     input reports, and a little friction.
   - Turn the hardware autocentre off, or keep it tiny and constant.
   - Add min force (about 5–10 %), or better a G29 LUT.
   - Add gain, a filter slider and an on-screen clipping meter.
   - Make sure a hidden or unfocused window zeroes the force, because rAF
     stops then.
2. **Measure the wheel link before tuning anything.** About 0.5 day. High
   confidence that it's needed.
   - Log the input-report rate, `sendReport` round-trip times and queue
     depth on the owner's Mac. Jitter is worse than steady delay, and the
     target round trip is under ~30–60 ms.
   - Check G HUB isn't also driving the wheel (its centring spring off), and
     that the PS/PC mode switch and re-enumeration happen once.
   - We have two input paths (WebHID G29, and a Gamepad-API fallback with
     manual calibration and no FFB). Show which one is live, so "the wheel
     feels different today" can be diagnosed.
3. **Steering-feel model for a road car.** 1–2 days. Medium confidence: the
   structure is sourced, the Polo numbers are estimates. Rim torque = (aligning
   torque from trail + caster jacking and centring) × a power-assist curve
   against speed, + damping + inertia + friction. This is the Delft/SAE
   structure, and Forza's split into mechanical, pneumatic, road-feel, damper
   and centre-spring scales. Expose those five scales in settings. Add a
   standstill "parking" stiffness: a real tyre scrubs when you turn it at rest.
   Today the relaxation-lagged slip makes the wheel nearly limp below walking
   pace.
4. **Fixed timestep with render interpolation.** About 1 day. High confidence,
   standard technique.
   - Replace "ceil(dt/(1/240)) steps of dt/steps" with a constant step: 1/240,
     or 1/360 to match Forza and iRacing, ~0.6 ms extra per frame at today's cost.
   - Keep an accumulator, interpolate the car's render transform and camera
     between the last two states, and cap catch-up steps (BeamNG drops into
     slow motion rather than taking big steps).
   - This makes the tyre lag, ABS, TCS and FFB behave the same at 30, 60 and
     120 fps. Today they vary slightly with frame time.
5. **Multi-point tyre contact for kerbs.** 1–2 days. Medium confidence.
   Forza's stated reason for going from 1 to 8 contact points was kerbs and
   rumble strips. Sample the ground at 3–5 points across each tyre's footprint
   and use a ramped kerb profile (12 cm step with a radius) instead of a step
   function. This also gives a physical kerb strike in the FFB through wheel
   load (Forza's "road feel from wheel loads") in place of today's synthetic
   `kerbJolt`.
6. **Cockpit camera: neck, horizon lock, FOV.** About 1 day. High confidence on technique.
   - A spring-damper neck driven by chassis acceleration, with iRacing-style
     sliders: roll and pitch with chassis 0–100 %, neck motion, G-force scale.
   - Default horizon-locked roll for comfort.
   - Cockpit FOV default about 45–50° vertical, adjustable, with a "geometric"
     preset computed from screen size and seating distance.
7. **Engine audio from recordings.** 2–4 days plus finding CC0/CC-BY recordings. Medium confidence.
   - Minimum industry standard: crossfaded rpm loops (about 1,000 rpm apart)
     in on-load and off-load layers, as in AC/FMOD and Wwise. On-load volume
     follows torque; off-load follows rpm.
   - Granular (Codemasters, FH5) is the next step and fits Web Audio
     (AudioBuffer grains scheduled per engine cycle).
   - Physical modelling (GT7 AES) is research-grade; skip it.
   - Licensing is the blocker: we need CC0 or CC-BY engine recordings of a small
     3-cylinder. The 1.0 TSI is a triple, and its firing pattern is distinctive.
8. **Pad and keyboard assist done the Forza way.** About 1 day. Medium confidence.
   - Keep the speed-based lock cap, but cap at the front tyres' *peak slip
     angle* rather than a lateral-g target (the AC Advanced Gamepad Assist
     technique), and add a small caster self-steer.
   - Add a hidden yaw-rate damper on pad and keyboard only, never on a wheel
     (Forza's "input layers off on a wheel").
9. **ESC (stability control).** About 0.5 day. High confidence, it's on the real car.
   Every EU car since 2014 has it, so the test car does too. Brake one wheel
   when yaw rate departs from the steer-based target. Today we have ABS and TCS
   only.
10. **Remove the speed-scaled wheel lock in the legacy path** (`drive.ts`, the
    `lockScale` used for `device === "wheel"`). About 10 minutes. On a wheel it
    breaks 1:1, which every sim avoids. Either make it 1:1 or delete the legacy
    path if the physics car is always available.
11. **Tyre parameters in AC's measurable form.** About 0.5–1 day. Low
    priority, quality of life. Re-express the Polo tyre as peak slip angle,
    peak μ, load-sensitivity exponent, falloff and relaxation length,
    converting to MF internally. Tuning then means checking numbers you can look up.

Not worth doing for this project: a node-based or thermal tyre model (rF2,
ACC, iRacing). Its benefits show at the limit on a racetrack, not on a driving
test. Soft-body physics (BeamNG) is out for the same reason. 360 Hz FFB sample
playback is out because the G29 and WebHID can't use it.

**Rough total for items 1–6 and 9–10: about 6–8 working days.** In our
judgement that covers most of the gap between "all over the place" and a
Forza-like wheel feel on a G29 [X]. Items 7, 8 and 11 polish it.

### Open questions to settle by measurement, not reading

- Can WebHID on macOS (Electron/Chromium) sustain 250–500 output reports/s
  to a G29 without queueing? And is WebHID usable from a worker, so FFB can
  run off the render thread? We believe dedicated-worker support exists in
  recent Chromium, but this is unverified [X].
- G29 deadband size on the owner's unit: run a WheelCheck-style sweep through
  our own constant-force command and fit a LUT.
- Polo steering turns lock-to-lock. We assume 14:1 and 900°; no published
  figure found.
