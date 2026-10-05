# 23: How our traffic vehicles look, against Dublin and against games

Date: 2026-10-05. Question: from the driver's seat in Finglas, how far are our
traffic vehicles (`game/public/models/car_traffic_*`, `car_service_*`,
`bus_dublin_dd`) from what a learner actually sees on Dublin roads, and from
how good games and sims dress their ambient traffic? What do we fix first?

What was checked: the GLBs themselves (bounds, materials, textures and light
meshes read with a script from the binary glTF), the Blender previews in
`reference/<name>/preview.png`, `trafficnet.ts` (KINDS, PAINTS, render),
`models.ts`, `graphics.ts`, and the Mac screenshots in `game/shots/svc/001-008`
(10:37, autodrive), `game/shots/lights/001-008` (20:31) and older runs
(`paint/`, `veh/`). Real-world figures are from SIMI, the NTA, the Irish
Statute Book, BusConnects and Wikipedia (sources at the end). Photos of
Dublin vehicles were not stored. Nothing here was tried in the game: this is a
research note, no code was changed.

## Summary: the eight that matter, ranked

Ranked by how much each one hurts realism from the driver's seat, in daylight
first and then at night.

| # | What's wrong | Fix | Cost |
|---|---|---|---|
| 1 | **Nothing to reflect.** No `scene.environment` (`graphics.ts` has a hemisphere light only). Paint is MeshStandard, no clearcoat; glass is black at alpha 0.84 with roughness 0. Dark cars close up read as black blobs with no shape (svc/005 bottom right, svc/006, paint/003); windows are black holes. | Sky into a cube, PMREM, `scene.environment`, refreshed when the sun moves about 1° (already the top item in research 05 and 07). CarPaint becomes `MeshPhysicalNodeMaterial` with clearcoat 1 and clearcoat roughness about 0.05; glass gets lighter tint plus Fresnel reflection. The player's car gains too. | S–M |
| 2 | **Traffic is unlit.** Headlights are plain grey MeshStandard; there are no tail lamps (brake "off" is a dim red and nothing more), and no daytime running lights. At 20:31 the traffic is dark shapes (lights/005). The light meshes on four service vehicles are split wrongly (see "Lights" below): the taxi's roof sign and the truck's beacon blink as rear indicators, the bin lorry's brake lights run along its sides, and the tow truck and taxi have no brake lights at all. | Headlights and tail lamps take an instance colour like the brake lights: DRL white by day; dipped beam plus red tail at night. Fix the light split in `build_service_vehicles.py` and add a test that brake lights and rear indicators sit in the rear 15 % of the length below 1.6 m. | S |
| 3 | **Empty cars.** No drivers and no visible cabin. Real traffic at 10–30 m always shows a head and shoulders behind the glass, on the right in Ireland. | Lighter glass (from #1); a low-poly seat block and a seated driver on the right (-X in our models) from the Rocketbox set we already ship, at one LOD, hidden beyond about 60 m. | M |
| 4 | **No number plates.** Every Irish car carries two: white, 520 × 110 mm, black characters, blue EU band with IRL on the left, the county name in Irish above the number. Their absence is the most noticeable "toy car" cue after paint. | One plate quad front and rear on each model, sampling an atlas of plates by instance. Plates must be fictional (CLAUDE.md: no real plates), so this needs the owner's call on the format (see "Plates"). | S–M |
| 5 | **Wrong-for-Ireland vehicles.** The compact SUV is a US full-size SUV (Tahoe/Yukon shape) shrunk to 4.43 m, and always near-black because its paint couldn't be separated (`CarBody`, texture mean 29/255). The taxi is a Crown Victoria with a US checker stripe and a short orange roof box. The "postal van" is a US full-size Chevy Express shape. The utility truck is a US pickup with a service body. The bin lorry is a US cab-over with exhaust stacks and is 2.76 m across its rear duals and 3.22 m overall, wider than the EU limit of 2.55 m. | Taxi first: an Irish roof sign and front-door decal on our saloon or estate (S). Then a crossover SUV (Tucson/Sportage/Qashqai class), a cab-forward medium van (Trafic/Transit Custom class) and a low-entry bin lorry (Econic/Dennis Eagle class), from the owner's Blender pipeline or CC-BY/CC0 bases (M each, L for the lorry). Until then, narrow the lorry to 2.5 m and drop the utility truck from Dublin's fleet. | S → L |
| 6 | **Two sizes for every car.** `KINDS` gives all five car kinds `len: 4.3, w: 1.8`, but the models are 4.05–4.69 m long; the small van is 5.0 in `KINDS` and 4.50 m as built. Following gaps, overtakes and collisions use `KINDS`, so a saloon's bumper sits 0.17 m inside the gap the IDM keeps. | Read length and width from each loaded model's bounds (or bake them into a sidecar) and delete the numbers from `KINDS`. One source of truth. | S |
| 7 | **Only the old bus livery.** Our bus is Dublin Bus blue and yellow. Since 2021 every new PSO bus (Dublin Bus PA and EW classes, 381 of about 1,165) arrives in the TFI livery: a full yellow front, green body and white vinyl. Older buses switch at their four-yearly repaint. By 2026 a Finglas learner sees both. The destination display is blank. | A second material set (KHR_materials_variants, which `models.ts` already reads) in TFI colours, picked per bus. A route number and a destination on the blind as an emissive texture (route numbers aren't logos). | S |
| 8 | **Dated, clean, rigid.** The pack's styling is late-1990s to mid-2000s (amber lenses, chrome grilles); the Irish fleet averages 9.9 years old, so it's mostly 2014–2020 cars with LED DRL strips. There's no road grime on the sills or arches, and the front wheels roll but don't steer. | Grime: a world-space "low and facing down" darkening term in the paint shader (no texture). Steering: yaw the front wheel instances by the lane curvature. Styling only improves with new models (see #5). | S each; restyling L |

Smaller items: the paint palette is already close to the Irish colour ranking
(see "Colours"), but greys and silvers should be metallic and the rest not;
the fleet's 30 % hatchbacks and 9 % one-shape SUVs need re-weighting toward
crossovers (see "Mix"); there's no LOD and every part casts shadows (fine at 64
cars, worth a look before a busier junction).

## 1. Dublin's traffic as it really is

### Cars: makes, models, body types

- 2025 new car registrations: 124,954 (SIMI). Top models: Hyundai Tucson,
  Skoda Octavia, Kia Sportage, Toyota Yaris Cross, Toyota RAV4. Top makes:
  Toyota, Volkswagen, Skoda, Hyundai, Kia. Fuel: petrol 25 %, hybrid 22 %,
  electric 19 %, diesel 17 %, plug-in 15 %.
- 71,813 used cars were imported in 2025 (SIMI), most from the UK, which keeps
  older right-hand-drive hatchbacks and saloons common on the road.
- The licensed fleet is old: average age 9.9 years, 48 % ten years or older
  (SIMI national fleet page). So what a learner sees in Finglas is mostly
  2010s Golfs, Focuses, Corollas, Octavias, Qashqais, Yarises, Fiestas and
  Tucsons, with a growing share of new crossovers and EVs.
- SIMI says the hatchback is still the top-selling body type (2024 and 2025
  releases), but it doesn't publish shares, and its "hatchback" seems to take
  in many crossovers. The top five models are four crossovers and one
  liftback, which is the better guide to new traffic.
- At 31 Dec 2019 the licensed stock was 2,805,839 vehicles: 2,174,779 private
  cars (78 %) and 366,760 goods vehicles (13 %) (Department of Transport
  bulletin). Newer bulletins weren't read.

### Colours

SIMI's colour ranking for new cars:

| Year | Grey | Black | White | Blue | Red |
|---|---|---|---|---|---|
| 2020 | 37 % | ~18 % | ~15 % | 14.8 % | 10.7 % |
| 2021 | ~35 % | 19 % | – | 16.5 % | – |
| 2023 | 37.2 % | 19.9 % | – | – | – |
| 2025 | 1st (10th year running) | 2nd | – | 3rd | – |

Our `PAINTS` list (18 entries) gives grey and silver 6 (33 %), black 3 (17 %),
white 3 (17 %), blue 2 (11 %), red 2 (11 %), green 1, brown 1. That's close.
Fixes: grey and silver want metallic (most Irish greys are metallic), and
because the SUV model can't be tinted, black is over-represented in practice:
9 of 64 cars are always-black SUVs on top of the palette's own black.

### Vans

- 2025 LCV registrations: 32,779. Top brands: Ford (22.8 %), Volkswagen,
  Renault, Toyota, Citroën. Top models: Renault Trafic (2,374) and Ford
  Transit Custom (2,346). 91 % diesel (SIMI via Factor Focus).
- So the typical Dublin van is a one-tonne, cab-forward medium van (Trafic,
  Transit Custom, Transporter, Vivaro), followed by small vans (Transit
  Connect, Berlingo, Caddy, Kangoo) and pickups (Hilux, Ranger, D-Max). A
  US-style bonneted full-size van (our `car_service_van`) isn't seen in Dublin.
- An Post: about 3,600 vehicles, around 1,000 electric (2023), including 45 VW
  ID. Buzz Cargo vans; earlier Renault Kangoo Z.E. trials (2012). Vans are An
  Post green. A plain green van reads as An Post without any logo; whether
  even the plain colour is acceptable is the owner's call (CLAUDE.md bars
  logos and names, not colours).

### Taxis

- Regulation (S.I. 549/2010, as quoted in searches; the Statute Book returned
  403 to a direct fetch): the roof sign's lit face is 110–120 mm high and
  1,030–1,120 mm long. Each face has three sections: the centre reads "TAXI"
  or "TACSAÍ" in yellow letters (80–90 mm) on dark blue. The section to the
  left seen from behind, and to the right seen from the front, is 360–425 mm
  of yellow carrying the licence number in black. It is lit during lighting-up
  hours unless the taxi is hired.
- Since January 2013 every taxi carries semi-permanent "Taxi" branding on the
  driver's and front passenger's doors, with its vehicle licence number and
  the Transport for Ireland logo (NTA press release, 2012). The NTA's 2020
  bulletin confirms that a taxi "must carry prescribed branding on its front
  doors and be fitted with a taximeter, printer and roof sign".
- Taxis are any colour (the minister: "these approaches [yellow cabs, black
  cabs] would be far too expensive"), so letting the taxi take any paint is
  right. New taxis may not have tinted windows (NTA 2012).
- Fleet: 17,488 taxis and wheelchair-accessible taxis at end 2015, about 70 %
  in the Greater Dublin Area (NTA 2016). Common models: Skoda Octavia (trade
  sources say about a quarter of the fleet; not verified against NTA data),
  Toyota Corolla/Prius/C-HR hybrids, Hyundai Ioniq and Kia Niro, plus MPVs and
  wheelchair vans (Ford Tourneo, VW Caddy, Peugeot Rifter style). None looks
  like a Crown Victoria.

### Number plates (Republic of Ireland)

- Front and rear: white background, black characters, 520 × 110 mm (the same
  plate both ends; a yellow rear plate is UK/Northern Ireland). Characters at
  most 70 mm high and 36 mm wide, sans serif; no font is mandated.
- Format since 2013: `YYH-CC-SSSSSS` (e.g. year 24, half 1, Dublin "D", then a
  sequence number). The Irish county name ("Baile Átha Cliath" for Dublin) sits
  above the number; a blue EU band with "IRL" is on the left. Since July 2025
  zero-emission cars may add a green stripe on the right.
- Northern Ireland cars (UK format, yellow rear) are a small but real share in
  Dublin.

### Dublin Bus

- Fleet about 1,165: SG (483, Volvo B5TL / Wright Gemini 3, 2014–21), PA
  (217, Alexander Dennis Enviro400ER hybrid), EW (164, Wright StreetDeck
  Electroliner, 2023 on), GT (142, Volvo B9TL / Wright Gemini, 2012–13), EV
  (78, B9TL / Enviro400), VG (24) and small classes. Most are two-door
  (Wikipedia).
- Dimensions: Wright Gemini, two-axle, 10.0–11.5 m long, 2.52 m wide, 4.23 or
  4.4 m high; StreetDeck 10.57–11.5 m × 2.52 m × 4.40 m (Wikipedia).
- Liveries: Dublin Bus blue and yellow (since the 2000s); TFI livery since
  2020–21 on all new PSO buses whatever the operator: "green, yellow and black
  paintwork overlaid with white vinyl", a full yellow front, and yellow
  banding round the entrance door for visually impaired passengers
  (BusConnects). Repaints follow the roughly four-yearly cycle.

### Bin lorries

- Dublin households are served by private firms: Panda, Greyhound, Thorntons
  and City Bin Co (the last two under common ownership). Their lorries are
  white-bodied with company branding (not to be modelled).
- Chassis: low-entry cab-forward refuse chassis, typically Mercedes-Benz Econic
  2630 6×2 (Keywaste and Greyhound bought them for Dublin) and Dennis Eagle
  (Thorntons' electric 27 t 6×2 eCollect with rear steer, Terberg body).
  Rear-loading body with a bin lift for 240/360 l wheelie bins.
- Size: a 26 t 6×2 refuse lorry is roughly 10–10.5 m long, 2.5 m wide
  (2.55 m is the EU limit; Dennis Eagle's Olympus body comes in 2.53 m and
  2.23 m widths) and about 3.5 m high. Figures are from manufacturer pages and
  trade press, not a single published spec, so treat them as about ±0.3 m.

### Recovery and utility trucks

- Irish recovery trucks are cab-over 7.5–12 t tilt-and-slide bodies (Iveco
  Daily/Eurocargo, DAF LF, MAN TGL, Isuzu). Our tow truck (cab-over, flatbed,
  amber beacon) is plausible for Ireland. Its red chevrons are fine.
- A US pickup with a service body (our `car_service_truck`) is rare. The
  Irish equivalent is a chassis-cab Transit or Iveco Daily with a tipper or
  a crew cab, or a Hilux/Ranger pickup.

## 2. Real dimensions against our builds

Ours were measured from the GLB vertex data: length along Z; width taken below
half height so mirrors don't count; "all" includes mirrors. Real figures are
the manufacturers' published numbers as given on Wikipedia and in brochures
(rounded).

| Kind (file) | Our L × W × H (m) | `KINDS` len × w | Real class reference | Real L × W × H (m) | Verdict |
|---|---|---|---|---|---|
| Hatchback (`car_traffic_1`) | 4.05 × 1.66 (1.78 all) × 1.38 | 4.3 × 1.8 | VW Golf 8 / Toyota Yaris | 4.28 × 1.79 × 1.46 / 3.94 × 1.75 × 1.50 | 0.1 m narrow, 0.1 m low |
| Saloon (`car_traffic_2`) | 4.63 × 1.79 × 1.43 | 4.3 × 1.8 | Skoda Octavia / Toyota Corolla saloon | 4.69 × 1.83 × 1.47 / 4.63 × 1.78 × 1.44 | right |
| Estate (`car_traffic_3`) | 4.69 × 1.81 × 1.48 | 4.3 × 1.8 | Octavia Combi | 4.69 × 1.83 × 1.47 | right |
| Compact SUV (`car_traffic_4`) | 4.43 × 1.74 × 1.67 | 4.3 × 1.8 | Hyundai Tucson / Toyota Yaris Cross | 4.50 × 1.87 × 1.65 / 4.18 × 1.77 × 1.56 | 0.13 m narrow; shape is a shrunk US full-size SUV (real Tahoe about 5.1 × 2.0) |
| Small panel van (`car_traffic_5`) | 4.50 × 1.66 × 1.72 | 5.0 × 1.9 | Transit Connect / Berlingo | about 4.4 × 1.84 × 1.80 | 0.18 m narrow, 0.1 m low |
| Panel van (`car_service_van`) | 5.30 × 1.89 × 1.96 | 5.3 × 2.0 | Renault Trafic L1H1 / Transit Custom L1 | 5.00 × 1.96 × 1.97 / 5.05 × 2.03 × 1.97 | size fine, shape US bonneted |
| Taxi (`car_service_taxi`) | 4.70 × 1.73 × 1.39 | 4.7 × 1.85 | Octavia / Corolla | 4.69 × 1.83 × 1.47 | 0.1 m narrow, 0.08 m low; a Crown Vic (real 5.4 m) squashed to 4.7 |
| Utility truck (`car_service_truck`) | 6.60 × 2.43 × 2.74 | 6.6 × 2.2 | (none typical in Dublin) | – | wrong class for Ireland |
| Tow truck (`car_service_tow`) | 7.20 × 2.20 (2.47 all) × 2.48 | 7.2 × 2.4 | 7.5 t tilt-and-slide recovery | about 7–8 × 2.3–2.5 × 2.9–3.2 | plausible; a bit low |
| Bin lorry (`car_service_bin_lorry`) | 9.40 × 3.22 × 3.48 (rear duals 2.76 across) | 9.4 × 2.5 | Econic 2630 6×2 / Dennis Eagle | about 10–10.5 × 2.5 × 3.5 | too wide (illegal), about 0.8 m short; two-axle look is right only for small lorries |
| Bus (`bus_dublin_dd`) | 10.9 body (11.37 with mirrors) × 2.59 × 4.40 | 10.8 × 2.5 | Gemini 3 / StreetDeck | 10.6–11.5 × 2.52 × 4.4 | right (body 0.05 m wide incl. trim) |

The script measured 2.59 m for the bus below half height, which includes the
door frames and trim. `build_bus.py` builds the body at 2.55 m.

## 3. Lights as built (read from the GLB light meshes)

Positions in model space (+Z forward, rear is negative Z; height above the
ground):

- Cars 1–5 and `car_service_van`: headlights, brake lights and indicators are
  at the right ends and heights. Good.
- `car_service_taxi`: rear indicators at y 1.32–1.39 m, z ≈ 0, which is the
  **roof sign**, so the roof box flashes amber as the taxi indicates. There is
  no brake-light mesh (ROADMAP already notes this).
- `car_service_truck`: rear indicators at 2.32–2.41 m high, mid-length (the
  **roof beacon**); reverse lights run 2 m along the side (z −3.22 to −1.15).
- `car_service_tow`: rear indicators are a strip 3.4 m long down each side
  (z −3.5 to −0.08); no brake lights.
- `car_service_bin_lorry`: "brake lights" are side strips at mid-length (z −2.97
  to −1.31), not at the rear; rear indicators at 3.2 m high (the top of the
  packer); front indicators are strips 4 m long down the sides.

The existing `models.test` checks only that headlights are at the front. A test
for "brake lights and rear indicators sit at the back, low, and aren't longer
than 0.6 m" would have caught all four.

## 4. How games and sims make ambient traffic look real

Ranked roughly by how much each technique contributes, with where it comes
from.

1. **Environment reflections on paint and glass.** GTA V renders a 128 × 128
   HDR cube of the scenery every frame and folds it into a dual-paraboloid map
   for car reflections. Other cars and people aren't in it, and nobody notices
   (Courrèges, GTA V graphics study). The browser driving demos we took apart
   do the same cheaply: djentic renders its sky into a cube one face per frame
   and PMREMs it into `scene.environment`, with car paint at clearcoat 1 and
   clearcoat roughness 0.03 and glass with clearcoat at opacity 0.62 (research
   07). Teleoperator's car paint has a base layer, metallic flakes per cell
   that fade to roughness with distance, a clear coat, and Beer–Lambert
   darkening toward the silhouette (research 06). Technique source for us:
   three.js r186 (MIT) `PMREMGenerator` / `pmremTexture`, and
   `MeshPhysicalNodeMaterial.clearcoat`; three's car-materials example shows
   paint with clearcoat and an env map.
2. **Lights carried by every vehicle, driven by state.** CARLA (MIT code)
   gives each vehicle a light state bit set (position, low beam, high beam,
   brake, left/right blinker, reverse, fog, interior), and its Traffic Manager
   can switch them automatically by time of day (`update_vehicle_lights`).
   CARLA's vehicle spec needs separate materials for lights and their inner
   and outer lens glass. We already have brake and indicator states. We're
   missing position, low beam and DRL.
3. **Plates and per-vehicle variety.** CARLA's vehicle spec has a
   `LicensePlate` material on a 29 × 12 cm plane that the engine textures
   itself. BeamNG builds plates from a JSON layout (background image, text
   boxes) per country, in EU 52 × 11 and other formats, with generated text.
   GTA V picks per-vehicle plate styles and text (`SET_VEHICLE_NUMBER_PLATE_TEXT_INDEX`
   and related natives) and a dirt level per vehicle. All three treat the plate
   as one quad plus a generated texture, never as modelled geometry.
4. **People in the cars.** GTA V, BeamNG traffic and Forza Horizon all put a
   driver in every ambient car. CARLA's spec keeps an `Interior` material and
   separate inner and outer glass so the cabin shows through. With no driver, a
   moving car reads as a ghost car at junction distances. (General
   observation from play; no single published source.)
5. **LODs and culling.** CARLA asks for four LODs (100k, 80k, 60k, 30k
   triangles) on hero-quality cars. Cities: Skylines vehicles are 500–1,000
   triangles with 10–100 triangle LODs. Teleoperator ships every traffic car
   with a `_lod1`. GTA V picks each object's LOD on the GPU. For three.js,
   `@three.ez/instanced-mesh` (InstancedMesh2, MIT) adds per-instance LOD,
   frustum culling and shadow LOD. It's not checked yet against r186's
   WebGPU renderer.
6. **Re-lighting baked textures.** Teleoperator's traffic cars came out of a
   generator with lighting baked into the textures. Its shader splits paint,
   glass, rubber and metal with a mask and re-lights them (research 06). We
   already do the paint half (`paintmask.py`); the same mask could set
   metalness and roughness per region instead of trusting the pack's texture.
7. **Grime and wear.** GTA's dirt level per vehicle, BeamNG's dirt, and
   Teleoperator's rain beads on the clear coat in wet weather. A cheap version
   is a procedural darkening by height and normal (no textures, no licences).

Repos whose code could be read for these (licences allowed by CLAUDE.md): three.js
(MIT), CARLA (MIT code; its assets are CC-BY), `@three.ez/instanced-mesh` (MIT).
BeamNG and GTA V are closed; only their documented behaviour is used here.

## 5. Mix

Our fleet (64 slots): hatch 19 (30 %), saloon 12, estate 6, SUV 9, small van
6, medium van 3, taxi 4, bus 2, utility truck 1, tow 1, bin lorry 1. So cars
72 %, vans 14 %, the rest 14 %.

Against Ireland: cars about 78 % and goods vehicles 13 % of the stock (2019),
so the split is about right. Within cars, crossovers (Tucson, Sportage,
Qashqai, Yaris Cross) should be about a third of anything 2018 or newer and
growing, and one SUV shape won't carry that. Taxis at 6 % are plausible on
Finglas main roads and too many on estate roads (a later per-road-class
weighting). The utility truck should go from the Dublin fleet until there's an
Irish one. One bin lorry is right on bin day and wrong at 2 a.m. (later:
schedule service vehicles by hour).

## 6. Wrong-for-Ireland checklist

- Left-hand drive: no interiors show, so nothing is visibly wrong yet. When
  drivers go in (#3), they sit on the right (−X; the build scripts put the
  kerb side, left, at +X).
- Mirrors: models have both; nothing side-specific.
- Taxi: the US body, checker stripe and short roof box are all wrong. The Irish
  look is any colour, a long blue and yellow roof sign with a yellow licence
  section, and front-door decals.
- Bin lorry: the US cab and exhaust stacks are wrong, and it's too wide.
- Panel van and utility truck: US body shapes.
- SUV: US full-size shape, untintable paint.
- Plates: none (all Irish vehicles have white front and rear plates).
- Bus: the livery is right for part of the fleet; TFI green is missing.
- Amber front indicators inside the headlamp, chrome grilles: dated rather
  than wrong.

## 7. Plates: a decision for the owner

CLAUDE.md says models carry "no ... real house numbers or plates". A plate with
the real Irish layout but a number that can't exist would follow the rule and
still look right. Options: (a) a series no county has issued, e.g. a valid year
code with sequence 000000, or a non-existent county code; (b) the right layout
with the characters only suggested (blocks that read as text from 10 m, blur
up close). Recommendation: (a), a generated atlas of about 32 plates, year codes
131–252, county "D" and the sequence fixed at 0-prefixed numbers that the
Revenue system doesn't issue. That boxes the project in a little (a rule about
what counts as "real"), so ask before building it. The font has to be MIT,
CC0 or CC-BY, or drawn by us; most plate fonts are OFL or commercial.

## Sources

Data and rules (used as facts; no images stored):

- SIMI, "124,954 New Car Registrations in 2025": https://www.simi.ie/en/news/124-954-new-car-registrations-in-2025
- SIMI, "121,195 new car registrations in 2024": https://www.simi.ie/en/news/121-195-new-car-registrations-in-2024-electric-cars-reach-17-459
- SIMI national vehicle fleet (average age 9.9 years): https://www.simi.ie/en/environment/drive-greener/national-vehicle-fleet
- Factor Focus, colour shares 2023: https://www.factorfocus.ie/?p=30747 ; Autobiz, colours 2020/2021: https://www.autobiz.ie/all/irelandrsquos-most-popular-new-car-colours-in-2020 , https://www.autobiz.ie/home/36594-shades-of-grey
- Factor Focus, LCV market 2025: https://www.factorfocus.ie/index.php/positive-2025-for-irelands-light-commercial-vehicle-market/35006
- Department of Transport, Bulletin of Vehicle and Driver Statistics (2019 stock via MerrionStreet): https://merrionstreet.ie/en/news-room/releases/bulletin_of_vehicle_and_driver_statistics1.html
- S.I. 549/2010 (taxi roof sign), Irish Statute Book: https://www.irishstatutebook.ie/2010/en/si/0549.html (text read via search extracts; the page returned 403)
- NTA, "New branding for Ireland's taxi fleet unveiled" (2012): https://www.nationaltransport.ie/wp-content/uploads/2012/10/New-branding-for-Irelands-taxi-fleet-unveiled.pdf
- NTA, Report on Public Consultation on Taxi Roof Signs (2016): https://www.nationaltransport.ie/wp-content/uploads/2015/08/Report_on_Public_Consultation_on_Taxi_Roof_Signs_-_2016.pdf
- NTA, Taxi Bulletin 2020: https://www.nationaltransport.ie/wp-content/uploads/2021/10/NTA-Taxi-Statistics-2020-1.pdf
- Octavia in Irish taxi fleets (trade press, unverified share): https://www.odo.ie/reviews/skoda-octavia-ireland , https://dublinpeople.com/news/motoring/articles/2013/07/13/the-skoda-octavia-as-driven-by-taxi-drivers/
- Wikipedia (CC BY-SA text, facts only), Irish plates: https://en.wikipedia.org/wiki/Vehicle_registration_plates_of_the_Republic_of_Ireland
- Wikipedia, Dublin Bus fleet: https://en.wikipedia.org/wiki/Dublin_Bus ; Wright Eclipse Gemini: https://en.wikipedia.org/wiki/Wright_Eclipse_Gemini ; Wright StreetDeck: https://en.wikipedia.org/wiki/Wright_StreetDeck
- BusConnects, new bus livery: https://busconnects.ie/cities/dublin/new-bus-livery
- Irish Times, Dublin Bus liveries: https://irishtimes.com/culture/art-and-design/from-faecal-brown-to-loop-the-loop-the-changing-colours-of-dublin-bus-1.4583230
- Electrive, An Post ID. Buzz Cargo and EV fleet: https://electrive.com/2023/11/07/irish-post-deploys-45-vw-id-buzz-cargo ; An Post Kangoo Z.E. trial: https://www.anpost.com/Media-Centre/News/An-Post-trials-electric-post-vans-on-city-routes
- Dublin bin operators: https://www.dublincity.ie/waste-and-recycling/about-household-waste/your-waste-collection-services , https://selectra.ie/waste/dublin/bin-companies
- Refuse chassis in Dublin: https://fleet.ie/mercedes-benz-waste-management-customers-upgrade-fleets/ , https://www.recyclingproductnews.com/article/40258/thorntons-recycling-deploys-new-dennis-eagle-electric-collection-vehicle
- Dennis Eagle body widths: https://www.transportengineer.org.uk/content/features/the-eagles-have-landed

Games and sims (techniques; no code read from closed or copyleft sources):

- Adrian Courrèges, "GTA V – Graphics Study" (2015): http://www.adriancourreges.com/blog/2015/11/02/gta-v-graphics-study/
- CARLA, "Add a new vehicle" (vehicle LODs, material slots, plate): https://carla.readthedocs.io/en/latest/tuto_A_add_vehicle/ ; Python API (VehicleLightState, Traffic Manager lights): https://carla.readthedocs.io/en/latest/python_api/ . CARLA code MIT, assets CC-BY.
- BeamNG, license plates (modding docs): https://documentation.beamng.com/modding/vehicle/sections/licenseplates/
- FiveM / GTA V native reference (plate and dirt natives): https://docs.fivem.net/natives/
- Cities: Skylines vehicle triangle budgets (community guidance): https://steamcommunity.com/workshop/filedetails/discussion/667342976/1639789306562159404
- `@three.ez/instanced-mesh` (InstancedMesh2), MIT: https://github.com/agargaro/instanced-mesh
- three.js (MIT): PMREMGenerator, MeshPhysicalNodeMaterial, the car-materials example: https://github.com/mrdoob/three.js
- Our own teardowns: research 06 (Teleoperator), 07 (djentic, Mars GT), 05 (IBL and car paint).

Models (already credited in `game/public/models/CREDITS.md`): Comrade1280,
"Generic passenger car pack" and "Generic civil service vehicles pack",
CC-BY-4.0 (Sketchfab).
