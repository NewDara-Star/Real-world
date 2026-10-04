# 12: Web driving games: how they get their feel, and what we're missing

Date: 2026-10-04. Read-only teardown. **No code was copied into the project.** Every
project below is MIT unless noted. Even so, we take techniques only (owner's rule).
This note doesn't repeat what `06` (Teleoperator) and `07` (djentic, Mars GT) already cover.
`07`'s Mars GT physics notes (speed-limited steering, yaw assist, visual body spring)
are referenced here, not restated.

The owner's complaint: driving feels "all over the place". Where this note says "we",
it means `game/src/client/{main,drive,carphysics,wheel,audio}.ts` as of today.

## Method, and what was blocked

The sandbox's egress proxy decides what can be fetched, so open-source projects on
GitHub were the reliable route. They are readable source, which is better than
minified bundles anyway. Clones and npm tarballs are in the scratchpad
`/tmp/claude-0/-home-user-Real-world/5d569546-9ace-5b91-b2ce-7f6b31ee93cf/scratchpad/web/`
(not in the repo). The requests used a generic UA and carried no personal headers.

**Blocked by the proxy (CONNECT 403):** `slowroads.io`, `kodub.com` / `www.kodub.com`
(Polytrack), `*.itch.zone` / `topographinteractive.itch.io` (Slow Roads' itch build),
`bruno-simon.com`, `racing.pmnd.rs`, every `*.github.io` page, `*.pages.dev` (the hosted F1
game), `safari.bogdan.engineer` (Vibe Safari from a Claude Code Show HN), `forum.babylonjs.com`,
`playground.babylonjs.com`, `www.crazygames.com`, `hn.algolia.com`, `web.archive.org`,
`medium.com`. GitHub search API is also refused for this session (repo-scoped token), so
discovery used web search.

Slow Roads and Polytrack are the two best-known browser driving games, and both were
unreachable. Unofficial GitHub/Gitea mirrors of Polytrack exist (e.g. a `gitea.com` "games"
repo). I did **not** use them: they are unlicensed redistributions of a proprietary game,
which is a different thing from reading the bundle the author serves. If the owner wants
those two covered, open them on the Mac, save the page's JS from DevTools and drop it in
the scratchpad. The same esbuild and prettier pass then applies.

**Read in full (driving-relevant files):**

| # | Project | Stack | Why it's here |
|---|---|---|---|
| 1 | [brunosimon/folio-2025](https://github.com/brunosimon/folio-2025) (bruno-simon.com) | three r18x **WebGPU + TSL**, Rapier `DynamicRayCastVehicleController` | The best-known three.js car experience. Same renderer and physics engine as us |
| 2 | [swift502/Sketchbook](https://github.com/swift502/Sketchbook) | three + cannon.js `RaycastVehicle`, TypeScript | The classic open-source three.js "GTA-like" sandbox. Its car handling is often cited |
| 3 | [pmndrs/racing-game](https://github.com/pmndrs/racing-game) (racing.pmnd.rs) | React Three Fiber + `@react-three/cannon` (cannon-es in a worker) | The pmndrs showcase racer. Good camera and speed tricks |
| 4 | [hirosichen/ai-f1-racing-game](https://github.com/hirosichen/ai-f1-racing-game) | three r186, 708-line single file | **Built entirely by Claude (Opus 5.5) in Claude Code.** It's the "made with Claude Code" data point |
| 5 | [rsamwilson2323-cloud/rpg-car-game](https://github.com/rsamwilson2323-cloud/rpg-car-game) | three **WebGPU** + Rapier vehicle controller, single HTML | A 2026 hobby game on exactly our stack, likely AI-assisted. Useful mainly as a list of what not to do |
| 6 | [playcanvas/engine](https://github.com/playcanvas/engine) `examples/.../physics/vehicle` + rigid-body system | PlayCanvas + ammo.js raycast vehicle | The engine-level reference for how PlayCanvas steps physics |

Licences: 1 to 6 are MIT (folio-2025 `license.md`, Sketchbook, pmndrs, the F1 game and
rpg-car-game `LICENSE`, PlayCanvas). Only folio-2025's *code* is MIT; its models and sounds are
Bruno's, and we take nothing from them.

---

## Summary: what the good ones do that we don't

An honest framing first: **none of these six is Forza-grade physics.** All of them are
arcade, and our Rapier + Pacejka + DSG model (`08`) is more correct than any of them.
**Their "feel" comes from the layer between the physics and the player**, and that is the
layer we're thin on. Ranked by how much each likely contributes to "all over the place":

1. **The camera is filtered, never bolted to the chassis.** Every project separates
   what the physics body does from what the eye does. Sketchbook's first-person view takes
   only the *position* from the body; its orientation is world-space (the horizon stays
   level). pmndrs lerps a body-parented camera toward a target at a rate of `delta`. The F1 game
   and Mars GT (`07`) track heading through a lag, and djentic drives the body visuals
   from a separate spring rig. **Our cockpit camera is `root.localToWorld` of the Rapier body
   (`drive.ts` `placeCamera`).** Every heave, pitch and roll, every 12 cm footpath
   step, and every bit of spring chatter from the 240 Hz solver goes straight into the eye. That is
   the most likely single cause of "all over the place" in cockpit view.
2. **Fixed physics timestep, decoupled from the frame rate.** Sketchbook (cannon `world.step(1/60, dt)`
   with `interpolatedPosition` for rendering), use-cannon (1/60, max 10 sub-steps, in a worker),
   PlayCanvas (1/60, max 10) and the F1 game (1/120 accumulator, max 60 steps, then drops the
   backlog) all do this. Folio instead **averages the last 30 frame deltas** before feeding the vehicle
   controller, which is a cheap de-jitter. We split each frame's raw `dt` into
   `ceil(dt·240)` equal steps (`carphysics.ts` `step`). The step size therefore changes every
   frame, and so does Rapier's `timestep`. A 100 ms hitch is simulated in one burst (`main.ts`
   clamps at 0.1 s). There's also no render interpolation to hide uneven frames.
3. **Input shaping for keys and pads.** The F1 game ramps throttle at 6/s up and 8/s down,
   brake at 10/s, and steering at 2.6/s toward lock, **7/s when reversing direction** and 5/s
   back to centre. Sketchbook runs keyboard steering through a fixed-rate spring
   (60 Hz, mass 10, damping 0.6), shrinks lock with speed (`0.8 / max(1, 0.3·v)`), and adds
   **automatic counter-steer**: while a key is held, the target is never less than
   the angle between the velocity and the nose (`Car.ts:239-251`). Forza's
   "Normal steering" does the same class of thing for pads, and Turn 10 says those input layers
   are **disabled whenever a wheel is used** ([Forza forum, Turn 10 reply](https://forums.forza.net/t/steering-normal-or-simulation/98148)).
   **We stack two rate limiters on keyboard steering** (`wheel.ts` `kbSteer` at
   2.2/s, or 4/s back to centre, then `drive.ts` `steerCmd` at 2.2/s both ways). That makes it slow to turn in and just as slow to
   unwind. Keyboard throttle and brake are binary 0/1 and slam instantly.
4. **The chase camera follows the car's motion, with speed cues.** F1: FOV `58 + 0.13·v` (capped
   +12°), heading lag at `dt·6`, look 7 m ahead. pmndrs: the camera pulls back with speed
   (`-5 - v/15`), **drops under acceleration, moves 1 m closer under braking**,
   shifts sideways and rolls into the steer by `steer·v`, plus speed-scaled sway. Mars GT
   (`07`) looks 50 % into the slip angle. **Ours has a fixed FOV of 60°, a fixed height of 3.1 m in
   world space, a look point fixed at y = 1.3 m and 3 m ahead of the nose, a yaw lerp at `dt·3.5`
   and a separate position lerp at `dt·8`.** Those two lerps fight during
   direction changes, and the camera tracks heading, not travel direction.
5. **Impacts and surfaces reach the camera.** The F1 game uses shake 0.6 on a wall hit, decaying 2/s,
   and a 0.12 floor while on the kerbs. Folio adds a camera-roll **spring kick** on hits
   (pull 100, damping 4). We jolt the wheel's FFB but not the screen.
6. **Smoothing is frame-rate independent where it matters.** Sketchbook's
   `SimulatorBase` steps springs at a fixed 60 Hz and interpolates between cached frames.
   The weaker projects (pmndrs, rpg-car-game) use per-frame `lerp(a, b, 0.05)` and
   `lerp(a, b, delta)`, which behave differently at 60 and 120 Hz. **The owner's Mac is
   ProMotion (120 Hz).** Our `min(1, dt·k)` lerps are close to frame-rate independent
   at small `dt`, but not exactly.
7. **Engine sound layering.** Folio uses sampled loops with `playbackRate` and **asymmetric
   easing** (volume rises at 10/s and falls at 2.5/s, so lifting off sounds natural). It also has a
   speed-driven "spin and wind" loop whose rate goes from 1 to 2 with speed. The F1 game uses two oscillators
   at engine-order frequencies (`rpm/60·1.5` and `·0.75`). **We have no road or wind noise
   at all.** Our engine pitch is `46 + rpm·170` Hz, not tied to the engine's firing order.
   A 3-cylinder four-stroke fires at `rpm/60·1.5`, about 20 Hz at an 800 rpm idle, not 46.

What they **don't** do, so we shouldn't feel behind: none uses real motion blur, none
has force feedback or wheel support (we have WebHID FFB), none has a tyre model with a
peak and fall-off, and none streams a real city.

---

## 1. folio-2025 (Bruno Simon)

Live: bruno-simon.com (blocked here). Source read: `sources/Game/{Ticker,Time,View,Player}.js`,
`Physics/{Physics,PhysicsVehicle}.js`, `World/VisualVehicle.js`, `Audio.js`, `Rendering.js`.

- **Loop.** One rAF tick and one Rapier `world.step()` per frame. `delta` is clamped at
  1/30 s (`Ticker.js:14,32`). **Global time scale 2** (`Time.js` `defaultScale = 2`): the
  whole world, Rapier included, runs at double real time. That is a trick for making a small toy car feel
  lively without changing masses. A "bullet time" mode lerps the scale toward 0.5 (ease in at 3/s, out at 0.3/s).
- **Vehicle.** Rapier `DynamicRayCastVehicleController`, 4 wheels, AWD engine force,
  `frictionSlip 0.9`, `sideFrictionStiffness 3`, stiffness 25 (it switches between 20, 30 and 40 with
  the player's suspension "hop" setting). The controller gets **`min(1/60, average of the last 30
  deltas)`** (`PhysicsVehicle.js:511`), or a fixed 1/60 on low quality. This de-jitters
  the raycast suspension even though the world step is variable. The top speed is soft:
  force is divided by `1 + overspeed`. Releasing both pedals applies a small "idle brake" (0.06), and pressing
  the opposite pedal brakes before it reverses. The **ice** surface lerps `frictionSlip` toward 0.04.
- **Assists.** None for handling. There's a respawn/flip helper (impulse plus torque
  depending on which side it's lying on), stuck detection (under 0.5 m travelled in 3 s with throttle held),
  and air-time and flip detection for achievements.
- **Input.** Keyboard steering is instant ±1 with no ramp. The car is slow and
  small, so that works. The gamepad stick goes through `remapClamp(|x|, deadZone, 1, 0, 1)`. Touch uses
  a nipple with `progress³` for throttle. The *visual* front-wheel angle is smoothed separately at
  `dt·16` (`VisualVehicle.js:427`).
- **Camera.** An isometric-style follow with a **FOV of 25°** (telephoto) and a smoothed focus point
  (`dt·10`). It **zooms out with speed** using `smoothstep(speed, 5, 40)`, smoothed at `dt·10`. A
  **roll spring** gets kicked on impacts. Speed lines (a TSL vertex shader that draws clip-space
  streaks toward a target) appear only on boost.
- **Audio.** Howler loops: an engine loop with rate 0.6 to 1.1 from throttle, a "spin/wind" loop
  with volume and rate (1 to 2) from ground speed, and a boost loop. All use asymmetric attack and release easing.
  Hits play randomised samples scaled by contact force (Rapier contact-force events,
  threshold 15).
- **Rendering and performance.** WebGPU with a TSL pipeline: bloom (5 mips on high, 2 on low), a cheap
  DOF pass, and MSAA off at DPR ≥ 2. There are two quality levels, picked from a mobile UA sniff. The world is
  one hand-made scene with no streaming.
- **Takeaways for us.** The averaged-`dt` trick (if we don't go fully fixed-step), the roll kick on
  impact, asymmetric audio easing, and road and wind loops driven by ground speed. The toy-scale handling
  doesn't transfer.

## 2. Sketchbook (swift502)

Source read: `src/ts/world/World.ts`, `vehicles/{Vehicle,Car}.ts`,
`physics/spring_simulation/*`, `core/{CameraOperator,FunctionLibrary}.ts`.

- **Loop.** `world.step(1/60, timeStep)` (`World.ts:217`) is cannon's **fixed step plus accumulator**,
  and rendering reads `body.interpolatedPosition` and `interpolatedQuaternion` (`Vehicle.ts:88-97`):
  textbook "Fix Your Timestep" ([Gaffer on Games](https://gafferongames.com/post/fix_your_timestep/)).
  `timeStep` is clamped at 1/30 and multiplied by a smoothed time-scale (lerp 0.2 per frame).
- **Springs everywhere, frame-rate independent.** `SimulatorBase` advances a spring at
  a fixed rate (60 Hz) as many times as the elapsed time needs, keeps the last two frames,
  and **interpolates by the leftover time**. The spring update is semi-implicit:
  `v += (target − x)/mass; v *= damping; x += v`. The character, the camera and the car's steering all use it.
- **Vehicle.** cannon `RaycastVehicle`, radius 0.25, stiffness 20, rest 0.35, `frictionSlip 0.8`,
  `rollInfluence 0.8` (anti-roll by reducing the lever arm). It has a 5-gear "arcade
  transmission": force `500/gear × (gearTop − v)/(gearTop − prevTop)`, up-shifting when under 10 % of the gear's
  power remains, with a **0.2 s torque cut per shift**.
- **Steering assist (the bit worth stealing).** Target lock = `0.8 / max(1, 0.3·v)`. But
  **while a key is held the target is never smaller than `−driftCorrection`**, the signed
  angle between the velocity vector and the nose. When the rear steps out, steering into the turn
  automatically becomes counter-steer, so the front wheels point where the car is going.
  The target then goes through `SpringSimulator(60 Hz, mass 10, damping 0.6)`. It reaches 90 %
  in about 0.18 s with almost no overshoot (as a continuous spring that's ω ≈ 17 rad/s, ζ ≈ 0.9). It
  eases in and out like hands on a wheel, not like a linear ramp.
- **Air control.** Mid-air roll and pitch torques ramp in over 2 s, plus a self-righting torque
  when upside-down at low speed.
- **Cameras.** Third person is a mouse-orbit around `body + (0, 0.5, 0)`. **First person puts the camera at
  the seat (body position plus rotated seat offset) but takes its orientation from world-space mouse
  angles**, so the car's roll and pitch never tilt the view. The horizon is locked.
- **Audio.** None for the car.
- **Takeaways for us.** Fixed step with interpolation, fixed-rate springs, counter-steer assist for
  key and pad only, and a horizon-stabilised in-car view.

## 3. pmndrs/racing-game

Source read: `src/models/vehicle/Vehicle.tsx`, `src/store.ts`, `src/effects/*`, `App.tsx`,
plus `@react-three/cannon` 6.6 from npm (`physics-provider.tsx`).

- **Loop.** cannon-es runs in a **Web Worker**. Each R3F frame posts `{stepSize: 1/60,
  maxSubSteps: 10, timeSinceLastCalled}` and gets transforms back through transferable
  buffers. The main thread never blocks on physics. Contact relaxation is 4 and friction 1e-3
  (car-to-world friction comes only from the raycast wheels).
- **Vehicle.** `RaycastVehicle`: `frictionSlip 1.5`, `sideAcceleration 3`, `rollInfluence 0`,
  stiffness 30, rest 0.35, rear-wheel drive 1800 N, steer 0.3 rad, rear brake 65, top speed 88 (force
  cut above). Engine force and steering are each lerped toward the target at `delta·20` (about 50 ms).
- **Chase camera (the useful part).** The camera is a child of the chassis, and its *local* target is
  `x = sin(steer)·v/2.5` (it swings out of the turn), `y = 1.25 − 0.5·engine/1000` (it **squats
  on throttle**), `z = −5 − v/15 + (brake ? 1 : 0)` (it **pulls back with speed and moves in under braking**).
  Position lerps at `delta`. Roll is `−steer·v/40`, also lerped. On top of that there's **speed sway**:
  sinusoids on roll and pitch at 30 rad/s, with amplitude ∝ `v/vmax` (×4 and 60 rad/s on boost).
  The cockpit view gets the same lateral swing at a smaller scale (`/30`). The FOV is a fixed 75°.
- **Chassis "vibration".** The visual body gets `sin(20t)·v/vmax/100` rad of pitch and roll, which
  reads as road buzz at speed. The visual lean is `−steer·v/200`.
- **Audio.** `PositionalAudio` loops: engine `playbackRate` lerped toward `rpmTarget+1` at `delta·10`,
  with volume *falling* with speed (`1 − v/vmax`) so a separate "accelerate" layer takes over.
  There are also brake, boost and honk loops. Skid marks and dust come from `api.sliding`.
- **Weak spots.** The camera is parented to the body, so it inherits every bump (the lerp hides
  most of it). The lerps are per-frame `lerp(a, b, delta)`, so the response changes with frame rate.
- **Takeaways for us.** The squat, dive and pull-back mapping for the chase cam, sway proportional to
  speed, and physics in a worker as an option if the main thread gets busy.

## 4. ai-f1-racing-game (built by Claude in Claude Code)

Source read: `main.js` (708 lines, three r186 from a CDN, no build). Playable at
`vibe-f1-racing.pages.dev` (blocked here).

- **Loop.** **Fixed 1/120 s accumulator**: `while (acc >= STEP && n < 60) step(STEP)`, and
  if it hits 60 steps the backlog is dropped (no spiral of death). There's **no render
  interpolation**: at 144 Hz some frames get 0 steps, so expect micro-stutter on high-refresh
  displays. `?timescale=` multiplies `acc`. There's a test hook (`window.__f1.tick(n, dt)`) that steps
  deterministically. That's a nice pattern for headless checks like ours.
- **Vehicle.** Kinematic, not a rigid body. The yaw rate is the bicycle-model `v·tan(δ)/L`,
  **clamped to `a_lat_max / v`** with `a_lat_max = 16 + 0.0045·v²` m/s² (mechanical grip plus
  downforce). If you ask for more yaw than grip allows, the car scrubs speed in proportion to the excess (up to 7 m/s²).
  The steer angle is `steer·0.34/(1 + v/20)` (speed-sensitive). Off-track grip is ×0.6 with extra drag.
- **Input.** Keyboard throttle ramps at 6/s up and 8/s down, brake ±10/s, steering rate **2.6/s
  toward lock, 7/s when reversing direction, 5/s back to centre** (`main.js:444-449`).
- **Cameras.** Chase: heading lag `camH += wrap(h − camH)·min(1, dt·6)`, distance 7.2 m, height 2.3 m,
  look 7 m ahead at y = 0.9, **FOV `58 + min(12, 0.13·v)`**. Onboard: FOV 75 with a fast heading lag
  (`dt·20`). TV cams pick a trackside point 110 m ahead and **set the FOV so the car keeps a constant
  screen size** (`2·atan(9/dist)`), and there's an orbiting hero cam. Shake: 0.6 on a wall hit, 0.12 on
  kerbs, decaying at 2/s, applied as a random position offset.
- **Audio.** A saw and a square oscillator at `rpm/60·1.5` and `·0.75`, then a lowpass at 1.5 kHz, Q 1.5,
  with gain set from throttle.
- **Performance.** Every car, the track and the grandstands are generated and merged into a few meshes per car.
  A 25-point Catmull-Rom track is sampled every 2 m.
- **Verdict.** This is what Claude Code produces in one session when the brief is "F1 race": clean
  structure, a fixed timestep, sensible input ramps, but kinematic arcade physics. It shows that
  good *feel* is mostly the input and camera layer, which is cheap to get right.

## 5. rpg-car-game (three WebGPU + Rapier, 2026)

Source read: `index.html` (inline module, about 2,900 lines).

- **Loop. Anti-pattern:** exactly **one `FIXED_DT = 1/60` Rapier step per rendered frame**,
  whatever the real elapsed time. Game speed is tied to frame rate: it runs at double speed on 120 Hz and
  slow motion at 30 fps.
- **Vehicle.** Rapier `DynamicRayCastVehicleController` (the same controller Rapier ships, which we chose
  not to use in `08`). `frictionSlip 1.5`, stiffness 12, `sideFrictionStiffness 2`, and live tuning via a
  settings panel. Steering is instant ±0.5 rad from the keys. The jump "crouch" briefly sets the suspension
  rest length to 0.05 with stiffness 80, then applies an impulse.
- **Camera.** `camera.position.lerp(ideal, 0.05)` per frame (frame-rate dependent) toward 8 m behind
  and 4 m up, looking at the chassis.
- **Streaming (the one good idea).** It builds the terrain heightfield collider
  **a few rows per frame** and swaps it in when complete, rebuilds scatter cells every 20 frames, and caps
  cleanup at 20 cells per frame. In other words, collider and instance work is time-sliced.
- **Takeaways for us.** Time-slice collider streaming. Everything else is a list of what not to do.

## 6. PlayCanvas (engine reference)

`src/framework/components/rigid-body/system.js`: `fixedTimeStep = 1/60`, `maxSubSteps = 10`,
`world.stepSimulation(dt, maxSubSteps, fixedTimeStep)`. That is Bullet's accumulator with **motion-state
interpolation** for rendered entities. The engine's vehicle example is a stock ammo raycast vehicle
with a tracking camera, nothing beyond the defaults. It's listed only to show that the engine-level default
everywhere (Bullet, ammo, cannon, PlayCanvas, use-cannon) is **a fixed 60 Hz step plus interpolation**.

## Slow Roads and Polytrack (not reachable)

- **Slow Roads** (slowroads.io, Anslo / Topograph Interactive): the store copy says it exposes
  **steer assist, camera pose, optional traffic, per-vehicle handling settings and autopilot
  (auto-steer, auto-speed, full autodrive)** ([itch page](https://topographinteractive.itch.io/slow-roads),
  [vgdb](https://www.vgdb.co/games/slow-roads)). That is the same layered-assist idea as Forza's Normal
  steering. Nothing else could be verified.
- **Polytrack** (Kodub): official hosts blocked. Mirrors were not used (see Method).

---

## Comparison with ours

| Area | Ours | Best seen | Gap |
|---|---|---|---|
| Physics step | `ceil(dt·240)` equal sub-steps of a raw rAF `dt`, clamp 0.1 s | fixed 1/60 to 1/120 + accumulator + **interpolation** (Sketchbook, PlayCanvas, use-cannon) | Variable `h`, no interpolation, burst catch-up after hitches |
| Vehicle model | Rapier rigid body, own raycast suspension, Pacejka, DSG | arcade raycast or kinematic | **Ours is ahead.** Keep it |
| Key/pad steer | two stacked rate limits (2.2/s, so unwinding is capped at 2.2/s too), speed-limited lock | spring 60 Hz + speed lock + **auto counter-steer** (Sketchbook); asymmetric rates 2.6/7/5 (F1) | Laggy unwind, no counter-steer help |
| Key throttle/brake | binary | ramps 6–10/s (F1); lerp 20/s (pmndrs) | Pedal slams |
| Wheel | direct, WebHID FFB from aligning torque | none have it | **Ours is ahead** |
| Cockpit cam | rigidly on the body, full pitch/roll/heave | world-space orientation (Sketchbook); separate visual springs (Mars GT, djentic) | **The likely main cause of "all over the place"** |
| Chase cam | yaw lerp 3.5, pos lerp 8, FOV 60 fixed, fixed y | heading lag + FOV `58+0.13v` (F1); pull-back, squat, dive, sway (pmndrs); look into slip (Mars GT) | No speed cues; heading-, not velocity-tracking |
| Impacts | FFB jolt only | camera shake (F1), roll spring kick (folio) | Nothing on screen |
| Engine audio | 2 osc, `46+rpm·170` Hz | engine-order freq (F1, Mars GT); sampled loops with asymmetric easing (folio) | Wrong idle pitch; no load character |
| Road/wind audio | none (skid only) | speed-driven loop (folio) | **Missing entirely** |
| Collider streaming | all walls within 90 m rebuilt synchronously every 15 m | time-sliced rows/cells (rpg-car-game) | Possible periodic hitch: **profile first** |

---

## Ranked changes for our game

Ordered by expected effect on "all over the place" per hour of work. Wheel players keep
literal steering throughout. Every assist below applies to keyboard and pad only, and, like
Forza, is switched off when `inp.device === "wheel"`.

1. **Stabilise the cockpit eye** (`main.ts` `placeDriveCamera`, `drive.ts` `placeCamera`).
   Build the eye transform from the body's **position and yaw**. Then add the body's pitch and roll
   **low-pass filtered** (critically damped spring, about 2–3 Hz) and **scaled to about 30–40 %**, so the
   real head's stabilisation is modelled rather than ignored. Add a small **head-lag offset** from
   acceleration in the car frame: about 2–3 cm back per g under acceleration, forward under braking, and
   outward per lateral g, with a spring of about 1.5 Hz and ζ ≈ 0.7. Filter heave the same way. Offer a
   "horizon lock" option (roll 0 %) for players who get motion sick. Head checks and mirrors keep working because only the
   rotation source changes. Mirrors should keep using the unfiltered body pose.
2. **Fixed physics step with render interpolation** (`carphysics.ts` `step`, `drive.ts`
   `sync`). Use an accumulator at a constant `h = 1/240` (keep the rate from `08`), set
   `world.timestep` once, and cap at about 12 steps per frame, dropping any remainder after a
   hitch rather than replaying it. Keep the previous and current body pose. `sync()` renders
   `lerp/slerp(prev, cur, acc/h)`, and the camera reads the interpolated pose. Wheel spin, suspension
   travel and `impact` read the last full step. This removes step-size variation and makes 60, 120 and
   144 Hz behave identically. Before this lands, folio's cheaper alternative (average the last
   30 frame `dt`s) would also take the edge off.
3. **Fix keyboard and pad input shaping** (`wheel.ts`, `drive.ts`).
   - Remove one of the two stacked rate limiters. Keep the speed-limited lock in `drive.ts` and
     make the raw key value a target.
   - Use asymmetric rates like the F1 game: about 2.5/s toward lock, about **6–7/s when the
     key reverses**, and about 4–5/s back to centre. Or use Sketchbook's spring
     (ω ≈ 17 rad/s, ζ ≈ 0.9) stepped at a fixed rate.
   - Keyboard throttle ramps at about 3/s up and 8/s down. Brake ramps at about 4/s toward a **0.6 cap**
     (a learner never stamps), and holding Shift gives full braking. A learner sim needs gentle pedals from keys.
   - **Counter-steer assist** (Sketchbook): while steering in the direction of a slide, the
     command is at least the body slip angle `atan2(vr, vf)` mapped to wheel angle. Pair it
     with the yaw-rate assist from `07` (`2.5·Iz·(r − r_kin)`, faded in from 0 to 10 m/s). Both apply to keys and pads only,
     and both are off for the wheel and visible to the examiner as an assist setting.
4. **Rebuild the chase camera as damped springs** (`main.ts` `placeDriveCamera`).
   - Follow the **velocity heading blended about 40 % toward the nose heading** above about 3 m/s (Mars GT's
     "look into slip"), with a critically damped yaw spring (about 3 Hz) instead of two
     competing lerps.
   - Height and look point are relative to the car's interpolated position (not world y = 3.1 / 1.3), and
     the look point is about 6–8 m ahead.
   - Speed cues, kept small because this is a driving-test sim: FOV `60 + min(8, 0.12·v)`
     degrees in chase only. Distance `7.2 + min(2, 0.04·v)`. The camera drops about 0.15 m on hard throttle and closes about
     0.6 m under braking (pmndrs mapping, scaled down), all through the same springs.
   - Use `1 − exp(−k·dt)` for any remaining lerps.
5. **Road, tyre and wind audio** (`audio.ts`). Add pink or brown noise lowpassed at 300–800 Hz
   with gain ∝ speed for tyre roll on asphalt (more on the footpath and kerb surfaces), plus
   bandpassed noise with gain ∝ v² and a cutoff rising with speed for wind. Use folio's **asymmetric
   easing** (fast attack, slow release) on throttle-driven layers. Fix the engine pitch to the firing
   order: Polo 1.0 TSI is three cylinders, so the fundamental is `rpm/60·1.5` (about 20 Hz at 800 rpm, about 137 Hz at
   5,500), with harmonics via a `PeriodicWave` (`07` notes Mars GT does engine-order waves).
   Make the filter follow load (throttle × rpm), not rpm alone. At 50 km/h, road and wind noise is
   most of what a driver hears, so this is a large realism gain.
6. **Impact and surface feedback on screen.** Use trauma-style shake (offset ∝ trauma², noise-driven,
   decaying at about 2/s) from `c.impact` and `c.kerbJolt`, plus a short roll kick (folio). Cockpit view gets
   a heavily reduced amount. Add a faint speed-scaled vibration on the cockpit eye (pmndrs: `sin(20t)·v/vmax/100`
   rad). Take the frequency from the road surface if we ever tag cobbles or speed ramps.
7. **Time-slice wall collider streaming** (`carphysics.ts` `streamWalls`). Measure first
   (`performance.now()` around it). If it costs over 1 ms when crossing a 15 m boundary, queue
   buildings and create N colliders per frame, nearest first, the way rpg-car-game does.
8. **A deterministic step hook for tests** (F1's `__f1.tick(n, dt)`). Expose
   `step(n, dt)` on the debug global so Playwright runs can drive fixed inputs and screenshot the
   camera at known frames, which makes camera tuning reviewable.

Not worth taking: toy-scale handling (folio's 2× time scale, instant keyboard steer),
air control and flip helpers, boost and speed lines, cannon's raycast vehicle, and any
per-frame `lerp(a, b, constant)`.

### Sources
- Repositories above (MIT): [folio-2025](https://github.com/brunosimon/folio-2025),
  [Sketchbook](https://github.com/swift502/Sketchbook), [racing-game](https://github.com/pmndrs/racing-game),
  [ai-f1-racing-game](https://github.com/hirosichen/ai-f1-racing-game),
  [rpg-car-game](https://github.com/rsamwilson2323-cloud/rpg-car-game),
  [PlayCanvas engine](https://github.com/playcanvas/engine), `@react-three/cannon` 6.6 (npm).
- Fixed timestep and interpolation: [Gaffer on Games, "Fix Your Timestep!"](https://gafferongames.com/post/fix_your_timestep/).
- Forza Normal vs Simulation steering, and input layers being disabled on wheels:
  [Forza forums](https://forums.forza.net/t/steering-normal-or-simulation/98148),
  [Normal steering or Simulation?](https://forums.forza.net/t/normal-steering-or-simulation/23830).
- Slow Roads feature list: [itch.io](https://topographinteractive.itch.io/slow-roads).
- Claude Code games found: the F1 game above; the HN thread
  ["I hacked together an open world game with Claude Code"](https://news.ycombinator.com/item?id=43515707)
  (game host blocked).
