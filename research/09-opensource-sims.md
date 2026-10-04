# 09: How open-source driving sims actually work (source-code teardown)

Date: 2026-10-04. Owner's complaint: the driving is "all over the place",
including the connection with the G29. Goal: Forza-level feel. Before building
more, we read the source of the open-source sims to see what they do, with file
paths and numbers. Techniques and numbers only; no code was copied (licences:
VDrift GPL-3, Stunt Rally GPL-3, Rigs of Rods GPL-3, TORCS GPL-2, PhysX BSD-3,
Jolt MIT, Godot-Advanced-Vehicle MIT).

Read from source (shallow clones in the session scratchpad, `oss/`):
VDrift (master), Stunt Rally 3 (master), Rigs of Rods (master), TORCS 1.3.7
(`fmirus/torcs-1.3.7` mirror), NVIDIA PhysX Vehicle SDK (`physx/include/vehicle`),
Jolt Physics (`Jolt/Physics/Vehicle`), Godot-Advanced-Vehicle (Dechode),
Randomation Vehicle Physics (Unity).

**Not read: Speed Dreams.** Its code lives on forge.a-lec.org and SourceForge,
and both are blocked by this environment's network proxy; there's no GitHub
mirror we could reach. Its simuv2 engine is TORCS's, which we did read. What we
know about simuv4 comes from its changelog only (see that section).

---

## The 10 things that make driving feel right

1. **A fixed physics timestep, decoupled from the frame rate.** Every sim we
   read steps physics at a constant dt with an accumulator: VDrift 90 Hz,
   Stunt Rally 160 Hz, TORCS 500 Hz, Rigs of Rods 2000 Hz. The car behaves the
   same at 45 fps and 120 fps. **We don't do this:** our `CarPhysics.step(dt)`
   splits each frame's dt into `ceil(dt·240)` equal sub-steps, so the step
   size changes every frame (4.17 ms one frame, 3.4 ms the next after a
   hitch). Damping, relaxation lag and the wheel-spin integration all depend
   on h, so the car feels a little different every frame.
2. **Tyre forces that stay stable near zero speed.** Slip ratio and slip angle
   divide by speed. The good sims deal with that properly. VDrift and Jolt
   treat friction as a velocity constraint capped by the tyre force. PhysX
   uses minimum slip denominators (1 m/s lateral, 4 m/s passive longitudinal)
   and a "sticky tyre" state below 0.2 m/s. The weaker ones (TORCS, Stunt
   Rally) brute-force it with tiny steps.
3. **Force feedback from the steering rack, filtered, damped and fast.** Every
   sim that has FFB drives it from tyre aligning moment or rack force.
   Two things separate good FFB from bad: how often it updates, and damping.
   None of the open-source sims does FFB well (see below). Commercial
   sims run it at 300 to 400 Hz with a damper.
4. **The wheel maps 1:1 to the road wheels.** No speed-sensitive steering, no
   smoothing, no rate limit on a real wheel. VDrift, Stunt Rally and Rigs of
   Rods all get this wrong in some mode, and each one makes a wheel feel
   vague or laggy. We already do it right for the physics car; keep it.
5. **A correct field of view.** A cockpit view only feels right at the
   real-world FOV for the screen distance. Our cockpit is 68° *vertical*
   (three.js `fov` is vertical), about 100° horizontal on 16:9. That makes
   speed and distances read wrong, and it's a big part of "all over the
   place".
6. **A head that lags behind the car.** Rigs of Rods hangs the camera on a
   sprung 20 kg node. Stunt Rally runs a separate 27 kg spring-damper body
   (1.2 Hz, ζ≈0.37) driven by chassis acceleration. Our camera is bolted
   to the body.
7. **Combined slip with per-axis normalisation.** Divide slip by its peak value
   on each axis, then combine (the Beckman method, used by Stunt Rally; VDrift
   uses Pacejka's Gx/Gy weighting). That way braking in a bend trades grip
   predictably.
8. **Engine sound from recorded samples, crossfaded by rpm and load.** VDrift
   and Rigs of Rods both do this, with separate on-throttle and off-throttle
   sets. Our two-oscillator synth is the weakest part of the audio.
9. **Tyre squeal from normalised slip with a threshold.** VDrift:
   `clamp((σ/σpeak)² + (α/αpeak)² − 0.4)`, per wheel, pitch falling as it
   grows. Squeal tells the driver where the limit is.
10. **Kerbs and road texture come out of the physics, not out of a script.**
    In the good sims a kerb hits the FFB because the suspension and tyre
    forces change. Our kerb jolt is a scripted ±0.6 step, and the road
    texture is a sine wave.

---

## VDrift (`src/`, GPL-3)

The most coherent of the open-source sims, and the one most worth learning
from.

**Main loop** (`game.cpp` `Game::Tick`, lines ~800–925)
- Fixed `timestep = 1/90` s. Accumulator: `target_time += deltat`, then one
  `AdvanceGameLogic()` per elapsed tick. Frame dt is clamped to 0.1 s, at most
  9 ticks per frame; below 10 fps the game runs in slow motion rather than
  taking huge steps.
- Each tick does the following in order: poll input events, map controls, AI, apply car
  inputs, `dynamics.update(timestep)` (Bullet), cameras, sound, FFB. So
  input, physics, sound and FFB all run at 90 Hz on the main thread.
- **No render interpolation.** Bullet is called with dt equal to its fixed step,
  so it takes exactly one step and its motion-state interpolation never kicks in.
  At 60 Hz display the frame shows 1 or 2 ticks alternately, which is visible
  judder. 90 Hz is also low for the car itself, which is why the car model
  sub-steps internally.

**Car dynamics** (`physics/cardynamics.cpp`)
- Runs as a Bullet "action" after integration. Inside each 90 Hz step the
  driveline and tyre friction are solved as **velocity constraints**:
  `substeps = 10`, `solver_iterations = 4`, so 900 Hz effective
  (`UpdateDriveline`, ~line 1452).
- Tyre friction is a constraint: it drives the contact-patch slip velocity
  toward zero, with the impulse capped at the Pacejka force × sub-dt
  (`UpdateWheelConstraints`: `upper/lower_impulse_limit = fx·sdt`). This is why
  VDrift is stable at standstill even though its slip denominator is
  only `max(|v|, 1e-3)` (`cartirebase.h` `ComputeSlip`). At low speed the
  constraint holds the car; at speed the Pacejka cap takes over.
- Suspension is an implicit soft constraint:
  `softness = 1 / (dt·(dt·k + c))` (`wheelconstraint.h`). Bump stops add
  5×10⁵ N/m. Anti-roll bars change each wheel's effective stiffness.
- Engine, clutch, wheels and differentials are shafts with inertia in one
  driveline solve. The limited-slip diff is a clutch whose max torque is
  reached at 12 rad/s slip. Engine friction torque comes from displacement
  (`carengine.cpp`). Idle throttle is solved at load time so the engine holds
  start rpm.
- Tyres (`cartire1.cpp`, default): a full Pacejka '96-style coefficient set
  (longitudinal b0–b10, lateral a0–a14, aligning c0–c17), Fz in kN capped at
  30. Combined slip uses Pacejka's weighting functions,
  `Gx = sqrt((1+(p3·σ)²) / (1+(p3·σ)²+(p2·α)²))`. A per-load look-up table
  (500 N steps) of the **ideal (peak) slip and slip angle** feeds ABS, TCS,
  the squeal sound and the steering assist.
- ABS predicts the next slip (`slip + (slip − last)`) and limits the brake
  rate by how close that is to the ideal slip. TCS engages at 1.2× ideal
  slip, releases at 0.8×.
- Aero: a list of aero devices, each with drag and lift, applied at its own
  position (so downforce pitches the car).

**Input** (`carcontrolmap.cpp`)
- Each analogue axis has a deadzone (rescaled so output still starts at 0),
  then gain, then an exponent.
- Keyboard and pad steering are rate-limited at 5 units/s. Wheels
  (`joytype == "wheel"`) skip the rate limit.
- **Speed sensitivity is applied to wheels too** whenever the setting is
  non-zero: `coeff = min(1, 900·(1 − atan(mph·80·ss·(1−val²))·2/π))`. A
  "joy_200" option divides input by up to 4.5× above 30 mph for 200° wheels.
  Both break 1:1 steering on a real wheel.
- Steering assist (optional) clamps the steer so the front tyres stay near
  their peak slip angle, blended in up to 10 m/s.

**Force feedback** (`forcefeedback.cpp`, `game.cpp UpdateForceFeedback`)
- Quantity: the sum of the front tyres' Pacejka aligning moment Mz, scaled by
  `1 / (8 · 2 · maxMz(static wheel load))` (a fudge factor of 8 that the
  comment admits is a fudge), then gain, invert and clamp ±1.
- Sent through SDL's constant-force effect. It has no damper or spring and no
  minimum force.
- Recomputed every 0.02 s (50 Hz). Smoothing is a one-pole
  `last = (last + new)/2` on each call.
- **Bug worth learning from:** `UpdateForceFeedback` runs every 90 Hz tick, but
  on ticks between 50 Hz updates it passes 0. The filter therefore alternates
  between pulling toward the real value and toward zero. That roughly halves
  the force and adds a ~45 Hz ripple. With no damping on top, you get a
  vague, buzzy wheel. Don't copy the structure.

**Gearbox**: autoshift goes up at the redline and down at 70 % of the redline
in the next gear down: racing logic, wrong for a road car. The auto-clutch
does anti-stall, opens fully for the first half of the shift time, and
engages at most 10/s (0.1 s).

**Camera** (`camera_mount.cpp`, `camera_chase.cpp`)
- Cockpit: a spring-damper offset, k = 800 + 3200·stiffness, damping ratio
  0.35, clamped to 5 cm/(1+stiffness), vertical halved. **It's driven by random
  "bump" impulses scaled by speed, not by the car's acceleration**, so it
  isn't a g-force model.
- Chase: position blended toward the target at `10·dt` per tick, then looks at
  the car.

**Sound** (`carsound.cpp`)
- Engine: several samples, each tagged with min, max and "natural" rpm.
  Gains crossfade linearly between neighbours and are normalised to sum to 1.
  Pitch = rpm / natural rpm. Samples are tagged on-load (gain × throttle),
  off-load (gain × (1 − throttle)) or both.
- Tyre squeal per wheel, positioned at the wheel:
  `squeal = clamp((σ/σpeak)² + (α/αpeak)²) · min(vslip², 1) − 0.4`. Gain is
  0.3 × squeal and pitch is 1 − 0.4·√squeal. Separate grass, gravel and sand
  loops replace squeal off asphalt.
- Road noise gain is `min(v²·0.0004, 1)`, which reaches full at 50 m/s.

## Stunt Rally 3 (`src/vdrift/`, GPL-3)

A fork of *old* VDrift physics (before the constraint solver), tuned for
arcade rally.

- **Tick rates** (`src/game/settings`, presets): game 160 Hz, Bullet 160 Hz,
  and the car dynamics loop runs `dyn_iter = 60` times per tick, so
  **9,600 Hz** car integration (presets range from 80 Hz × 30 to 320 Hz × 60).
  It uses explicit integration and needs that rate to stay stable
  (`cardynamics_update.cpp CARDYNAMICS::Tick`).
- **Tyre** (`cartire.cpp GetForce`): Pacejka Fx/Fy/Mz. Combined slip uses the
  **Beckman method**: normalise each slip by its peak (`s = σ/σ̂`,
  `a = α/α̂`), set ρ = √(s²+a²), then `Fx = (s/ρ)·Fx(ρ·σ̂)` and
  `Fy = (a/ρ)·Fy(ρ·α̂)`. A traction-circle cap follows. The slip denominator
  is `max(|V|, 0.01)`, which the 9.6 kHz loop tolerates. Each surface carries
  its own tyre preset.
- **FFB**: Mz averaged over the 60 sub-steps (a free boxcar low-pass), read
  every 0.02 s (50 Hz), gain/100, clamp. Linux evdev `FF_CONSTANT` only,
  with autocentre switched off. No damper.
- **Speed-sensitive steering on every device, wheels included**
  (`carcontrolmap_local.cpp`): `coeff = max(1 − effect, 1 − velfactor·v·0.02)`
  × `steer_range`. On asphalt that's 0.76 × max(0.35, 1 − 0.0147·v). At
  100 km/h a wheel turned fully commands only ~45 % of lock. It's fine for
  pads, but on a wheel it makes the car feel disconnected.
- **Camera bounce** (`cardynamics_update.cpp`, `par.cpp`): a separate
  1350 × 0.02 = 27 kg body on a 1,500 N/m spring and 150 N·s/m damper
  (≈1.2 Hz, ζ≈0.37). It's driven by chassis forces × −0.0016, with output
  scaled ×10. This is a cheap, good way to get head movement from g-forces.
  The follow camera also tilts with the road slope (4 down-rays, smoothed
  at 14/s, at most 1.4° change per step).

## Rigs of Rods (`source/main/`, GPL-3)

A soft-body sim: every vehicle is nodes and beams. Nothing about its tyres
transfers to us, but its loop and camera are instructive.

- **Tick**: `PHYSICS_DT = 0.0005` (2,000 Hz) (`physics/SimConstants.h`).
  The accumulator keeps the remainder (`ActorManager::UpdateActors`); frame dt
  is capped at 1/20 s. Physics runs on its own thread. Rendering copies a
  snapshot (`gfx/SimBuffers.h`) with no interpolation, which doesn't matter
  at 2 kHz.
- **Tyres**: no slip model at all. Each wheel is a ring of nodes; ground
  contact is per node (`physics/collision/Collisions.cpp primitiveCollision`).
  Below the adhesion velocity (3 m/s on asphalt) friction is static with
  smoothing, `−μs·N·(1 − e^(−v/va))`. Above it, a Stribeck curve
  `μ = μc + (μs − μc)·exp(−(v/vs)^α) + t2·v`. Asphalt: μs 1.2, μc 0.75,
  vs 6 m/s, t2 0.01 (`resources/skeleton/config/ground_models.cfg`). Tyre
  behaviour emerges from carcass deflection, at a big CPU cost.
- **Steering input lag**: analogue steering is filtered every physics step,
  `state += (10/smoothing)·dt·exp(−|diff|/sensitivity)·diff`
  (`ActorForcesEuler.cpp CalcHydros`, defaults 1.0/1.0). That's τ ≈ 0.1 s for
  small moves and ~0.27 s for a full-lock flick. It applies to wheels, and
  wheel users complain RoR feels laggy. Digital steering is rate-limited at
  `max(1.2, 30/(10 + |v|/2))` per s.
- **FFB** (`utils/ForceFeedback.cpp`, `Actor::CalcForceFeedback`): the
  hydraulic steering rams' beam stress, averaged over the frame's physics
  steps, plus a hand-tuned centring term `100·command·wheelspeed²`, clamped
  ±10,000 on an OIS constant force. Updated once per rendered frame on the
  main thread. The rack-force idea is right (it's literally the force in
  the steering linkage). The speed² centring term isn't physical.
- **Cockpit camera**: the camera *is* a node, 20 kg, hung on 8 beams with
  spring 8,000 and damping 800 (`RigDef_File.h` `Cinecam`). Head movement,
  vibration and g-forces fall out of the physics. G-forces for the HUD are
  averaged over the frame's steps and blended 50/50 with the last frame.
- **Sound** (`audio/SoundScriptManager.cpp`): several samples each recorded at
  a reference pitch. Linear crossfade between neighbours, pitch =
  value/reference, and a sample fades out when pitched down below a cutoff
  factor (so it never sounds slowed-down). Gain and pitch are quadratic
  functions of rpm, throttle and other sources.

## TORCS 1.3.7 simuv2 (`src/modules/simu/simuv2/`, GPL-2)

The ancestor of Speed Dreams. Old, and it shows.

- **Tick**: `RCM_MAX_DT_SIMU = 0.002` (500 Hz) physics, but
  **`RCM_MAX_DT_ROBOTS = 0.02`: drivers, including the human, are polled at
  50 Hz** (`interfaces/raceman.h`, `raceengine.cpp`). Input latency is up to
  20 ms on top of the frame. If the sim falls more than 30 steps behind, it
  drops the time. No interpolation.
- **Tyre** (`wheel.cpp SimWheelUpdateForce`): a simplified Magic Formula on a
  single combined slip `s = √(sx² + sy²)`, with `sx = (vt − ωr)/|vt|` and
  `sy = sin(slip angle)`, capped at 1.5. C = 2 − asin(RFactor)·2/π,
  B = Ca/C, E from the car file. Load sensitivity is
  `μ·(lfMin + (lfMax − lfMin)·exp(lfK·Fz/Fz0))` with lfMin 0.8, lfMax 1.6.
  There's also a ±5 % "camber" fudge, `sin(−ax·18)`.
- **"Relaxation"** is `RELAXATION2(F, prev, 50)` (`robottools.h`): each step
  the force becomes the average of the new and previous value. That's a
  time-step filter, not a relaxation length, so it changes with the tick
  rate. Low speed is close to singular (`|vt|` in the denominator), and TORCS
  cars are known to twitch at rest.
- **Human input** (`drivers/human/human.cpp`): steer = `pow·|x|^sens /
  (1 + spdSens·v)`. The steer exponent defaults to 2.0, which is fine on a
  pad but wrong on a wheel. Mainline TORCS has no FFB.

## Speed Dreams (simuv4), not read

Changelog only: simuv4 adds ABS, TCL and ESP as per-wheel controllers running
at 500 Hz, and a newer tyre model with temperature, wear and five compounds
(Xavier Bertaux). Speed Dreams also has an FFB manager with
autocentre and bump effects, configurable per car. We couldn't reach the code,
so we have no numbers. If the owner can download a source tarball on the Mac,
it's worth a second pass on `src/modules/simu/simuv4/` and
`src/libs/tgfclient/forcefeedback.cpp`.

## Vehicle libraries

**NVIDIA PhysX Vehicle SDK** (BSD-3; `physx/include/vehicle/`). Used in many
shipped games. Read it for its low-speed handling and its tyre parameters:
- Slip denominators (`PxVehicleParams.h`): `minLatSlipDenominator = 1.0`
  m/s, `minActiveLongSlipDenominator = 0.1` m/s (under drive or brake),
  `minPassiveLongSlipDenominator = 4.0` m/s (coasting). The comments say
  bigger timesteps need bigger values.
- **Sticky tyre**: below 0.2 m/s for 1.0 s with no drive torque, a velocity
  constraint takes over and decays the speed to zero (damping 1/s). That
  ends creep and jitter at rest.
- Tyre: linear lateral and longitudinal stiffness, plus a 3-point
  friction-vs-slip graph. The tyre load is filtered through a 2-point graph,
  because the comment says load "can be strongly dependent on the time-step".
- Steering is a non-linear command-response table against speed, plus
  Ackermann parameters.

**Jolt Physics** (MIT; `WheeledVehicleController.cpp`). Constraint-based
friction like VDrift. Default curves: longitudinal (0, 0) → (0.06, 1.2) →
(0.2, 1.0); lateral in degrees (0, 0) → (3°, 1.2) → (20°, 1.0).

**Godot-Advanced-Vehicle** (MIT). Raycast suspension with Pacejka or a
textbook **brush model**: bristle stiffness 1×10⁶ + 8×10⁶·k, cornering stiffness
0.5·k·a², and the aligning moment from the analytic brush solution (adhesion
and sliding regions). The README says it needs ≥120 Hz physics and ships at
240 Hz. No relaxation. A useful reference if we want Mz that's physically
consistent with Fy.

**Randomation Vehicle Physics** (Unity). Arcade: "slip" is just scaled
velocity, there are friction curves, and it lerps the force 50 % toward the
target each step. Not a sim reference.

**Classic texts (from memory, not re-read here).** Marco Monster's *Car
Physics for Games* is the source of the low-speed problem write-up and the
"blend to a kinematic model at low speed" advice. Brian Beckman's *Physics
of Racing* covers weight transfer, the friction circle, and the
normalised-slip combining that Stunt Rally implements.

**Commercial reference points (from memory, not verified here).**
rFactor 2 and Assetto Corsa Competizione compute FFB at 333–400 Hz from
steering-rack force and expose a "minimum force" setting to overcome gear
and belt deadband. iRacing ran FFB at 60 Hz for years and added 360 Hz
because 60 Hz felt grainy.

---

## Comparison

| | Physics tick | Input sampled | Render interp. | Tyre model | Low-speed fix | FFB source | FFB rate | FFB damping |
|---|---|---|---|---|---|---|---|---|
| VDrift | 90 Hz, ×10 driveline sub-steps | 90 Hz | no | Pacejka '96 + Gx/Gy | friction as velocity constraint | front Mz | 50 Hz (buggy filter) | none |
| Stunt Rally 3 | 160 Hz, ×60 car = 9.6 kHz | 160 Hz | no | Pacejka + Beckman combine | tiny steps | Mz averaged over sub-steps | 50 Hz | none |
| Rigs of Rods | 2,000 Hz, own thread | per frame, filtered τ≈0.1 s | snapshot | node friction (Stribeck) | static-friction band < 3 m/s | steering-ram stress + speed² centring | per frame | none |
| TORCS simuv2 | 500 Hz | **50 Hz** | no | simplified MF, single slip | none (2-step average) | none | – | – |
| PhysX Vehicle | user's fixed step | user | user | linear + friction graph | slip floors 1/0.1/4 m/s + sticky state | – | – | – |
| **Ours** | **240 Hz but variable h** | per frame | not needed today | MF, similarity combine, σ=0.4 m lag | 0.6 m/s floor + relaxation | front Fy × trail | **per frame, unbounded queue** | **none** |

What this shows: none of the open-source sims has good FFB, so for FFB there's
nothing to copy, only a list of mistakes to avoid. Our tyre model is already
in the same class as VDrift and Stunt Rally, so the tyres aren't the main
reason it feels wrong. The loop, the wheel connection, the camera and the
sound are.

---

## What to change in our game, ranked

Each item says what it fixes. Files are in `game/src/client/`.

1. **Fixed physics step with an accumulator, and render interpolation.**
   (`carphysics.ts step`, `drive.ts update`, `main.ts frame`.) Step at a constant
   h = 1/240 s (cost today is ~0.14 ms per sub-step, so 1/360 is affordable
   too). Carry the remainder between frames, cap at ~0.1 s, and draw the car
   at the blend between the last two physics states. Also do the ground
   lookup per sub-step, not once per frame.
   *Fixes:* handling that changes with frame rate and hitches, damping and
   relaxation that wobble with h, and non-repeatable test results. This is
   the base everything else sits on.

2. **Rebuild the FFB loop: rate, damping, latest-wins.** (`main.ts` FFB block,
   `g29.ts`.)
   - Compute the rack torque inside the physics step and average it over the
     sub-steps (Stunt Rally's free low-pass). Don't sample it once per frame.
   - Send at a steady ~120–250 Hz from a timer, not from rAF. Coalesce: keep
     one report in flight and replace the pending value. **Never queue.**
     Today `send()` chains every report onto a promise. If WebHID writes on
     the Mac get slower than the frame rate, that queue grows, and the force
     arrives later and later. This is a likely cause of "the connection with
     the wheel" feeling off.
   - Add **damping**: subtract c·(wheel angular velocity), with velocity
     taken from the G29 input reports, which arrive much faster than frames
     and need a light filter. A gear-driven G29 with a delayed
     aligning-torque loop and no damping oscillates when you let go and
     feels notchy around centre. Every sim needs damping somewhere. Logitech's
     classic protocol also has spring and damper effect slots. Check the
     byte layout against Logitech's FF protocol document or the Linux
     `hid-lg4ff`/new-lg4ff driver before using them.
   - Replace the hard clamp at ±1 with a soft knee (e.g. tanh above ~0.7),
     and add a small **minimum force** (~3–6 % of full scale, a user setting)
     to push through the G29's gear deadband. Both are standard settings in
     commercial sims.
   - Drop the fixed `setSpring(0.06)` once damping exists. A spring centres the
     wheel to zero degrees, which fights the physics in a steady turn.
   *Fixes:* lag, oscillation, a vague or notchy centre, and clipping
   in corners.

3. **Fix the cockpit field of view.** (`main.ts setCockpit`.) Default to the
   real-geometry vertical FOV, `2·atan((screen height / 2) / eye distance)`.
   For a 27" 16:9 monitor at 70 cm that's ~27° vertical; the current 68° is
   more than double. Make it a setting with that calculator. Commercial sims
   all ship this. *Fixes:* speed and distance that look wrong, a car that
   feels like it slides more than it does, and braking points that are hard
   to judge.

4. **A head model for the cockpit camera.** Copy the technique, not the code:
   a ~1.2–2 Hz spring-damper with ζ ≈ 0.4–0.6 (Stunt Rally uses 1.2 Hz and
   ζ 0.37), driven by the chassis's local acceleration. Move it a few cm,
   and partly level the horizon (keep ~30–50 % of body roll, not 100 %).
   *Fixes:* no sense of braking or cornering load, and a camera bolted to
   the body that makes every bump read as motion of the whole world.

5. **Low-speed tyre handling the PhysX way.** Keep our relaxation-length lag,
   but use separate slip denominators: coasting ~4 m/s, driving or braking
   ~0.1–0.5 m/s, lateral ~1 m/s. Add a sticky state: below ~0.2 m/s for
   ~0.5–1 s with no drive torque, hold the car in place.
   *Fixes:* creeping and jitter at rest on a slope or in P, and twitchy
   parking manoeuvres. Those matter more in a driving-test sim than in a
   racer.

6. **Rack force from the steering geometry, plus an EPS map.** Rack torque =
   Σ (Fy × (pneumatic + caster trail)) + Σ (Fx × scrub radius), then
   power-steering assist that falls with speed, which is what makes a road
   car light when parking and firm at 100 km/h. Once the footpath is a ramp
   with a real face instead of a 12 cm step, kerb hits come through the
   physics. Then the scripted `kerbJolt` can go.
   *Fixes:* kerbs that feel scripted, no torque steer or braking tug, and
   wrong weight at parking speed.

7. **Road texture from the suspension, not a sine.** High-pass the front
   suspension velocities (above ~15 Hz), scale with speed, and add that to
   the FFB. VDrift's surface "bump" waves are a cheap source of input for it.
   *Fixes:* a constant artificial buzz that hides the information in the
   real force.

8. **Engine sound from samples.** 4–6 CC0 loops recorded at fixed rpm, in
   on-load and off-load sets. Crossfade linearly between neighbours, normalise
   the gains to sum to 1, pitch = rpm / recorded rpm, and fade a sample out
   when it's pitched below ~0.7× (the VDrift and RoR approach). Add VDrift's
   road-noise curve, gain = min(v²·0.0004, 1).
   *Fixes:* the toy-synth engine, and the missing rpm and load cues for an
   automatic. The automatic's shifts are only audible if the engine sounds
   real.

9. **Tyre squeal from normalised slip.** Per wheel, from (σ/σpeak)² +
   (α/αpeak)² with a ~0.4 threshold, pitch falling with intensity (VDrift
   numbers above). We already know our peaks (12 % slip, ~8°).
   *Fixes:* squeal that doesn't match the limit, so it can't be used as a cue.

10. **Normalise per axis before combining slip.** In `substep`, divide sx by
    its peak (0.12) and tan α by its peak (~0.14), combine, then scale back
    (the Beckman method). Today the raw slip vector feeds both curves, so the
    balance between braking and cornering grip is set by accident.
    *Fixes:* small but real inconsistency in trail-braking and ABS in a bend.

Not worth changing:
- Our 1:1 wheel mapping with no speed sensitivity or filtering
  (`drive.ts stepPhysics`). VDrift, Stunt Rally, RoR and TORCS all get this
  wrong in some mode. The legacy kinematic path still scales lock with speed
  for wheels, but it only runs before Rapier loads.
- The 900° range with 14:1 ratio, the DSG logic, and ABS and TC.

Order of work: 1 → 2 → 3 → 4, then test with the owner on the G29. Items 5–10
are refinements after that.
