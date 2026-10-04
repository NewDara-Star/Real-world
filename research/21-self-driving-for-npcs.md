# 21: What self-driving code teaches us about NPC drivers

Date: 2026-10-04. Question: how do the serious open-source self-driving and
traffic-agent projects decide what a car does next, and what should our NPC
drivers (`game/src/client/trafficnet.ts`) take from them so they drive like
people on Finglas roads during an Irish driving test?

Everything below was read from the repos themselves (cloned shallow into the
session scratchpad, commits listed in each section) plus the published papers
they cite. Techniques only: nothing here is to be pasted into our code.

## Summary

1. **The self-driving stacks are not where human behaviour lives, but their
   decision architecture is exactly what we need.** Autoware and Apollo are
   built to be safe and legal, not human. What they get right is the shape:
   one small module per traffic situation (traffic light, stop line,
   crosswalk, intersection, roundabout, blind spot, no-stopping area), each
   writes a stop point or a speed cap onto the car's path, and **the lowest
   speed wins**. Our `stepCar` already does a crude version (every rule
   becomes a "virtual stopped car"); we should make it the explicit
   architecture.
2. **Human-likeness comes from the traffic-simulation side: SUMO and
   Treiber & Kesting.** Their models give us the knobs: IIDM/ACC car
   following, the Human Driver Model's reaction time and estimation errors,
   MOBIL lane changes with politeness, time-window gap acceptance with
   *impatience*, and SUMO's junction-model parameters for controlled
   rule-breaking (`jmDriveAfterYellowTime`, `jmIgnoreFoeProb`,
   `jmIgnoreKeepClearTime`, `jmTimegapMinor`, `jmStopSignWait`).
3. **The benchmarks agree that rules beat learning for closed-loop driving.**
   nuPlan's winner (PDM-Closed, tuPlan Garage) is a rule-based IDM planner
   that simulates 15 candidate IDM trajectories and scores them. Learned sim
   agents (Waymo challenge, GPUDrive) are trained on non-commercial data and
   don't follow right-of-way well enough for a driving-test sim. What we
   take from the benchmarks is **how they measure realism** (Waymo's
   histogram-matching metrics: speed, acceleration, distance to nearest car,
   time to collision, collisions, off-road, red-light running).
4. **We found a real bug while reading SUMO.** SUMO flips
   `right_before_left` in left-hand networks. Our bake marks Finglas's 24
   mini-roundabouts `right_before_left`, so the network now tells NPCs to
   **give way to the left** there. Measured on `finglas.net.bin`: 248
   conflicting pairs at minis yield to a car from the left, 11 to the right.
   Normal roundabouts are correct (46 right, 0 left). See "Bugs found".
5. **Recommended build:** a constraint-based NPC driver (Autoware's scene
   modules plus "minimum wins"), a small per-car state machine where a
   sequence matters (Apollo's stop-sign stages: approach, stop, creep, go),
   IIDM/ACC longitudinal control with a jerk limit, driver profiles drawn
   from one "assertiveness" number, time-window gap acceptance that makes
   the critical gap *emerge* from each car's own acceleration, then add
   behaviours in the order the Irish test needs them. A headless realism
   harness built from Waymo's metric list keeps us honest from day one.

## What we have now (trafficnet.ts, read in full)

Good and worth keeping:

- IDM on SUMO lanes, leader search along lane and path (`stepCar`, 90 m
  lookahead).
- Right-of-way from SUMO's own `resp`/`foes` matrices (`canGo`), so the
  priority logic is SUMO's, not ours. Signals from SUMO programs; amber stop
  if the car can stop at its own `b`; stop signs need 0.8 s stopped.
- Pedestrians on footpaths/crossings only; zebra step-out when cars can still
  stop; cars never enter a crossing with someone on it.
- Reactions to the player: back off after a knock, change lane, overtake
  through the oncoming lane when it's clear, honk after 4 s blocked.

Where it falls short of human driving (honest list):

| # | Gap | Effect on screen |
|---|---|---|
| 1 | Gap acceptance is "no foe arriving within a fixed 4.5 s" (`linkBusy`), the same for every driver, turn and road speed; ego's own time to clear the junction is ignored. | Too bold crossing a fast road, too timid at slow ones; every car identical. HCM's measured critical gaps run 4.1 s (turn across from the main road) to 7.1 s (turn across from the side road). |
| 2 | Mini-roundabouts yield the wrong way (bake bug, below); `trafficnet.ts` never reads `J.roundabout` or `J.mini`. | Wrong behaviour at the junction type Finglas is known for. |
| 3 | Nothing stops a car entering a junction whose exit is full. | Gridlock, then the 50 s "teleport". Autoware's intersection module has "stuck vehicle detection" for exactly this; Irish yellow boxes require it. |
| 4 | No routes: `pickLink` chooses at random at each lane end; lane changes happen only when the player blocks (`changeLane` is called from `react` only). So there is no MOBIL at all yet. | No one moves into the right-turn lane early, no merges, no lane discipline on two-lane roundabouts. |
| 5 | IDM parameters drawn independently and uniformly (`v0f` 0.88–1.08, `T` 1.1–1.8 s); no reaction time, no noise, no jerk limit. | Robotic: perfectly smooth, instant reactions, a whole green-light queue starts together. |
| 6 | Turn slowing is done by faking a gap (`gap = … + turnV²/(b·0.5)`), and plain IDM brakes hard when the limit drops below current speed. | Odd braking into bends and at limit changes. IIDM and a "speed cap ahead" fix both. |
| 7 | No parked cars, buses stopping, unprotected right-turn waiting position, zebra courtesy, or indicator reading. | The test hazards the learner most needs are missing. |
| 8 | RNG seeded from `Date.now()`; the test counts "overlaps" as centre distance < 1.5 m. | Tests aren't reproducible; side-swipes and rear-end overlaps go uncounted. |
| 9 | `pathAfter` builds a new array per car per frame. | Garbage at 150 cars; easy fix in the rewrite. |

## Bugs found

**Mini-roundabouts give way to the left.** `tools/bake/mini_roundabouts.py`
sets OSM mini-roundabout junctions to SUMO type `right_before_left`, and
`build_net.sh` runs netconvert with `--lefthand true`. SUMO's docs
(`docs/web/docs/Networks/PlainXML.md`, junction types) say: "right_before_left:
Vehicles yield to traffic coming from the right. (This is automatically
flipped when building lefthand networks)." Measured with a probe on the baked
Finglas network (for each pair of conflicting entries where A must yield to
B and B approaches across A's path from one side):

| Junctions | B from A's right | B from A's left |
|---|---|---|
| 24 mini-roundabouts | 11 | 248 |
| 52 roundabout ring junctions | 46 | 0 |

Roundabouts are right; minis are mirrored. Likely fix: write
`left_before_right` in the patch for left-hand places (which the flip turns
into yield-to-right), then re-run the probe; SUMO's `left_before_right` has
extra turn-direction exceptions (`NBRequest.cpp`, `setBlocking`, written
for Madagascar), so the probe must confirm the result. If it still looks
wrong, set the minis' `resp` bits in `bake_net.py` ourselves from geometry.
This is the open "test that watches AI cars yield to the right at a
mini-roundabout" in ROADMAP item 3; the probe is the basis for that test.

## 1. Autoware (Apache-2.0)

Repos: `autowarefoundation/autoware_universe` @ 5c750db (2026-10-02) and
`autowarefoundation/autoware_core` @ ee8928e (the core planners moved there).

### Architecture: scene modules, minimum velocity wins

- `autoware_core/planning/behavior_velocity_planner/autoware_behavior_velocity_planner/src/planner_manager.cpp`
  (`planPathVelocity`): loops over loaded module managers; each one
  launches a module instance for every relevant thing on the path (one per
  traffic light, crosswalk, intersection), deletes instances once passed, and
  lets each modify the path.
- `.../autoware_behavior_velocity_planner_common/src/utilization/util.cpp`
  `setVelocityFromIndex`: a module never *raises* speed; it writes
  `min(existing, its limit)` onto every path point from its index onward. A
  stop is a zero-velocity point. Arbitration is just "the minimum wins", and
  each stop carries a *reason* (published as `stop_reasons`), which makes
  debugging possible.
- After that, `autoware_velocity_smoother` turns the capped profile into a
  drivable one under acceleration and jerk limits.
- `behavior_path_planner` (lateral: lane change, avoidance, pull over) runs
  modules in **slots** with fixed priority order from config
  (`docs/behavior_path_planner_manager_design.md`). A module is a *candidate*
  until approved, then *approved*; approved modules can run in series (avoid a
  parked car during a lane change).

### Modules that map to our needs (all under `autoware_universe/planning/`)

- **Intersection** (`behavior_velocity_planner/autoware_behavior_velocity_intersection_module/README.md`,
  `config/intersection.param.yaml`). Decision order: past the pass-judge line?
  → go. Exit blocked by a stuck car (speed < 0.83 m/s within 5 m past the
  junction)? → stop before the junction. Someone yielding to us? → still wait
  ("yield stuck"). Prioritised by the light? → only watch cars already in the
  junction. Otherwise collision check: for each foe, find its time to reach
  our path; collision if our passing window overlaps
  `[t − 3.0 s, t + 2.0 s]` (not prioritised). Switch to STOP at once, back to
  GO only after 0.5 s of continuous "safe" (`collision_detection_hold_time`):
  hysteresis against dithering. **Pass-judge line** = braking distance
  `v²/(2·a_max) + v·t_delay` before the conflict area; past it, never
  re-decide (no stopping in the middle of the junction). Occlusion: stop
  briefly, then creep at 1.39 m/s toward the "peeking" line until the view is
  clear. "Yield on green": wait 3 s when the light turns green but a foe is
  still close to its stop line.
- **Roundabout** (`autoware_behavior_velocity_roundabout_module`): new since
  our last look; single-lane entry only. Same time-window collision check
  against circulating cars (3.0 s / 2.0 s), stop line 1.5 m before the ring.
- **Traffic light** (`autoware_behavior_velocity_traffic_light_module`):
  formal dilemma zone. If you can stop under the jerk/decel limits, stop
  ("optional zone"); if you can't stop and can't clear on amber, emergency
  stop; if you can clear on amber, go. Amber assumed 2.75 s.
- **Crosswalk** (`autoware_behavior_velocity_crosswalk_module`): compares the
  car's time to the conflict point (TTC) with the pedestrian's (TTV). Stop
  only if they're close (`ego_pass_first_margin` 4 s, `ego_pass_later_margin`
  13 s). Stop 3.5 m before the crossing; if that needs more than 1.0 m/s²
  deceleration, move the stop point, and cancel the stop if it needs more than
  1.5 m/s². "No intention to walk" timeout so a pedestrian standing nearby
  doesn't block forever. **Obstruction prevention**: don't stop on the
  crossing if the car ahead leaves less than 6 m beyond it.
- **No stopping area** and **blind spot** (watch the inside lane for
  cyclists when turning): the same pattern.
- **Run out** (`motion_velocity_planner/autoware_motion_velocity_run_out_module`):
  times when a pedestrian's predicted path overlaps ours; slow or stop.
- **Obstacle cruise** (`motion_velocity_planner/autoware_motion_velocity_obstacle_cruise_module`):
  RSS-style safe distance `v·t_idle + v²/2a_ego − v_obj²/2a_obj + margin`.
  Also **yields to a car in the next lane that must cut in** because something
  is stopped in front of it: a human courtesy we can copy as a technique.
- **Lane change** (`behavior_path_planner/autoware_behavior_path_lane_change_module/config/lane_change.param.yaml`):
  RSS check with the rear car's reaction time 1–2 s, safety margin 0.8–1.0 s,
  expected decelerations 1 m/s²; prepare phase 2–4 s.
- **Static obstacle avoidance** (parked cars): an object counts as parked if
  it's been stopped 3–5 s and offset toward the kerb; the path shifts sideways
  under lateral jerk limits, and only into the oncoming lane when it's clear.

What doesn't transfer: perception, occupancy grids, the RTC operator-approval
layer, trajectory optimisers. We have perfect information.

## 2. Baidu Apollo (Apache-2.0)

Repo: `ApolloAuto/apollo` @ d53aa3d (2026-04-16), `modules/planning/`.

- **Scenarios, chosen in priority order.** `planners/public_road/conf/planner_config.pb.txt`
  lists: emergency pull over, emergency stop, valet parking, bare
  (unsignalled) intersection, stop sign, yield sign, traffic light
  unprotected left/right turn, traffic light protected, pull over, park and
  go, lane follow. `scenario_manager.cc` (`Update`): the running scenario
  keeps control until it finishes; otherwise the first scenario whose
  `IsTransferable` says yes takes over. Lane follow is the fallback.
- **Stages inside a scenario.** Stop sign
  (`scenarios/stop_sign_unprotected/`): PRE_STOP → STOP → CREEP →
  INTERSECTION_CRUISE. `stage_stop.cc`: wait at least `stop_duration_sec`
  (1 s), then go when no "watch vehicle" (one that arrived first on another
  approach) remains; time out after 8 s if only one car is being watched.
  Yield sign: activates 10 m out.
- **Creep** (`planning_interface_base/scenario_base/base_stage_creep.cc`,
  `proto/creep_stage.proto`): edge forward slowly; done when no moving
  obstacle reaches our path within `min_boundary_t` = **6 s**. That 6 s is
  Apollo's critical gap, close to HCM's 6.2–7.1 s for side-road movements.
- **Traffic rules make "stop walls".** `planning_base/common/util/common.cc`
  `BuildStopDecision`: every rule (crosswalk, stop sign, light, keep clear)
  creates a *virtual obstacle* at the stop line with a reason code; the
  speed planner then treats it like any other obstacle. This is what our
  `stepCar` already does with `gap`/`leadV = 0`.
- **Deciders then optimisers.** Each stage runs a fixed task list (lane
  change path, lane follow path, lane borrow path, path decider, rule-based
  stop decider, speed bounds, DP on the ST graph, speed decider, piecewise
  jerk QP). The speed decider labels each obstacle FOLLOW / YIELD / OVERTAKE
  / STOP on the station-time graph; follow distance by speed band
  (`tasks/speed_decider/conf/default_conf.pb.txt`). The QP machinery is far
  too heavy per NPC and unnecessary with IDM; the labelling idea is useful
  for debugging.
- **Prediction** (`modules/prediction/`): evaluators (cost, MLP, junction
  MLP, VectorNet, LSTM) score which lane sequence each agent will take;
  predictors turn that into trajectories. We know every NPC's route, so
  prediction collapses to "read the other car's route", but *we should let
  NPCs read only what a human could see* (indicator, speed, position), not
  the route, or they become clairvoyant.

## 3. Benchmarks and agent simulators

| Project | Licence | What to take |
|---|---|---|
| nuPlan devkit (`motional/nuplan-devkit` @ e924167) | Code Apache-2.0; **dataset CC BY-NC-SA 4.0 (non-commercial)** | Reactive agents are IDM along the logged path, stopping at red-light stop lines inserted into an occupancy map (`nuplan/planning/simulation/observation/idm/idm_agent_manager.py`); no right-of-way logic. Metrics list (`nuplan/planning/metrics/evaluation_metrics/common/`): at-fault collisions, drivable area, driving direction, progress, TTC within bound, comfort (lon/lat accel and jerk, yaw rate), speed-limit compliance, stop at stop line. |
| tuPlan Garage / PDM-Closed (`autonomousvision/tuplan_garage` @ b51d5d0) | Apache-2.0 | Won nuPlan 2023. Follows the lane-graph centreline; makes 15 proposals (IDM at 20/40/60/80/100 % of the limit × lateral offsets −1/0/+1 m), simulates each 4 s, scores by multiplying hard checks (no at-fault collision, drivable area, direction, progress) with a weighted mix of progress (5), TTC (5) and comfort (2) (`scoring/pdm_scorer.py`). IDM: headway 1.5 s, gap 1 m, a 1.5, b 3.0. Lesson: a well-built IDM rule planner beat every learned planner in closed loop. |
| Waymo Open Sim Agents Challenge (`waymo-research/waymo-open-dataset` @ 99a4cb3, `src/waymo_open_dataset/wdl_limited/sim_agents_metrics/`) | Repo Apache-2.0 **except `wdl_limited`: BSD-3 plus a patent grant that only covers evaluating Waymo data under the non-commercial dataset licence**; dataset non-commercial | The realism definition we'll borrow (concept only, our own code): 32 rollouts × 8 s at 10 Hz; for each feature, histogram the simulated values and score how likely the real log is under it. 2025 weights (`challenge_2025_sim_agents_config.textproto`): speed 0.05, accel 0.05, yaw rate 0.05, yaw accel 0.05, distance to nearest object 0.10, **collision 0.25**, TTC 0.10, distance to road edge 0.05, **off-road 0.25**, red-light violation 0.05. Safety and staying on the road dominate. |
| Waymax (`waymo-research/waymax` @ a64dfec) | **Waymax Licence for Non-Commercial Use** | Reference only. Has an IDM route policy (desired 30 m/s, gap 2 m, headway 2 s, a 2, b 4) and metrics: overlap, off-road, wrong way, kinematic infeasibility. Don't build on it. |
| GPUDrive (`Emerge-Lab/gpudrive` @ aa48a43) | MIT code; trained policies use Waymo data (non-commercial) | Self-play PPO agents at ~1 M steps/s on GPU; "Building reliable sim driving agents by scaling self-play" (2025) reports ~99.8 % goal reached with under 1 % collision+off-road. No traffic lights or give-way rules worth the name. Not for us; confirms that collision and off-road rates are the headline metrics. |
| MetaDrive / ScenarioNet (`metadriverse/metadrive` @ 85e5dad) | Apache-2.0 | `metadrive/policy/idm_policy.py`: IDM (time gap 1.5 s, gap 10 m) plus random-timed lane changes for overtaking. Simpler than ours. ScenarioNet converts Waymo/nuPlan/Argoverse logs into one format (logs keep their own non-commercial licences). |
| CommonRoad CriMe (`CommonRoad/commonroad-crime` @ 60bebed) | BSD-3 | A catalogue of criticality measures with clean definitions (`commonroad_crime/measure/`): TTC, time headway, **PET (post-encroachment time)**, time-exposed/integrated TTC, required deceleration, RSS distance. PET is the right measure for how close a give-way was. CommonRoad's formalised traffic rules (Maierhofer et al., interstate rules 2020, intersection rules 2022, temporal logic) are a template for writing our examiner's checks precisely. |
| CARLA Traffic Manager (`carla-simulator/carla` @ 1360bb9, `LibCarla/source/carla/trafficmanager/`) | MIT code, CC-BY assets | Pipeline: localisation → collision → traffic light → motion planner (PID) → vehicle lights. Its docs admit "junction priority does not follow traffic regulations": unsignalled junctions are first-in-first-out, and "vehicles inside a roundabout yielding to a vehicle trying to get in". Our SUMO-matrix approach is already better. Worth copying as ideas: per-vehicle knobs (`SetPercentageRunningLight`, `…RunningSign`, `…IgnoreWalkers`, `…IgnoreVehicles`, keep-slow-lane %, random lane change %, distance to leader, speed % of limit), the vehicle-lights stage (indicators before turns, brake lights from the command), and respawning dormant vehicles around the hero. Behaviour-agent profiles (`PythonAPI/carla/agents/navigation/behavior_types.py`): cautious / normal / aggressive differ in max speed, margin under the limit, proximity threshold, tailgating. |

## 4. openpilot (MIT), briefly

`commaai/openpilot` @ ec95db3. End-to-end vision for one car; nothing for
junctions or other agents. One useful number set: the longitudinal MPC's
driver "personalities" (`selfdrive/controls/lib/longitudinal_mpc_lib/long_mpc.py`
`get_T_FOLLOW`): **relaxed 1.75 s, standard 1.45 s, aggressive 1.25 s**, with
comfort braking 2.5 m/s² and a 6 m stopping gap. A sensible spread for our
headway distribution.

## 5. Human-likeness: driver models from traffic simulation

### SUMO (EPL-2.0), `eclipse-sumo/sumo` @ 1b33dffb

- **Car following.** Default Krauss (safe speed plus random "dawdling"
  `sigma` 0.5). **EIDM** (`docs/web/docs/Car-Following-Models/EIDM.md`,
  `src/microsim/cfmodels/MSCFModel_EIDM.cpp`; Salles et al., SUMO 2020)
  bundles Treiber & Kesting's extensions: IIDM base, ACC "coolness" 0.99,
  Human Driver Model errors as Wiener processes (`sigmagap` 0.1,
  `sigmaleader` 0.02, `sigmaerror` 0.1, correlation times `tPersDrive` 3 s
  and `tPersEstimate` 10 s), decisions only every `treaction` 0.5 s, jerk
  limit 3 m/s³, look-ahead `tpreview` 4 s for speed changes, and a shaped
  drive-off curve (`taccmax` 1.2 s, `Mflatness`, `Mbegin`). This is the
  closest existing thing to what we want, minus the parts that need
  sub-0.5 s steps.
- **Heterogeneity.** `speedFactor` default `normc(1, 0.1, 0.2, 2)`: about
  95 % of drivers between 80 % and 120 % of the limit.
- **Driver state** (`docs/web/docs/Driver_State.md`): perception errors on gap
  and speed difference as an Ornstein-Uhlenbeck process scaled by
  "awareness" (1 = perfect).
- **Junction model** (`docs/web/docs/Definition_of_Vehicles,_Vehicle_Types,_and_Routes.md`,
  the `jm*` table): `jmTimegapMinor` (1 s gap kept when passing before or
  after a priority car), `jmStoplineGap` (1 m), `jmCrossingGap` (10 m to a
  pedestrian walking toward the conflict), `jmDriveAfterYellowTime`,
  `jmDriveAfterRedTime` + `jmDriveRedSpeed`, `jmIgnoreFoeProb` +
  `jmIgnoreFoeSpeed` (ignore a slow priority car with some probability),
  `jmIgnoreJunctionFoeProb`, `jmIgnoreKeepClearTime` (block the junction
  after waiting this long), `jmStopSignWait`, `jmAllwayStopWait`,
  `jmAdvance` (creep toward the conflict point when the foe is already in
  the junction).
- **Gap acceptance as time windows** (`src/microsim/MSLink.cpp`,
  `blockedByFoe`): every approaching car registers its arrival and leaving
  time and speeds at the link. Ego is blocked if its own `[arrive, leave]`
  window and the foe's overlap once `jmTimegapMinor` is added; for merges it
  also checks the follower could brake safely. All-way stops go by who has
  waited longest.
- **Impatience**: `impatience = clamp(base + waitingTime / 180 s, 0, 1)`.
  It moves the foe's assumed arrival time from "as is" toward "if the foe
  braked as hard as it can" (`computeFoeArrivalTimeBraking`): at 1 the
  driver takes any gap that is merely *survivable*, forcing the priority car
  to brake. This is the model of "fed up, I'm going".
- **Lane changing** (LC2013, SL2015): `lcStrategic` (route), `lcCooperative`,
  `lcSpeedGain`, `lcKeepRight` (keep left for us), `lcAssertive` (accept
  smaller gaps), `lcImpatience`, `lcOvertakeRight` (probability of
  undertaking), `lcOpposite` (overtake through the oncoming lane),
  `lcCooperativeRoundabout`, `lcSigma` (lateral wander),
  `lcMaxSpeedLatStanding` (0 = no sideways sliding when stopped; ROADMAP
  item 9 already asks for that).

### Treiber & Kesting (book *Traffic Flow Dynamics*, 2013; papers)

Reference implementation in JavaScript: `movsim/traffic-simulation-de` @
e1b2d5d, **GPL-3.0, so techniques only**; `js/models.js` has IDM, ACC,
MOBIL and a "give way" coupling.

- **IDM**: `a[1 − (v/v0)^δ − (s*/s)²]`, `s* = s0 + vT + vΔv/(2√(ab))`.
- **IIDM** (improved IDM): replaces the free term so that when `v > v0`
  (entering a lower limit) the car decelerates gently, and the steady-state
  gap is exactly `s0 + vT`. Fixes our limit-change braking.
- **ACC model** (Kesting, Treiber, Helbing 2010): blends IIDM with the
  constant-acceleration heuristic using coolness `c ≈ 0.99`, so a car that
  cuts in close but is pulling away doesn't trigger panic braking. We need
  this for lane changes, merges and the player cutting in.
- **Human Driver Model** (Treiber, Kesting, Helbing 2006, Physica A):
  reaction time `T'` (delayed observations), estimation errors growing with
  distance, temporal anticipation, and **multi-anticipation** (react to the
  sum of interactions with the next 3–5 cars) which keeps the model stable
  despite the delay. Without multi-anticipation, a reaction time above about
  half the headway makes queues unstable and causes crashes.
- **MOBIL** (Kesting, Treiber, Helbing 2007): change lane if
  `ã_c − a_c + p·(ã_n − a_n + ã_o − a_o) > Δa_th + a_bias` and the new
  follower's braking stays below `b_safe` (≈ 4 m/s²). Politeness `p` 0
  (selfish) to 1 (altruistic), typical 0.2–0.5; `Δa_th` ≈ 0.1 m/s²; the
  bias term enforces keep-left. The same formula with a large bias handles
  mandatory changes (route, lane ending, parked car).
- **Numerical scheme** (Treiber & Kanagaraj 2015): the ballistic update
  (position with `½ a dt²`, speed clamped at 0) is markedly more accurate
  than Euler at the same step. We use Euler.
- **Calibration ranges** from trajectory data (Kesting & Treiber 2008, NGSIM
  and others): `T` ≈ 1.0–1.6 s, `s0` 1–3 m, `a` 0.8–2.5 m/s², `b` 1–3 m/s²;
  inter-driver differences are as large as the model error, so per-driver
  parameters matter.

### Published gap-acceptance and junction numbers (facts, not licensed data)

- **HCM two-way-stop critical headways**, passenger car, two-lane main road
  (mirrored for left-hand traffic): turn across from the main road 4.1 s
  (follow-up 2.2 s); turn away from the main road out of the side road
  (our left turn) 6.2 s (3.3 s); straight across 6.5 s (4.0 s); turn across
  out of the side road (our right turn) 7.1 s (3.5 s).
- **Roundabout entry** (HCM 2016 single-lane capacity
  `1380·e^(−0.00102·v_c)`): follow-up ≈ 2.6 s, critical headway ≈ 5.0 s.
  UK/Irish design (ARCADY, used by TII) is the empirical Kimber relation
  (entry capacity falls linearly with circulating flow); we can validate
  against that line rather than a gap value.
- **Signals**: UK saturation flow ≈ 2,000–2,100 pcu/h per straight lane
  (Kimber, McDonald & Hounsell 1986, TRRL RR67), i.e. ~1.75–1.8 s per car
  once a queue is moving; first car loses ~2 s starting up. ITE amber design
  uses 1.0 s perception-reaction and 3.0 m/s² deceleration; studies of
  amber stop/go find roughly half of drivers stop at about 3 s from the line.
- **Datasets** for calibration: NGSIM (US DOT, public domain, includes
  signalised arterials) is the only clean one for a product. highD / inD /
  rounD / exiD (levelXdata), INTERACTION, Waymo Open Motion, nuPlan and
  Argoverse 2 are **non-commercial**. Published summary numbers from papers
  are facts and fine to use.

## 6. Recommended design for our NPC drivers

### 6.1 Decision architecture: constraints, minimum wins

Per car per frame, a list of *constraints* along its path; the longitudinal
controller obeys the tightest one. This is Autoware's behaviour velocity
planner without the trajectory, and Apollo's stop walls.

```
Constraint = { s: distance ahead along path,
               v: speed that must not be exceeded from s on (0 = stop line),
               reason: "leader" | "signal" | "stop-sign" | "give-way" | "zebra"
                       | "keep-clear" | "turn" | "limit" | "parked" | "player" … }
```

- **Modules** (one function each, only for features within the next ~100 m
  of the path; scene instances keyed by junction/crossing id like Autoware,
  dropped once passed): Leader, SpeedLimit+Curvature, Signal, StopSign,
  Junction (give-way, roundabout, mini-roundabout, unprotected right turn),
  KeepClear (exit space and yellow box), Crossing (zebra and signalled
  crossing), Obstruction (parked car, stopped bus), PlayerReaction.
- **Longitudinal control**: for the real leader and for each stop constraint,
  IIDM/ACC with a virtual stopped car at `s`. For a speed cap `v_c > 0` at
  `s`, cap the desired speed by `√(v_c² + 2·b_comf·max(0, s − margin))`
  (EIDM's preview idea) instead of faking a gap. Take the minimum
  acceleration, clamp its change to the driver's jerk limit (3 m/s³) except
  for emergencies, integrate ballistically.
- **Stateful sequences** only where order matters (Apollo stages), as a few
  fields per car: `approach → stopping → waiting → creeping → committed`.
- **Commitment and hysteresis** (Autoware): past the pass-judge line
  (`v²/2b_max + v·t_react` before the conflict) a car never re-decides;
  STOP takes effect at once, GO only after ~0.5 s of continuous clear. This
  removes the stop-start dithering IDM gap checks produce.
- **Reasons are data**: each car carries its winning constraint's reason. A
  debug overlay ("waiting: give-way to car 41") and the tests read it; the
  examiner can too.
- **Decisions on action points**: gap acceptance, lane changes and
  courtesies are re-evaluated every 0.3–0.8 s per car (staggered),
  acceleration every frame. That is SUMO/EIDM's `treaction`, gives a natural
  reaction delay, and spreads CPU cost.

Why not Apollo-style scenarios as the top level: one scenario at a time is
built for a single robot that must be certain. Our cars face several things
at once (a zebra just past a mini-roundabout with a queue); constraints
compose, scenarios don't. Why not a learned policy: non-commercial training
data, no Irish rules, and PDM-Closed showed rules win closed loop anyway.
Why not PDM-Closed's sample-and-score per NPC: 15 forward simulations × 150
cars per tick buys little over IDM plus explicit rules; keep it as an
option for the overtake/avoid decision only.

### 6.2 Gap acceptance: one model for give-way, stop, roundabouts, turns

Bake once per junction (in `bake_net.py` or at load): for each pair of
conflicting links, the distance along each to their conflict point
(intersect the via polylines). Then, SUMO's time-window method:

- Ego: time to reach the conflict point and to clear it (conflict + own
  length), from its current speed with its own acceleration and the turn's
  speed cap. From a standstill, crossing 10–12 m at 1.5–2 m/s² takes
  3.5–4 s, so the **critical gap emerges** at roughly 5–7 s once the
  driver's margin is added, close to HCM and Apollo's 6 s, and it grows
  automatically for vans and buses.
- Foe: each priority-holder (including the player) approaching within ~8 s
  registers arrival and leaving times, using its current speed (a human
  can't see intent beyond speed, position and indicator).
- Blocked if the windows overlap once the driver's margin is added
  (`jmTimegapMinor`-style, per-driver 0.5–2.0 s; Autoware uses 3 s before and
  2 s after). Impatience grows with waiting (`base + wait/180 s`) and moves
  the foe's assumed arrival toward "if it braked hard", so long waits
  produce bolder pull-outs, the most human thing in this list.
- Indicators: a foe on a roundabout or main road that indicates it is
  turning off before our conflict point is treated as no foe, by drivers
  with a "trusts indicators" trait. A player who indicates and then goes
  straight will catch some NPCs out, as in real life.
- Equal-priority deadlock (four cars at a mini-roundabout): longest waiting
  goes (SUMO all-way stop, CARLA FIFO).
- Stop signs: full stop of `stopWait` (driver: 0.5–2 s; the rare roller
  never fully stops), then the same gap check, creeping forward for sight
  as Apollo does.

### 6.3 Driver profiles: one number, correlated traits

Draw one assertiveness `z ~ N(0,1)` per driver (clipped to ±2.5) and derive
everything from it plus small independent noise, so an aggressive driver is
aggressive everywhere (CARLA's cautious/normal/aggressive and openpilot's
personalities, made continuous):

| Trait | Mean | Per unit z | Source |
|---|---|---|---|
| Desired speed / limit | 1.00 | +0.07 (SD of total ≈ 0.1) | SUMO `speedFactor` |
| Time headway T | 1.45 s | −0.20 s, clamp 0.8–2.2 | openpilot 1.25/1.45/1.75; calibrations |
| Max accel a | 1.5 m/s² | +0.3 | IDM calibrations |
| Comfortable decel b | 2.0 m/s² | +0.4 | |
| Gap margin | 1.2 s | −0.35 s, clamp 0.4 | SUMO `jmTimegapMinor`, Autoware margins |
| Base impatience | 0 | +0.15 | SUMO `impatience` |
| Amber go threshold | stop if ≥ 3 s from line | −0.5 s | amber studies |
| MOBIL politeness p | 0.3 | −0.12, clamp 0–0.8 | Kesting 2007 |
| Reaction / action step | 0.6 s | ±0.15 noise | EIDM `treaction` |
| Honk patience | 6 s | −2 s | |
| Courtesy probability (let out, zebra wait) | 0.4 | −0.15 | place profile |

Within a drive, the Human Driver Model's slowly varying errors: an OU
process on desired speed (correlation ~3 s) and on the perceived gap
(~10 s, 5–10 % size). A **place profile** (Finglas, Yaba) shifts the `z`
mean and the error rates, which ROADMAP item 9 already asks for.

### 6.4 Human errors, on a budget

Rare, logged, per-place, never silently fatal. From SUMO's `jm*` and
CARLA's percentages:

- Late amber / early red (`jmDriveAfterYellowTime`, a few % of drivers).
- Rolling stop at a stop sign.
- Pulling out on a short gap because of impatience (comes free from 6.2).
- Not indicating (no indicator lit), or indicating and not turning.
- Following too close (low-T tail of the distribution).
- Blocking a junction after a long wait (`jmIgnoreKeepClearTime`).
- Ignoring a slow priority car with small probability
  (`jmIgnoreFoeProb`/`jmIgnoreFoeSpeed`); only when the conflict would be
  survivable.

Every injected error records which car, what and when, so the examiner can
tell "the learner reacted well to a hazard" from "the learner caused it".

### 6.5 Reacting to the learner

- Player in the conflict system as a foe and as a leader (already partly
  there), now with indicator state and a "committed" estimate from speed
  and position.
- Cut up: ACC coolness first; if it still has to brake harder than ~3.5–4
  m/s², brake and honk. **Record the forced deceleration**: the examiner's
  "caused another road user to brake/swerve" fault (RSA) becomes an
  objective number rather than a guess.
- Learner hesitates at a green light or roundabout entry: the car behind
  waits its honk patience, honks once, waits again; overtakes only where
  legal and clear.
- Learner stalls in a lane: queue forms, MOBIL moves cars around it on
  multi-lane roads.
- Learner waiting to emerge in a queue: a courteous driver (6.3) leaves a
  gap and stops (Autoware's "yield stuck" seen from the other side).

### 6.6 Performance budget (50–150 cars)

Leader search by lane occupancy (have it); constraints only for the next
few features; foe registration once per frame per link (have it as
`approach`, extend to arrive/leave windows); decisions on staggered action
points; no per-frame allocation (`pathAfter`). Expected well under 1 ms per
frame for 150 cars in V8; measure it in the harness.

## 7. Ranked build list

Effort: S ≤ 1 day, M 2–3 days, L 4+ days.

| # | Item | Effort | Why this order |
|---|---|---|---|
| 0 | Fix the mini-roundabout priority side in the bake; turn the probe into a test. | S | Wrong behaviour at Finglas's signature junction; blocks everything below. |
| 1 | Seeded RNG and a test API to spawn a car on a lane with a profile and route; **the realism harness** (section 8) running on today's code to get a baseline. | M | Measure before changing. |
| 2 | Constraint architecture (6.1): modules, minimum wins, IIDM/ACC, speed caps instead of fake gaps, jerk limit, ballistic update, stop reasons, commitment and hysteresis. Port today's behaviour into it unchanged. | M | Everything else plugs into it. |
| 3 | Driver profiles, action points, OU noise, start-up delay at green (6.3). | S–M | Ends the robotic look; cheap once 2 exists. |
| 4 | Time-window gap acceptance with conflict points, impatience, creep, stop-sign and all-way FIFO; roundabout and mini-roundabout entry; indicator reading (6.2). | M | Core of give-way, stop, roundabout and mini-roundabout behaviour for the test. |
| 5 | Keep-clear: don't enter without exit space; yellow boxes (OSM `junction=yellow_box` where tagged), right-turner exception. | S | Removes gridlock and teleports; it's the law. |
| 6 | Brake lights and indicators drawn on NPCs (ROADMAP 9). | S–M | The learner must be able to read NPC intent; 4 depends on indicators being visible. |
| 7 | Routes (trips) and strategic lane choice; MOBIL with politeness and keep-left bias; zipper merges at lane drops; cooperative gap-making (Autoware cruise "yield for cut-in"). Lane changes need forward speed (`lcMaxSpeedLatStanding` = 0). | L | Lane discipline on multi-lane roads and two-lane roundabouts (12 o'clock rule needs the exit). |
| 8 | Unprotected right turn across oncoming traffic: advance to the waiting point inside the junction (end of the first via; 1,843 Finglas right-turn links already have two vias), gap-accept the oncoming stream, clear at amber. | M | A classic test fault area; the internal waiting position already exists in the network. |
| 9 | Zebra and crossing courtesy: TTC-vs-TTV yield (Autoware), stop 1–3 m back, don't stop on the crossing, pedestrians signal intent at the kerb, "no intention" timeout. | S–M | Test item; builds on 2. |
| 10 | Parked cars (from OSM `parking:lane`/`parking:both`, else sampled on residential streets) and passing them: lateral shift under lateral-jerk limits, give way to oncoming when the obstruction is on your side (Rules of the Road), reuse `oncomingClear`. | M–L | Finglas estates are full of them; a test staple. |
| 11 | Reactions to the learner (6.5), with forced-deceleration events fed to the examiner. | M | Turns traffic into the test's moving parts. |
| 12 | Human-error budget per place (6.4). | S | Needs 2–4 to exist. |
| 13 | Buses: real stops (OSM), dwell 10–40 s, signal and pull out; NPCs wait or pass; courtesy to let buses out. Routes from NTA GTFS if its licence allows (check). | M–L | Dublin realism; uses 7 and 10. |

## 8. Headless realism test plan

A `tests/traffic-realism.test.mts` alongside `traffic.test.mts`, same
loader (`loadNet("finglas")`), fixed seeds, 10 Hz sampling, e.g. 5 seeds ×
10 minutes × 120 cars, plus scripted scenarios. Our own code, Waymo's idea:
compare *distributions* against target bands, and weight safety highest.

### Per-step and per-car metrics

| Metric | How | Target band (first guess; refine with NGSIM and published numbers) |
|---|---|---|
| Collisions | Oriented-box overlap between any two vehicles (not centre distance), and vehicle vs pedestrian | 0 per vehicle-hour without injected errors |
| Off-road | Car centre more than half a lane plus 0.5 m from any car lane, outside overtakes | 0 |
| Red-light running | Entering on red | 0 without errors; matches the error budget with |
| Free-flow speed / limit | Cars with no constraint within 6 s | Mean ≈ 1.0, SD ≈ 0.1 |
| Longitudinal accel | Histogram | ~95 % within ±2 m/s²; braking beyond 4 m/s² rare and always reasoned |
| Jerk | Histogram | 95th percentile below ~3 m/s³ |
| Time headway in following | Gap / speed when following above 5 m/s | Mode ~1.3–1.6 s; share below 0.8 s small and from low-T drivers |
| TTC | When closing on a leader | Share below 1.5 s rare |
| Distance to nearest car | Histogram (Waymo feature) | Compare to NGSIM arterial data |
| Queue discharge | Headway between successive cars crossing the stop line after green | ~1.8–2.0 s steady; first car ~2 s start-up loss |
| Accepted / rejected gaps | Log every gap a give-way car accepted or rejected; estimate critical gap (maximum likelihood or Raff's method) | Within ±1 s of HCM per movement (6.2–7.1 s side-road, ~4.1 s turn across from main road, ~5 s roundabout entry) |
| PET at conflicts | Time between one car leaving a conflict point and the next arriving (CriMe's definition) | Share below 1 s ≈ 0 |
| Roundabout entry vs circulating flow | Per entry, binned | Downward-sloping line like Kimber's |
| Junction blocking | Cars stopped inside a junction more than 5 s | ~0 after item 5 |
| Liveness | Teleports per vehicle-hour; share moving above walking pace | Teleports → ~0; moving share stays high |
| Determinism | Two runs, same seed | Identical |
| Cost | ms per `update` at 50/100/150 cars | Set a budget on the Mac and keep under it |

### Scripted scenarios (assert behaviour, read the stop reason)

1. Mini-roundabout: cars on two arms at once; the one with the other on its
   right waits.
2. Roundabout: entry waits for a circulating car, goes behind it; goes
   ahead of one that indicates off before the entry (when trusting).
3. Give-way onto a busy main road: waits, then accepts a gap; a long wait
   produces a shorter accepted gap (impatience).
4. Stop sign: full stop, then go; the error profile's roller doesn't.
5. Right turn across oncoming: waits at the in-junction point, clears at
   amber, never blocks the oncoming straight movement.
6. Zebra: pedestrian at the kerb, cars stop (courteous) or pass with the
   pedestrian still waiting (not), and never with someone on the crossing.
7. Exit blocked: car waits behind the line, not in the box.
8. Parked car with oncoming traffic: the car on the obstructed side waits.
9. Amber dilemma: cars that can stop comfortably stop; ones that can't go.
10. Learner cases: player stalled at green (honk after patience, then pass
    if legal), player cuts in (NPC brakes and honks; forced deceleration
    logged), player pulls out of a side road into a queue (a courteous NPC
    lets them in).

Also keep the existing three-minute test's assertions; tighten "overlaps"
to box overlap.

## Licences recap

| Source | Licence | Use |
|---|---|---|
| Autoware Universe / Core | Apache-2.0 | Techniques; parameter values cited |
| Apollo | Apache-2.0 | Techniques |
| SUMO | EPL-2.0 | Techniques, parameter names and defaults cited; the network tools we already run |
| CARLA | MIT (code), CC-BY (assets) | Techniques |
| nuPlan devkit | Apache-2.0; dataset CC BY-NC-SA 4.0 | Techniques; **data non-commercial** |
| tuPlan Garage (PDM) | Apache-2.0 | Techniques |
| Waymo Open Dataset tools | Apache-2.0, except `wdl_limited` (BSD-3 + patent grant limited to non-commercial Waymo evaluation) | **Metric concept only; don't port `wdl_limited` code**; dataset non-commercial |
| Waymax | Non-commercial licence | **Reference only** |
| GPUDrive | MIT; policies trained on non-commercial data | Reference |
| MetaDrive / ScenarioNet | Apache-2.0 | Reference |
| CommonRoad CriMe | BSD-3 | Metric definitions |
| openpilot | MIT | Numbers cited |
| traffic-simulation.de (Treiber) | **GPL-3.0** | Techniques only (equations are published) |
| highD/inD/rounD/exiD, INTERACTION, Argoverse 2, Waymo Open Motion | Non-commercial | Not for calibration of a product; published summary numbers only |
| NGSIM | US public domain | OK for calibration |
