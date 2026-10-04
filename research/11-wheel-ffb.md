# 11: Wheel input and force feedback (Logitech G29 / G923)

Date: 2026-10-04. Trigger: the owner says the wheel connection feels "crazy, all
over the place" (G29/G923 in PC mode, Mac, Electron build). Techniques only: no
code copied from the GPL drivers below. The protocol facts come from reading them,
plus the CC0 `nightmode/logitech-g29` library.

## Summary

The protocol bytes we send are mostly right. The problems are how and when we
send them, and the control loop they form:

1. **The force loop runs once per render frame, with no damping.** The tyre
   aligning torque behaves like a spring on the rim. It gets stiffer with speed
   squared: about 2 Nm/rad at 5 m/s and 34 Nm/rad at 25 m/s in sim units, which
   is 0.04 to 0.6 of full wheel torque for 22° of rim. That spring reaches the
   motor one or more frames late, and nothing damps it. A headless model of that
   loop (our physics plus a rim model, assumptions below) oscillates when you let
   go at 20 m/s, and at 30 fps it runs to full lock. A real G29 has gear friction
   that hides some of this, but the result is the textbook "tank-slapper" that
   every sim kills with a damper.
2. **The writes queue without limit.** `g29.ts` chains every `sendReport` onto
   one promise and never drops stale ones. Each frame sends 1 to 5 reports
   (force, spring as two reports, LEDs). On macOS each write is a synchronous
   `IOHIDDeviceSetReport` on a Chromium thread pool, and its promise resolves only
   when the busy renderer main thread gets to it. When the queue backs up, the
   wheel plays old forces late and in a burst. BeamMP saw exactly this with a
   Logitech wheel: 140 queued commands, and the wheel turned itself in random
   directions.
3. **The force can get stuck on.** Logitech firmware holds the last
   constant-force command forever. We stop sending while the map is open, when the
   window is hidden (rAF stops), and when the main thread stalls. Nothing zeroes
   the force or acts as a watchdog, except pause and `pagehide`.
4. **The autocentre spring is sent outside its range.** The arcade path sends
   autocentre stiffness of 0 to 13, but the kernel driver never sends more than 7.
   Another reverse-engineered library saw a 3-bit wrap on a sibling effect, where
   7 is strongest and 8 is none. If the firmware wraps here too, the spring
   strength jumps as speed changes.
5. **The on-screen wheel turns half as far as the real one.** It uses ±225°, not
   ±450°. The code says "1.25 turns" but uses 1.25π rad, which is 0.625 turns.
   Seeing your hands move twice as far as the cockpit wheel feels "disconnected".
6. **Things outside the code that we can't see.** G HUB on the Mac may add its
   own centring spring and sensitivity curve, and may reset the range on profile
   switches. A G923 Xbox/PC (HID++) or a G29 in PS4 mode falls back to the Gamepad
   API path, which has no force feedback and an unknown rotation range. The
   reverse-FFB checkbox, if ticked, turns the restoring force into positive
   feedback.

The fix is to move the wheel into a dedicated worker. It runs a fixed 500 Hz
loop driven by the wheel's own input reports and allows one write in flight,
always the latest value. It upsamples the physics torque using the local
stiffness, adds a firmware damper plus a software damper, compensates for the
deadband, and has a watchdog. Turn the autocentre off. Expose a small, honest set
of settings, and add a wheel test page that measures direction, deadband, report
rate, write latency and G HUB interference. The plan is at the end.

---

## 1. The hardware

| | G29 (c24f) | G923 PS/PC (c267 → c266) | Notes |
|---|---|---|---|
| Motor / drive | dual DC motors, **helical gears** | same mechanics, plus "TrueForce" | Gears give cogging and Coulomb friction near centre. Belt wheels (Thrustmaster) are smoother; direct drive has none. |
| Peak torque | ~2.1–2.3 Nm (Logitech: 2.3 Nm "racing system") | similar | Weak. A real car with power steering has 2–5 Nm at the rim, unassisted 10+ Nm. |
| Rotation | 40–900°, set by command `f8 81 lo hi` | same | Hardware end stops at 900°. A smaller range is a firmware soft lock. |
| Sensor | Hall-effect, 16-bit in the native report | 16-bit | The usable resolution is far finer than we need. No centre deadzone is needed. |
| Pedals | 8-bit each (gas, brake, clutch); brake has a progressive rubber stop | same | Linear sensors. The brake *feel* is non-linear, so a curve in software is normal. |
| Force deadband | ~5–15 % of full scale does nothing (gear friction) | similar | WheelCheck's minimum-force test is the accepted way to find it. LUT authors (RasmusP) find that the G29 only needs a deadband offset and is otherwise linear. |
| Firmware loop | runs effects locally. "Fixed loop" ≈ 500 Hz, "fast loop" as fast as it can (command `0d 00/01`) | | Condition effects (spring, damper, friction) are computed **on the wheel**, so USB latency doesn't affect them. |
| TrueForce | proprietary Logitech SDK, Windows, per-game | | Not available to us. Ignore it. |

What this means in practice:
- Forces under ~7 % aren't felt at all. Our road "buzz" (3 % at most on the
  physics path) is below the deadband: it costs a USB write every frame and does
  nothing.
- With ~2.2 Nm available and our sim producing 8 Nm at the rim in an ordinary
  corner, we must compress the range, and the gain choice decides where clipping
  starts.
- Without power and control, a gear wheel hums or rattles under fast small force
  changes. Sims low-pass the force they send to Logitech wheels (BeamNG's
  "smoothing" of 100–300, iRacing's 60 Hz era).

## 2. The protocol (classic Logitech FFB, from hid-lg4ff and new-lg4ff)

Output: a 7-byte report, report ID 0 (except the G923 PS mode switch, which uses
ID 0x30). The first byte is `(slot mask << 4) | opcode`.

- **Four effect slots** (masks 0x10, 0x20, 0x40, 0x80). Opcodes: `1` download and
  play, `3` stop, `0x0c` refresh/modify a running effect. new-lg4ff keeps the
  constant force in slot 1 and puts conditional effects in slots 2–4. It sends
  "download" once, then only "refresh" while the effect runs, so it never stops and
  restarts around zero. The in-kernel driver sends `11 08 xx 80` (download+play)
  every update and `13` (stop) when the force is exactly zero.
- **Constant force:** one byte, 0x80 = none. In the CC0 library 0x00 is full
  right and 0xFF full left, so values below 0x80 pull clockwise. That's **8-bit:
  127 steps each way**. Our sign convention (`0x80 − f·0x7f`, +f = pull right)
  matches.
- **Spring** (type 0x0b, "high-resolution spring"): 11-bit deadband edges, 4-bit
  stiffness per side, a sign per side, 8-bit clip (saturation).
- **Damper** (type 0x0c): 4-bit coefficient per side, sign, 8-bit clip.
- **Friction** (type 0x0e, G25/G27/G29 family): 8-bit coefficient per side, 8-bit
  clip.
- **Autocentre** (the wheel's built-in centring spring): `fe 0d k k clip 00 00`,
  then `14` to switch it on, or `f5` to switch it off. The kernel maps the 16-bit
  strength to **k = 0..7** and clip = 0..255, with clip growing with strength.
  The CC0 library claims 0..15 for k, but also found that its friction coefficient
  wraps at 8 (7 strongest, 8 none). **Treat k > 7 as undefined.**
- **Range:** `f8 81 lo hi` (G25 and later). **LEDs:** `f8 12 mask 00 00 00 01`.
  **Mode switch:** `f8 0a …` revert, then `f8 09 05 01 01` for G29 native.
- **Update rate:** new-lg4ff runs a 2 ms (500 Hz) timer and sends **at most 4
  commands per tick, only for slots that changed**. If the USB output queue hasn't
  drained, it **skips the tick** ("commands stacking up, delaying timer") rather
  than queue more. It also uses the LEDs as a clipping meter (5 LEDs at 7.5, 25,
  50, 75, 90 %, then LEDs go dark from the outside as it clips past 100/110/125/150 %).
  That makes 500 Hz with backpressure the proven rate for this hardware. 1 kHz
  gains nothing on a gear wheel.

Input: native report, 16-bit steering at bytes 4–5, pedals at 6–8 (255 =
released). The report rate is not documented. **Measure it on the test page.**

## 3. How real sims drive it

- **One constant-force effect, updated at physics rate.** DirectInput games create
  one infinite constant-force effect and update only its magnitude
  (`SetParameters` with type-specific parameters, no restart). They do this from
  the physics thread at 300–1000 Hz (rFactor 2 400 Hz, AC/ACC ~333 Hz). iRacing
  sent 60 Hz for years, and the community tool irFFB existed only to upsample it
  to 360 Hz because 60 Hz felt "notchy". Our frame-rate FFB sits in that
  discredited 60 Hz category, and at 30–40 fps it's worse.
- **The force source is rack torque** (aligning moment through the steering
  geometry), which we already do. Sims then add **damping** (rF2 "steering torque
  filter" + "damping", ACC "dynamic damping", AC "damper gain", BeamNG low-speed
  damping) and a **low-speed force reduction** to stop oscillation when parked or
  hands-off.
- **Driver-side effects are usually off:** G HUB "Centering Spring in Non-FFB
  games" off, Sensitivity 50 (linear), operating range 900° with the game soft-locking
  to the car. Every Logitech settings guide (Koponen and others) says the same.
  A centring spring under real FFB "fights" it.
- **Minimum force** (deadband compensation, 5–15 % on a G29) and **linear output**.
  A LUT only replaces the jump with a smooth curve.
- **Rate limits for weak firmware.** BeamNG's FFB "update rate limit" exists
  because "some wheels choke at bursts". BeamMP's Logitech queue overflow (140
  commands) was cured by limiting to ≤100 Hz with "full" updates. So the rule is
  backpressure, not a fixed fast rate.
- **Soft lock:** if the car's lock is less than the wheel range, the game applies
  a stiff spring past the car's lock. We use 900° = the car's full lock (a Polo is
  ~14–15:1, ~2.6–2.8 turns lock to lock, so 900° at 14:1 is right) and the
  hardware stop does it for us.
- **SDL** wraps the OS haptics API (`SDL_HapticUpdateEffect` on a running
  constant effect), the same pattern. On macOS it goes through
  ForceFeedback.framework and needs a vendor plugin. Not useful to us: WebHID
  talks to the wheel directly.

## 4. Platform limits (Chromium/Electron on macOS)

Read from Chromium source (`services/device/hid/hid_connection_mac.cc`,
`hid_connection.cc`, Blink `hid_device.cc`):

- **Writes:** `sendReport` → Mojo to the device service → a *sequenced
  thread-pool* task that calls the **synchronous** `IOHIDDeviceSetReport` → reply
  posted back → the promise resolves on the **renderer main thread**. Chromium
  already serialises writes. Blink does **not** reject overlapping `sendReport`
  calls, so our comment "WebHID rejects overlapping sendReport calls" is wrong on
  Mac. Each write costs at least a USB OUT interrupt interval (~1–2 ms) plus two
  process hops. Because our chain resolves through the main thread, a 20–30 ms
  frame holds back every queued write behind it.
- **Reads:** IOKit input reports are scheduled on the browser's main run loop,
  forwarded over Mojo, and fire `inputreport` on the renderer thread that owns the
  device. Nothing is dropped, so a stalled thread receives a burst.
- **WebHID works in dedicated workers** (`navigator.hid` is exposed to
  DedicatedWorker; `getDevices()` works there, `requestDevice()` is Window-only).
  A worker that owns the wheel gets reports and resolves writes on its own thread,
  away from rendering.
- **Gamepad API:** polled at 250 Hz (4 ms) into shared memory. It has no force
  feedback and can't set the range.
- **Timers in a worker:** nested `setTimeout`/`setInterval` are clamped to ~4 ms.
  For 2 ms ticks, clock the loop off `inputreport` events, or use `Atomics.wait`
  on a SharedArrayBuffer (allowed in workers, needs cross-origin isolation; we
  serve `app://` ourselves, so we can add COOP/COEP headers).
- **Electron main process + node-hid:** feasible. node-hid ≥ 3 is N-API and
  context-aware, works in `worker_threads`, and its async API runs writes on a
  work queue. On macOS, hidapi uses the same `IOHIDDeviceSetReport` and reads on
  its own run-loop thread. Open with `nonExclusive: true` (hidapi's default on Mac
  is exclusive/seize, which would lock WebHID and G HUB out). It costs a native
  dependency, signing/packaging, and an IPC hop for the physics torque. It only
  pays off if the worker approach measures badly. **Try the WebHID worker first.**
- `backgroundThrottling: false` (desktop/main.cjs) does not keep rAF running when
  the window is hidden or minimised, so the force can stick (defect C1).

## 5. Audit of our code (ranked by how much it hurts the feel)

Line numbers as of this commit.

### A. Causes of "all over the place" (fix first)

1. **No damping in a delayed stiff loop.** `main.ts:837-838` sends
   `steerTorque × 0.045` with nothing proportional to wheel velocity. The torque
   comes from `carphysics.ts:483-488,502`. Measured headless (`ffbprobe.mts`,
   steer 0.05 = 22.5° of rim):

   | speed | rack torque at rim | stiffness | FFB command |
   |---|---|---|---|
   | 5 m/s | −0.8 Nm | 2 Nm/rad | 0.04 |
   | 10 m/s | −3.2 Nm | 8 Nm/rad | 0.14 |
   | 15 m/s | −6.7 Nm | 17 Nm/rad | 0.30 |
   | 25 m/s | −13.4 Nm | 34 Nm/rad | 0.60 |

   Then I closed the loop with a rim model (inertia J = 0.02 kg·m², 0.08 Nm
   Coulomb friction, 2.2 Nm peak, 8-bit quantisation, the command held for one
   frame), let go of the wheel at 20 m/s and kicked it 34°:
   - At 60 fps it grew to ±110–145°. At 30 fps it hit full lock.
   - With a 0.05 Nm·s/rad damper it stayed in a ±13° limit cycle.
   - With J = 0.01 it settled.

   J for a G29 isn't published, so this shows the *mechanism*, not exact numbers.
   But the direction is clear: the stiffness rises with speed squared, update
   delay is negative damping, and we add no damping. Also, `steerTorque` is the
   value from the **last 1/240 s substep only** (`carphysics.ts:502`), not a frame
   average, so it aliases any tyre-relaxation ripple.
2. **Unbounded, non-coalescing write queue.** `g29.ts:113,312-316`: every call
   appends to a promise chain. Old force values still go out after newer ones
   exist, and the queue grows whenever writes take longer than the frame. Each
   frame can send: spring (two reports when the level changes, `g29.ts:273`),
   force (every frame while the buzz runs, `main.ts:836-838`), and LEDs
   (`main.ts:847`, flickering at thresholds). Errors are swallowed (`.catch(() =>
   undefined)`), so a dead link looks the same as a working one. This is the
   BeamMP failure mode.
3. **FFB rate = render rate, and so is input.** `main.ts:544-551,778,826-848`.
   At 30–60 fps (lower in heavy Finglas scenes, 120 on ProMotion) the force is a
   staircase with 17–33 ms steps. The steering read that feeds the physics
   (`wheel.ts:244-246`) is also sampled once per frame. Real sims run 300–1000 Hz.
4. **Autocentre strength outside its range.** `g29.ts:268-274` sends
   `k = round(k01 × 15)` (up to 13 on the arcade path, `main.ts:841`) with clip
   fixed at 0xFF. The kernel tops out at k = 7 with clip scaled to strength. If the
   firmware wraps at 8 (as the CC0 author saw for friction), the spring goes
   7 → 0 → 5 as speed rises. On the physics path k is 1 at gain 1 but becomes 0
   at gain < 0.55, so the spring silently switches off. **Autocentre should simply
   be off when real FFB is on** (what every sim and settings guide does).
5. **Stuck force.** `main.ts:551` returns early while the map is open, and rAF
   stops when the window is hidden or minimised. Logitech firmware keeps the last
   constant force, so the wheel keeps pulling. Only pause (`main.ts:1166`), exit
   (`main.ts:769`) and `pagehide` (`main.ts:1046`) clear it. There's no
   `visibilitychange`/`blur` handler and no watchdog.
6. **Stop/restart around zero.** `g29.ts:284-285`: when the quantised force is
   exactly 0x80 we send stop (`13`), and the next non-zero value re-downloads with
   `11 08`. With the buzz and small aligning torque crossing zero, the effect is
   stopped and restarted many times a second, right where a gear wheel is already
   notchy. new-lg4ff keeps the effect running and uses the refresh opcode.
7. **Reverse-FFB toggle = positive feedback.** `main.ts:829`, `index.html:41`.
   Our sign chain is consistent: `steerTorque` < 0 when steered right
   (`carphysics.ts:458,488`), and setForce(<0) gives a byte > 0x80, which pulls
   left. So the force restores by default. If the owner ticked "Reverse force
   feedback" while debugging, the wheel now drives itself to lock. The roadmap
   note (ROADMAP.md:13) invites this. **Check that the box is off.** Long term,
   replace the toggle with a measured direction test.

### B. Disconnected or laggy feel

8. **The cockpit wheel turns half the real angle.** `drive.ts:430` and
   `drive.ts:435`: `inp.steer × π × 1.25` = ±225°. The real G29 is ±450°. It
   should be `inp.steer × 2.5π`, or better, `steer × rangeDeg/2` in radians, read
   from the wheel range.
9. **Arcade path breaks 1:1.** `drive.ts:545`: with a wheel, the lock is scaled
   by `max(0.35, lockScale×1.2)`. At 18 m/s the rim-to-road ratio changes from 14:1
   to ~23:1. This path is only used until Rapier loads, but then the car's
   steering changes mid-drive. A wheel should always be 1:1.
10. **Spring re-sent on every speed change** (arcade path, `main.ts:841`): up to
    16 levels × 2 reports, each a step change in stiffness the hand can feel.
11. **Gain applied after the clamp** (`main.ts:838`): gain > 1 just clips (there's
    no headroom indicator), and gain < 1 wastes 8-bit resolution. No minimum-force
    compensation exists, so everything below ~7 % (including all of the buzz,
    `main.ts:836`, and the aligning torque below ~10 m/s) disappears into the
    deadband. Then forces suddenly "arrive" as speed rises.
12. **No force when parked or creeping.** Headless: 0.00 Nm parked with 0.3
    steer, 0.2 Nm (= 0.009 command) at walking pace. In the physics path the only
    centring is autocentre k=1. That's realistic for EPAS, but combined with
    no damper the wheel feels dead and loose in the parking and manoeuvre tasks
    the test is about. Sims add a little speed-dependent friction/damping when slow.
13. **Range set only once** (`g29.ts:178`). If G HUB applies a profile (it does
    on app focus) or the wheel re-enumerates, 900° may be replaced. On the Gamepad
    path (`wheel.ts:254-259`) the range is whatever G HUB says, and
    `WheelCalibration.rotation` (`wheel.ts:72,103,450`) is stored but never used.
    At 540°, the car steers 1.67× faster than the rim suggests.
14. **Gamepad-API path has no FFB at all.** If WebHID isn't attached (G923
    Xbox/PC c26d/c26e speaks HID++, not this protocol; G29 switch on PS4 = c260 in
    `g29.ts:25` probably doesn't accept the classic commands; a silent `open()`
    failure), the owner drives a limp or G HUB-sprung wheel. That fits "all over
    the place". The wheel monitor's source line (`wheel.ts:316`) tells which path
    is live. **Ask the owner what it says.**
15. **Stale dedupe after reconnect.** `lastForce/lastSpring/lastLeds`
    (`g29.ts:114-116`) are not reset on disconnect (`g29.ts:127-133`) or attach.
    After a replug or mode-switch re-enumeration, the firmware comes back with its
    power-on autocentre, and our matching "last" values suppress the commands that
    should override it.
16. **G923 PS mode:** `g29.ts:157-166` swallows a failed switch and keeps using
    the PS-mode device. All later writes go out on report ID 0. If that interface
    declares report IDs, Chromium rejects every write ("Invalid output report
    ID"), which the catch-all hides.

### C. Smaller issues

17. **Crash jolt direction** uses lateral velocity, not the impact side
    (`main.ts:824`). Kerb jolt is a ±0.6 step (`drive.ts:511-513`), then decays
    with τ ≈ 0.16 s (`main.ts:827`). That's fine, but it's sent at frame rate with
    no envelope, so it's a hard edge.
18. **Pedals:** pedal rest is learnt from the first report (`g29.ts:228`). A foot
    on a pedal at connect inverts it until reload. There's no per-pedal min/max
    calibration (G29 pots rarely hit 0/255 exactly), so the 2 % deadzone
    (`wheel.ts:247-248`) may not cover a worn pot. There's no brake curve or
    saturation setting (physics uses `brake^1.3`, `carphysics.ts:468`). The clutch
    as handbrake at > 0.35 is fine.
19. **Allocation per report:** `parse` slices a buffer and builds a new state
    object per report (`g29.ts:185,197`), causing garbage-collection pressure at
    hundreds of Hz on the render thread.
20. **Double listeners:** `pollPauseButton` (`main.ts:1175-1176`) ORs WebHID
    Options with Gamepad button 9. The G29 shows up through both APIs at once, and
    on the Gamepad path button 9 is Options too. That's harmless today, but any
    future gamepad binding will double-fire for the wheel. Exclude the wheel's pad
    when WebHID is live.
21. **The calibration wizard** (`wheel.ts:359-455`) samples every 16 ms, records
    `rotation: 900` without asking, and its "turn left first" heuristic for sign is
    fragile. It only matters for non-Logitech wheels.

What's right: 16-bit steering, centre maths (`g29.ts:198`, `:240`), the
constant-force sign, the range command, 900° = the car's real 14:1 ratio, the
G29 mode switch, rack-torque as the FFB source with a pneumatic trail that
collapses at the limit, and the auto-granted WebHID permission in Electron.

## 6. Redesign

### 6.1 Threads and rates

```
 renderer main thread (rAF, 30-120 Hz)          wheel worker (owns the HIDDevice)
 ─────────────────────────────────────          ──────────────────────────────────────
 physics step  ──► snapshot {T0, K, θ0,  ──►     on every inputreport (~500 Hz? measured):
                    damping hint, effects,          decode steer/pedals/buttons into SAB
                    seq, time}                      θ, ω = filtered d/dt θ
 read SAB  ◄──── latest steer/pedals/buttons      τ = T0 + K·(θ − θ0)        (upsampled rack torque)
                                                    − c·ω                     (software damper)
                                                    + effects(t)              (kerb/crash envelopes, road)
                                                  LPF (1-pole, 25-40 Hz) → gain → min-force map
                                                  → clip meter → 8-bit
                                                  if no snapshot for 100 ms: ramp τ → 0 over 200 ms
                                                  writer: one sendReport in flight; latest wins;
                                                          refresh opcode, never stop/start
```

- **Move the HID device into a dedicated Worker** (WebHID is exposed there;
  Electron grants permission per session). The main thread keeps `requestDevice`
  for the first pick on the web build, then hands off by closing its handle. The
  worker reopens with `getDevices()`.
- **Clock the loop off input reports.** Each report produces one force update, so
  the force rate tracks the wheel. Fall back to an `Atomics.wait` 2 ms tick if
  reports stop (wheel held still may report less often; measure).
- **Writer with backpressure:** at most one `sendReport` outstanding. When it
  resolves, send the newest pending value (force first, then conditional slots,
  then LEDs at ≤ 10 Hz). Never queue. Count skips and round-trip time for the test
  page.
- **Shared state through a SharedArrayBuffer** (add COOP/COEP to the `app://`
  handler and to Vite/wrangler), or `postMessage` at frame rate if isolation is a
  problem. Input in the SAB means the physics reads the freshest wheel angle each
  substep, not once per frame.
- Later, and optional: move the car physics itself into the worker at a fixed
  240–500 Hz (the rF2/ACC model). That removes the upsampling approximation, but
  it's a big refactor; the local-stiffness method gets most of the benefit.

### 6.2 What the physics sends

Per frame: `T0` = rack torque at the rim, **averaged over the frame's substeps**
(not the last one). `K = ∂T/∂θ_rim`: get it cheaply from the cornering stiffness
× trail / ratio², clamped at ≤ 0 and with a cap, or numerically from two
substeps. Also `θ0` (the rim angle used) and effect events (kerb side and size,
impact direction from the contact normal, surface roughness). The worker
extrapolates `T0 + K(θ−θ0)` between frames, which is what irFFB-style upsampling
does, but physically anchored.

### 6.3 Effects on the wheel

| slot | effect | use |
|---|---|---|
| 1 | constant force (refresh opcode) | everything computed above |
| 2 | **damper** (0x0c), firmware-side | baseline stability: k ≈ 2–4 of 15, more at low speed and when parked. Runs inside the wheel with no USB delay. Update ≤ 5 Hz. |
| 3 | friction (0x0e, G29) | small, to mask gear cogging; optional, user setting |
| — | autocentre | **off** (`f5`) whenever the physics FFB is active. Use a high-res spring (0x0b) only in menus or when walking, never mixed with the rack torque. |

Software damper `c·ω` on top, from the measured rim velocity: a 2-sample
derivative of the 16-bit angle, low-passed at ~30 Hz. c grows as speed drops (the
low-speed force reduction sims use).

### 6.4 Output mapping

1. `τ_sim` (Nm at the rim) × **strength** (set as "Nm of car torque per 100 % of
   the wheel", default ≈ 10 Nm, so a normal corner uses ~50–70 %).
2. Smooth with a 1-pole low-pass (~30 Hz) and a slew limit (protects the gears,
   stops hum).
3. **Minimum force**: `out = sign·(m + (1−m)·|x|)` for |x| > ε, with a linear
   ramp inside ε so there's no chatter at zero. m comes from the test page
   (expect 0.06–0.12).
4. Clip at 1, and show clipping on the rev LEDs (new-lg4ff's scheme) or in the HUD.
5. Quantise to 8 bits only at the very end. Dedupe is fine, but keep the effect
   running.

### 6.5 Safety

- Zero the force and switch to a mild firmware spring on: map open,
  `visibilitychange` hidden, `blur`, pause, exit, worker error, snapshot stale
  > 100 ms (the worker watchdog), and before close.
- Reset the dedupe state, then re-send range, effects and autocentre-off on every
  attach and on window focus (in case G HUB changed them).
- Surface write failures (a counter on the test page and a toast after N failures).

### 6.6 Input

- Steering: 16-bit, no deadzone, no smoothing. Range fixed at 900° and mapped 1:1
  to the car's lock (14:1). If the car's lock were smaller, apply a soft-lock
  spring at the car lock. Store `rangeDeg` in one place and use it for the visual
  wheel too (fixes #8).
- Pedals: per-pedal min/max from calibration. Settings for deadzone (2 %),
  saturation (brake reaches 100 % at e.g. 85 % travel) and gamma (brake 1.0–2.0).
  Keep `brake^1.3` in physics, or move it here, but not both.
- One input source at a time. When WebHID is live, ignore that wheel's Gamepad
  entry everywhere, including pause.
- Recognise and explain unsupported modes: G923 Xbox/PC (HID++) or G29 on the
  PS4 switch gives a toast saying "Force feedback needs the PS3 switch position /
  PlayStation G923", not a silent Gamepad fallback.

### 6.7 Settings to expose (and no more)

Strength (Nm per 100 %), Minimum force (with an "auto" button from the test),
Damping, Friction, Road effects, Kerb and crash effects, Low-speed weight
(parking feel), Brake curve, Brake saturation, Pedal deadzone. Remove "Reverse
force feedback" from the main panel. Direction is detected, and a manual
override goes under Advanced only.

### 6.8 Wheel test page (`wheel.html` or a tab in Wheel check)

1. **Identity:** product ID and name, mode (native/compat/PS), which path is live
   (WebHID or Gamepad), and a warning if G HUB-only modes are detected.
2. **Report rate:** reports per second, inter-arrival histogram (p50/p99),
   steering raw and degrees, centre offset.
3. **Write latency:** `sendReport` round-trip p50/p99, skipped updates per second,
   failures.
4. **Direction:** apply +20 % for 300 ms with the wheel free, see which way it
   moves, and store the sign.
5. **Deadband finder:** ramp force from 0 in 0.5 % steps per 100 ms each way until
   the rim moves > 0.5°, then store the minimum force (average of both sides).
6. **Step response:** a 50 % pulse for 60 ms, then measure rim acceleration and
   delay. This estimates J and the end-to-end latency, which feed the default
   damper.
7. **Hands-off test:** a virtual spring of the car's stiffness at 20/30 m/s. Let
   go, record the angle trace, report overshoot and decay, and let the owner tune
   damping live.
8. **G HUB interference:** all effects off (`f5`, stop all slots). Turn the rim
   90° and release. If it returns to centre, something else (G HUB's centring
   spring) is active, so tell the owner which G HUB setting to change.
9. **Pedals:** live bars, min/max capture, curve preview.

### 6.9 Settings for the owner today (no code change)

- G HUB on the Mac: profile for the app (or the desktop default) at Operating
  range 900°, Sensitivity 50, **Centering spring off**. Or quit G HUB entirely
  while driving: we don't need it, because WebHID talks to the wheel directly.
- G29 switch on **PS3** (PC mode). Wheel check should say "G29 direct". If it says
  "wheel · gamepad mapping", there is no force feedback at all.
- "Reverse force feedback" **unticked**. Strength 60–80 % until the damper lands.

## 7. Suggested order of work

1. Writer with backpressure and a latest-value mailbox, refresh opcode (no
   stop/start), autocentre off in the physics path, zero-force on
   map/hidden/blur, plus a watchdog. Fix the visual wheel to ±450°. Small, and
   most of the "all over the place" goes away.
2. Firmware damper slot, then the software damper and minimum force, with
   strength in Nm.
3. Wheel worker with input-clocked 500 Hz loop and local-stiffness upsampling.
   Shared input buffer.
4. Test page (direction, deadband, latency, G HUB check). Pedal calibration and
   curves.
5. (Optional) Physics at fixed rate in the worker, or node-hid in an Electron
   `utilityProcess` if WebHID worker latency measures badly.

## Sources

- Linux in-tree driver `drivers/hid/hid-lg4ff.c`: [github.com/torvalds/linux](https://github.com/torvalds/linux/blob/master/drivers/hid/hid-lg4ff.c) (constant force, autocentre, range, mode switch)
- new-lg4ff, Bernat Arlandis: [github.com/berarma/new-lg4ff](https://github.com/berarma/new-lg4ff) (slots, opcodes, spring/damper/friction layout, 2 ms timer, ≤4 commands per tick, backpressure, fixed/fast loop, LED clip meter)
- nightmode/logitech-g29 (CC0): [github.com/nightmode/logitech-g29](https://github.com/nightmode/logitech-g29) (constant force direction 0x00 = right; autocentre and friction byte observations)
- Chromium: `services/device/hid/hid_connection_mac.cc`, `hid_connection.cc`, `third_party/blink/renderer/modules/hid/hid.idl`, `device/gamepad/gamepad_provider.cc` ([github.com/chromium/chromium](https://github.com/chromium/chromium)) (synchronous `IOHIDDeviceSetReport` on a sequenced pool; WebHID in DedicatedWorker; Gamepad polling at 4 ms)
- hidapi macOS backend: [github.com/libusb/hidapi](https://github.com/libusb/hidapi/blob/master/mac/hid.c) (exclusive open by default); node-hid README: [github.com/node-hid/node-hid](https://github.com/node-hid/node-hid) (async API, worker threads, `nonExclusive` on macOS)
- BeamMP issue #858, Logitech FFB queue overflow (140 commands, wheel moves randomly; fix ≤100 Hz): [github.com/BeamMP/BeamMP/issues/858](https://github.com/BeamMP/BeamMP/issues/858)
- BeamNG FFB guide (update-rate limit, smoothing, "some wheels choke at bursts"): [beamng.com/threads/guide-to-ffb.56886](https://www.beamng.com/threads/guide-to-ffb.56886/); [overtake.gg BeamNG FFB guide](https://www.overtake.gg/news/beamng-drive-force-feedback-settings-guide.1406/)
- G29 deadband and LUTs: [RasmusP's LUTs for G27/29](https://overtake.gg/threads/rasmusps-luts-for-g27-29-and-dfgt.139869/page-20); [G29 + LUT + FFBClip thread](https://www.overtake.gg/threads/g29-lut-ffbclip-bad-control-feeling.182471/)
- G HUB settings guides (range 900, sensitivity 50, centring spring off): [Brian Koponen, Logitech G29/G920 settings series](https://www.briankoponen.com/beamng-drive-logitech-g29-g920-settings/)
- Logitech G29 product page (2.3 Nm racing system, helical gearing, Hall sensor): [logitechg.com](https://www.logitechg.com/en-hk/products/driving/driving-force-racing-wheel.html)
- Headless probe used for section 5 A1: the session scratchpad `ffbprobe.mts`, which runs `CarPhysics` with the rim model described there. Not in the repo; rerun it under `game/` with `npx tsx`.
