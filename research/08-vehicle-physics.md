# 08: Vehicle physics, the industry approach and our parameters

Date: 2026-10-04. Owner's rule: research how simulators do it, then build.

## How simulators do it

- **Chassis:** a rigid body (six degrees of freedom) in a physics engine, with
  **raycast suspension**: each wheel is a spring-damper along a ray from its
  mount point. This is the Bullet `btRaycastVehicle` lineage, which Rapier ports
  as `DynamicRayCastVehicleController`
  ([Rapier docs](https://rapier.rs/javascript3d/classes/DynamicRayCastVehicleController.html)).
  Games from indie titles up to many commercial ones use it.
- **Tyres:** the **Pacejka Magic Formula** is the industry standard (MF-Tyre is
  in every major vehicle dynamics package:
  [Simcenter Tire](https://in.mathworks.com/products/connections/product_detail/delft-tyre.html);
  JS reference: [Tread](https://github.com/aunyks/tread)).
  `F = D·sin(C·atan(B·s − E·(B·s − atan(B·s))))`, with D = μ·Fz.
  Typical dry-asphalt passenger-car values: B ≈ 10, C ≈ 1.9, D ≈ 1, E ≈ 0.97
  ([Pacejka](https://www.wikipedia.org/wiki/Pacejka),
  [Stanford ME106](https://me106.stanford.edu/hw/hw1/hw1.pdf)). We use C 1.65
  for longitudinal and 1.3 for lateral, the usual split in the literature.
  Combined slip: the theory-based similarity method (normalised slip vector).
- **Low speed:** slip ratio and slip angle divide by speed and blow up near
  standstill. Commercial tools (CarSim) use a **relaxation length**: slip is a
  lagged state, not an instantaneous value
  ([relaxation length](https://taylorandfrancis.com/knowledge/Engineering_and_technology/Industrial_engineering_%26_manufacturing/Relaxation_length),
  [stable discrete-time model](https://arxiv.org/pdf/2411.17334)). We lag both
  slips over σ ≈ 0.4 m, with a small speed floor.
- **Force feedback:** sims (rFactor, Assetto Corsa, Forza) drive the wheel
  from the steering rack torque: the front tyres' **self-aligning moment**,
  which is lateral force times (pneumatic + mechanical) trail. Pneumatic trail
  collapses as the tyre starts to slide, so the wheel goes light at the limit
  ([discussion](https://gamedev.net/forums/topic/711400-generating-force-feedback-from-slip-angle-data/),
  [f1technical](https://f1technical.net/forum/viewtopic.php?p=482953)).

## Our car: a typical Irish automatic test car

Based on the VW Polo 1.0 TSI 110 DSG
([Top Gear spec](https://www.topgear.com/car-reviews/volkswagen/polo/10-tsi-110-r-line-5dr-dsg/spec-0),
[cars-data](https://cars-data.com/en/volkswagen/polo/2021/1-0-tsi-110hp-r-line--103988/specs)):

| Quantity | Value | Note |
|---|---|---|
| Mass | 1,134 kg kerb + 75 kg driver ≈ 1,210 kg | Top Gear |
| Axle loads | 910 / 800 kg (gross figures) → ~59 % front at kerb | cars-data |
| Wheelbase | 2.552 m | spec |
| Track | ~1.50 m | class typical |
| CG height | ~0.55 m | not published; typical B-segment hatch |
| Yaw inertia | ≈ m·a·b ≈ 1,900 kg m² | standard estimate |
| Engine | 200 Nm 2,000–3,500 rpm, 81 kW @ 5,500 | 1.0 TSI 110 |
| Gearbox | 7-speed dual-clutch (DQ200 class); creeps in D | |
| Tyres | 185/65 R15, radius 0.31 m, μ ≈ 1.0 dry, ~0.7 wet | |
| Springs / damping | ~1.3 Hz ride, damping ratio ~0.3 | class typical |
| Steering | 14:1, so the G29's 900° lock-to-lock maps to ±32° at the wheels | |
| Brakes | ~1 g peak, 70/30 front/rear | |

Targets to check the model against (published or class-typical):
0–100 km/h in about 10 s, 100–0 km/h in about 37 m, about 0.85–0.9 g peak
lateral, and steady creep of about 5–7 km/h in D.

## What we built (`game/src/client/carphysics.ts`)

A Rapier rigid body (mass and inertia set explicitly) with our own raycast
suspension (rather than Rapier's controller, so the tyre model is ours): four
spring-dampers, anti-roll bars, bump stops, Ackermann steering, combined-slip
Magic Formula tyres with relaxation-length lag, a 7-speed dual-clutch
automatic with creep and torque dips on shifts, the parking pawl, ABS and
traction control (both standard on every EU car since 2014), aero drag and
rolling resistance, 240 Hz sub-steps. Building walls stream in as static
colliders within 90 m; nearby AI cars are kinematic boxes. Force feedback is
the front tyres' aligning torque through a 14:1 rack.

Tyre coefficients settled on after testing: longitudinal B 14, C 1.6, E 0.3
(peak at 12 % slip, a locked wheel keeps ~70 % of peak grip); lateral B 12,
C 1.3, E −1, scaled 0.92 (peak near 8°). The first set (B 11, C 1.65, E 0.97)
peaked at 30 % slip, which is unrealistic and made braking too long.

Results (`cd game && npx tsx tools/physics-test.mts`):

| Check | Result | Target |
|---|---|---|
| 0–100 km/h | 9.5 s | ~10 s (published 10.2 s) |
| 100–0 km/h | 37.9 m | ~37 m |
| Peak lateral | 0.93 g | 0.85–0.9 g |
| Creep in D | 5.9 km/h | 5–7 km/h |
| Light-throttle upshifts (30 %) | 1→2 at 19, 2→3 at 31, 3→4 at 45 km/h | DSG economy shifting |
| Held on the brake / in P | no movement | none |
| Aligning torque | negative when steering right, positive left | centring |
| Physics cost in the browser | 0.57 ms per frame | |

Not yet modelled: kerb faces (the footpath is a 12 cm step under each wheel,
so you can drive up it at any angle), surface grip per material, wet grip
(waits for live weather), tyre temperature and wear.
