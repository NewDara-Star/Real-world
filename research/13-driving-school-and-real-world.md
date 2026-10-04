# 13: What it takes to build a real-world driving school simulator

Date: 2026-10-04. Scope: the products closest to ours (driving-school and
training simulators, real-world map driving and exploring), the full list of
systems a real-world driving sim needs, where we stand on each, Irish data
sources, and what matters most for practising the Irish test in Finglas.

> **Method and limits.** Most sites were blocked by this session's network
> proxy (rsa.ie, data.gov.ie, Steam, the vendors' own sites, arXiv, YouTube),
> so most facts come from search-engine extracts of those pages, not from
> reading them in full. The OSM wiki was readable and I measured our own
> Finglas data locally. Anything I couldn't confirm is marked **[unverified]**.
> Before building against a figure, check it on the Mac, where these sites open.
> The most important document to read in full is the RSA's own marking guide,
> *Making Your Mark* ([PDF on rsa.ie](https://www.rsa.ie/docs/default-source/services/s3.2-adi/making-your-mark-marking-guidelines-for-the-driving-test.pdf)).

---

## 1. Summary

1. **The biggest gap for "practise the Finglas test" is the road data, not
   the graphics.** I measured the Finglas network we bake. Overture's
   transport schema has no lane counts, no turn lanes and no roundabout flag.
   Our `finglas.osm` is converted from Overture, so it carries **0 `lanes`
   tags, 0 `junction=roundabout`, 0 `mini_roundabout`**, and SUMO's
   `--roundabouts.guess` found **0 roundabouts**. Almost every car edge has one
   lane per direction. Driving schools describe Finglas as a test centre with
   many mini-roundabouts, and its pass rate (about 46% in 2022) is below the
   national rate (about 53%)
   ([Ireland Before You Die](https://www.irelandbeforeyoudie.com/?p=20039),
   [Today FM](https://todayfm.com/news/revealed-driving-test-centres-with-the-highest-and-lowest-pass-rates-1333734)).
   ROADMAP item 13 (real OSM lanes, turn lanes and roundabouts via Overpass)
   should move to the top of the list.
2. **Every serious training simulator is built the same way: a virtual
   instructor that checks a fixed list of procedures, gives short spoken
   feedback straight away, and logs everything for a debrief.** Examples are
   Carnetsoft, Green Dino and the Dutch "Nederlandse Rijsimulator", Virage and
   Doron. Our examiner has the right shape (RSA grades 1/2/3). It covers about
   a dozen checks, while the RSA sheet has 18 headings. It has no roundabout,
   following-distance, progress, clearance or manoeuvre marking, and no
   end-of-test report.
3. **Simulator training works a little, not a lot.** The best field study
   (Quebec, 1,120 learners, 1 to 4 simulator hours in place of road hours)
   found fewer infractions and the same crash rate. Dutch data on 804 learners
   found that simulator performance predicts first-time pass only weakly
   (r ≈ 0.18). So the value is in **rehearsing the specific procedures and the
   specific roads**, not in general "driving feel". That matches our plan:
   real Finglas roads and the RSA sheet.
4. **Consumer driving-school games are loved for the idea and hated for the
   examiner.** City Car Driving's most common complaints are that its
   penalties fire instantly (1 km/h over the limit for a moment), that it
   penalises things that weren't there (pedestrians who don't exist), that its
   signal rules contradict each other, and that its traffic AI gets stuck. The
   lesson: use tolerances and hysteresis like a human examiner, explain every
   fault, and show where it happened.
5. **Real-world map products divide into "data at planet scale" and
   "handmade".** Microsoft Flight Simulator uses Bing imagery, OSM and machine
   learning, which is good from 300 m up and generic at street level. ETS2 is
   handmade at 1:19, with cities at 1:3. TDU Solar Crown is handmade at 1:1 for
   Hong Kong Island (600 km of road) with a large AAA team. CARLA and SCANeR
   build towns from OpenDRIVE (RoadRunner or OSM import) and decorate them by
   hand or procedurally. Our approach (open data, baked, plus procedural
   decoration) is the only one a tiny team can afford for a real town. It is
   viable because a test-prep sim needs **correct roads and junctions within
   about 5 km of one test centre**, not the planet.
6. **Ireland has good open data, all CC BY 4.0.** GSI open lidar (DTM and DSM)
   gives terrain and building heights. Tailte Éireann's open data covers
   boundaries and some base data. Dublin City Council publishes SCATS signal
   sites and 5-minute traffic volumes. OSM Ireland has near-complete buildings
   in Finglas (20,950 of our 21,755 buildings come from OSM). DCC speed limits
   are **not** open data; OSM is the best source, and 1,674 of our ways carry
   `maxspeed`.

---

## 2. Systems breakdown

"Where we are" is from the code and data in this repo today.

| System | How the best do it | Where we are | Gap |
|---|---|---|---|
| **Vehicle physics** | Rigid body, tyre model (Pacejka or brush), drivetrain. CarSim and VI-grade at the high end, BeamNG soft-body for games and research. Training sims (Carnetsoft, Virage) use simpler validated car models. Accuracy matters less than **low-speed behaviour**: creep, hill hold, parking speeds, kerbs. | Rapier, raycast suspension, Pacejka with relaxation length, DSG automatic, ABS/TCS (`research/08`). | Kerb faces, surface grip, automatic **creep and hill hold** tuned for manoeuvres. Needs checking on the real G29. |
| **Input and force feedback** | Pro: real car cockpits, direct-drive wheels, 6-DOF motion (Cruden, VI-grade HexaRev). Training: real-car controls, pedals, often three screens at 180–240° (Doron 660: four 55" 4K screens, 240°). Consumer: G29-class wheels. | G29/G923 over WebHID with tyre-torque FFB, keyboard and pads. | Fine for our use. Field of view is the real issue (see Display). |
| **Display and field of view** | 180–240° for training: you have to *see* side roads and blind spots. Mirrors are inset or rendered. Simulator sickness is the main dropout cause: about 40% of older trainees in some programmes. | One screen, rendered mirrors, head-check keys. | Wide FOV option or triple-screen support. Head-look on a button or hat switch already stands in for head checks. Webcam head tracking later. |
| **World data: roads** | OpenDRIVE as the logical road (lanes, widths, elevation, signals), made in RoadRunner or imported from OSM. SCANeR uses RoadXML/OpenDRIVE. CARLA's Digital Twin Tool imports OSM. ETS2 and TDU: handmade. | Overture to OSM to SUMO `netconvert` to baked `.net.bin`. | **No lanes, turn lanes or roundabouts from Overture.** Need OSM direct, with `lanes`, `turn:lanes`, `junction`, `highway=mini_roundabout`, `give_way`/`stop`, bus lanes and their hours. |
| **Junction geometry and markings** | Junction surfaces from lane geometry (osm2streets, SUMO walking areas, CARLA from OpenDRIVE). Markings per national manual (Irish Traffic Signs Manual ch. 7). | SUMO junction shapes; road and lane paint in `roadrender.ts`. | Irish markings to the manual: yield and stop lines, yellow box, mini-roundabout disc, hatched areas, bus lane text, cycle lanes. |
| **Signs and signals** | Placed from data (OpenDRIVE signals, Mapillary detections) or by hand. | Signals from SUMO (72 TLS in Finglas), signs in `roadsigns.ts`. | Check SUMO's guessed signals against DCC's SCATS site list (CC BY). Speed-limit signs where the limit changes. School zones. |
| **Terrain and elevation** | DTM from lidar where it exists (MSFS uses photogrammetry plus DEM). CARLA and RoadRunner bake elevation into the road profile. | **Flat world.** | GSI open lidar DTM (CC BY 4.0) for the Finglas bbox, baked into road z and ground. Needed for the **hill start**. |
| **Buildings** | MSFS/Blackshark: footprints and heights from imagery by ML (1.5 billion buildings). Handmade facades for landmarks. Streets GL and OSM2World: Simple 3D Buildings tags. | 21,755 footprints (96% OSM). Heights: tagged for about 10%, guessed for the rest. Facade atlas. | Heights from lidar nDSM (DSM − DTM). Google Open Buildings 2.5D doesn't cover Europe. Facade styles per Finglas house type (ROADMAP 8). |
| **Vegetation and street furniture** | Procedural from land cover plus OSM points (MSFS has 30 biomes; OSM2World supports 250+ tags). | Some props, trees, streetlights. | Hedges and garden walls (they block sight lines at junctions, which matters for observation), parked cars on estate roads. |
| **Rendering** | See `research/05`, `06`, `07`. | WebGPU/WebGL2, atlas textures, mirrors. | Already on the roadmap. Least important for test prep. |
| **Traffic AI** | Microscopic car-following plus lane change (IDM/MOBIL or Wiedemann). SCANeR: multi-agent drivers with goals. CCD and Carnetsoft: scripted "dangerous situations" injected into normal traffic. CARLA: SUMO co-simulation at 20 Hz. | IDM, junction right of way, reacts to the player, Dublin Bus model. | Real trips (ROADMAP 4), **cyclists** (left-turn observation is a classic Irish fault), parked cars, buses pulling out, **scripted hazards** for practice. Calibrate volume from SCATS counts. |
| **Pedestrians** | Social force (Viswalk), crossing behaviour, scripted "runs out" events. | Walkers on footpaths and crossings, yield checks. | Social force (ROADMAP 5), people waiting at zebra crossings, children near schools. |
| **Rules engine / examiner** | Carnetsoft: checks speed, gear, pedals, indicator timing, mirror and shoulder checks, headway, turning speed, priority, roundabouts, lane position. Green Dino: procedure-based assessment that feeds an adaptive instructor. | `rules.ts`: footpath, wrong side, speeding, moving off (shoulder, signal), red/amber, STOP, yield, pedestrian on crossing, signals at turns, left-turn observation, collisions. | Roundabouts (approach lane, signal on exit, give way to the right, hesitation), **progress** (undue hesitancy is a real fail cause), following distance, clearance to parked cars and cyclists, mirrors *before* signal, position at turns, anticipation, the three manoeuvres. Fail logic per RSA (§4.1). |
| **Instructor and feedback** | Virtual instructor: step-by-step instructions, then route guidance, then **immediate short verbal feedback** on errors, then a lesson report. Curriculum: about 50 lessons, from part tasks to automation to integration (Carnetsoft). Research: concurrent feedback helps now but can hurt retention (guidance hypothesis), so fade it. | Live fault panel, spoken sat-nav. | Two modes: **Lesson** (spoken cues, explanations) and **Mock test** (silent, examiner-style directions, report at end). Fault replay on the map. |
| **Scenarios and curriculum** | STISIM: Scenario Definition Language and 90+ scenarios. SCANeR: scenario editor. CCD: 19 driving-school exercises plus exam. Carnetsoft: about 50 lessons. | Free drive and sat-nav. | Exercise list mapped to RSA headings: moving off, junctions, roundabouts, manoeuvres, mock test routes from the Jamestown Road centre. |
| **Audio** | Recorded engine loops crossfaded by RPM and load (Project CARS: 100+ files per car in FMOD) or granular synthesis. Plus spoken instructor. | Synthesised engine and street bed, browser speech synthesis. | Good enough. A better instructor voice is the one that matters. |
| **UI and debrief** | Instructor workstation (Doron IWS, Virage debrief station): replay, trace on a map, fault list, progress over sessions. | HUD, map, pause menu. | RSA-style test report sheet, session history, map trace with faults pinned. |
| **Weather and time** | All of them: rain, fog, night, snow. | Day/night; weather planned (ROADMAP 3). | Rain matters for the test (lights, wipers, stopping distance). |
| **Performance** | Fixed 60 Hz plus. Training sims run on mid PCs. | Electron on a Mac. | Keep the physics and examiner tick fixed and independent of frame rate. |
| **Testing and validation** | Pro sims validate against track data. Training sims validate the *instructor* against human instructors (TU Delft and Green Dino studies on 520 and 804 learners). | Headless `tsx` scripts for traffic and examiner. | Scripted test drives that must produce known faults. Have a real ADI watch a mock test and mark it, then compare. |

---

## 3. Driving-school and training simulators

### 3.1 City Car Driving (Forward Development, Russia)

- **What it is:** the best-known consumer driving-school sim, first released
  2007 and on Steam since 2016. City Car Driving 2.0 (Unreal Engine 5) went
  into **early access on 16 June 2026** at about €30, with one city (a third
  of the planned map), three cars, traffic, wheel and pad support, and strict
  rules. Driving school, taxi and cargo modes are promised for later
  ([iXBT](https://ixbt.games/en/news/2026/06/07/nazvana-cena-i-data-vyxoda-rossiiskogo-avtosima-city-car-driving-20-v-rannem-dostupe-steam.html),
  [Steam](https://store.steampowered.com/app/2327720/)). So a studio that has
  done only this game for 19 years shipped its UE5 rebuild with the
  driving-school mode still missing.
- **Teaching:** a "Driving School" career of 19 exercises (manoeuvres,
  parking, defensive driving), free drive with rule monitoring, and an
  instructor who gives hints. Rule sets for the EU, Germany, the UK, the USA,
  Canada, Australia and Russia, with left- or right-hand traffic
  ([Steam](https://store.steampowered.com/app/493490),
  [pixelnitro](https://pixelnitro.com/?p=8111)) **[19 exercises: unverified]**.
- **Traffic:** normal AI plus injected "dangerous situations": cars into the
  oncoming lane, sharp stops, pedestrians running out, broken traffic lights
  ([AlternativeTo](https://alternativeto.net/software/city-car-driving/about/)).
- **Users praise** strict rules and a real-feeling city with traffic.
  **Users complain** that the examiner penalises instantly (1 km/h over for a
  moment), that it penalises absent pedestrians, that signal rules contradict
  each other on reverse entry and lane changes, that it marks "hindering" cars
  far away, that the handling is "like a ship", that wheel support is poor,
  and that the AI gets stuck
  ([Steam discussions](https://steamcommunity.com/app/493490/discussions/0/1620600279655798461),
  [vaporlens summary](https://vaporlens.app/app/2327720/city_car_driving_2_0)).
- **Lesson for us:** every check needs a tolerance, a minimum duration, and a
  reason that the player can see on a replay. Our speeding check already uses
  a percentage band. Extend that pattern everywhere.

### 3.2 Other consumer games

- **3D Fahrschule / 3D Driving School (Germany):** drive in five cities
  (Berlin, Ghent, Madrid, London, Paris), with day/night, rain and snow, a
  virtual instructor, and the official German theory question bank (about
  1,400 questions)
  ([eBay listing summary](https://www.ebay.de/p/12050700742)). It combines
  theory and practical, which is the model to copy for the Irish Driver
  Theory Test later. **[city list: unverified]**
- **Driving School Sim (Ovidiu Pop, mobile):** 150+ cars, open maps,
  multiplayer, challenges. It is an arcade game wearing a driving-school name,
  not a training tool
  ([APKMirror](https://apkmirror.com/apk/ovidiu-pop/driving-school-sim-2020)).
- **BeamNG.drive / BeamNG.tech:** not a school, but a free research licence,
  soft-body physics, and use in university driver-behaviour studies. About 70
  staff ([BeamNG](https://beamng.gmbh/),
  [Built In](https://builtin.com/company/beamng)).

### 3.3 Professional training simulators

- **Carnetsoft (Netherlands), the most transparent vendor.**
  - **Curriculum:** about 50 lessons. Part-task instruction, then automation
    of each part task, then integration drives on fixed routes (towns,
    roundabouts, motorways), then night and bad weather
    ([curriculum](https://cs-driving-simulator.com/driver-training-curriculum/),
    [task automation](https://cs-driving-simulator.com/task-automation/)).
  - **The virtual instructor reads** speed, gear, pedal positions, rpm,
    indicator, handbrake, lights, lane position and **eye gaze**. It checks
    local limits, signs and markings, safe headway, safe turning speed, when
    and how often mirrors are checked, signal timing, and the lane-change
    procedure (indicator in time, mirror, shoulder). It also gives step-by-step
    instructions and route guidance, and **immediate verbal feedback** on each
    error ([virtual instructor](https://cs-driving-simulator.com/the-virtual-instructor/),
    [student assessment](https://cs-driving-simulator.com/student-assessment-system/)).
  - This is the closest public description of what our `rules.ts` should grow
    into.
- **Green Dino and the Nederlandse Rijsimulator (TU Delft).** About 300
  simulators sold to driving schools, more than 90 Dutch schools using the
  TU Delft and Green Dino low-cost simulator, and "automatic instruction and
  assessment based on driving procedures"
  ([Resource](https://resource-online.nl/index.php/2021/02/25/campus-company-green-dino/?lang=en)).
  The research behind it:
  - The *Virtual Driving Instructor* is a multi-agent system that adapts to
    the student. It was designed after watching police driving instructors,
    with a focus on **feedback timing and wording**
    ([ResearchGate](https://www.researchgate.net/publication/316498340_The_Virtual_Driving_Instructor_A_Multi-Agent_Based_System_for_Driving_Instruction),
    [Kappé, DSC 2003](https://www.researchgate.net/publication/228873340_Virtual_instruction_in_driving_simulators)).
  - de Winter et al. studied 520 trainees. Failure reasons split into
    **violations** and **errors**: men committed more violations, women made
    more errors
    ([TU Delft](https://repository.tudelft.nl/record/uuid:6223405d-4241-4036-a11c-9436b3bbe24a)).
  - On 804 learners, fewer steering errors in the simulator predicted a
    first-time pass, with r ≈ 0.18
    ([SWOV](https://swov.nl/en/publicatie/relationships-between-driving-simulator-performance-and-driving-test-results)).
- **STISIM Drive (Systems Technology Inc., USA).** Over 500 organisations,
  research and clinical use. It has a **Scenario Definition Language**: roads,
  curvature, elevation, intersections, signal timing, vehicles, pedestrians
  and events written as a script, with 90+ stock scenarios
  ([SDL docs](https://web.mit.edu/course/16/16.400/www/auto_sim/Help/SDL.htm),
  [STI](https://www.systemstech.com/clinical/applications/driving-research)).
  The idea to copy is **scenarios as data**: a lesson is a script of
  triggers on our real network.
- **SCANeR studio (AVSimulation, France).** The road model is RoadXML with
  geometry, markings, semantics, materials, signs and surface layers, and it
  imports OpenDRIVE. Traffic is **multi-agent: each driver has goals and a
  behaviour profile**, plus a scenario editor
  ([AVSimulation](https://www.avsimulation.com/en/applications/infrastructure-smart-cities/),
  [PoliTo lab](https://www.diati.polito.it/en/about/facilities/laboratories/road_safety/scaner_studio_1_9)).
- **Virage (Canada).** Real car cockpit, mirrors as insets, progressive routes
  from beginner to expert, weather, hazard perception and eco-driving, plus a
  debrief station ([OHS buyers guide](https://buyersguide.ohsonline.com/company/615513/products/196348/vs500m-vs600m)).
- **Doron (USA).** The 660 has four 55" 4K screens at 240°, an Instructor
  Workstation, and a three-day on-site instructor course with every system
  ([Doron](https://doronprecision.com/training-curriculum/)).
- **Cruden and VI-grade.** Engineering simulators with 6-DOF motion (VI-grade
  HexaRev direct drive), 210°+ projection, and latency budgets in
  milliseconds. They show the top end. They don't change what we build
  ([Cruden](https://cruden.com/article/acceleration-is-not-enough-theres-more-to-accurate-motion-cueing-than-meets-the-eye),
  [SAE](https://saemobilus.sae.org/articles/simulating-forward-motion-vi-grades-zero-prototypes-day-25autp10_14)).

### 3.4 Does it work? Evidence

- **Quebec:** 1,120 learners; up to 6 of 15 mandatory road hours could be
  replaced by simulator hours, and 95% did 1–4. Simulator-trained learners had
  **lower infraction rates and similar crash rates** over two years
  ([Hirsch & Bellavance 2017](https://doi.org/10.3141/2660-01)).
- **Systematic reviews:** the evidence on safety is inconclusive. Simulators
  do transfer specific trained skills, such as hazard scanning
  ([review](https://www.sciencedirect.com/science/article/abs/pii/S1369847818304406),
  [2024 review](https://www.sciencedirect.com/science/article/pii/S0022437524000975)).
- **Feedback:** continuous lane-position feedback improved performance during
  training, but the gain vanished at retention (guidance hypothesis).
  Concurrent speed feedback helped high-risk young drivers
  ([feedback survey](https://arxiv.org/pdf/1705.04683),
  [Iowa DA](https://pubs.lib.uiowa.edu/driving/article/id/28636/)). In
  practice: talk during lessons, fade the talk as faults drop, and keep the
  mock test silent.
- **Simulator sickness:** up to about 40% dropout among older trainees. It
  gets worse with immersion and long sessions, and intersection turns are the
  worst case
  ([CMS conference](https://openaccess.cms-conferences.org/publications/book/978-1-958651-36-0/article/978-1-958651-36-0_52)).
  Keep sessions short and avoid camera motion the player didn't cause.

### 3.5 How scoring compares with the RSA

| Product | Scoring |
|---|---|
| RSA test | Grade 1 (minor), 2 (serious), 3 (dangerous) per aspect under 18 headings. Fail on any grade 3; or 4 grade 2s in one aspect; or 6+ grade 2s under one heading; or 9+ grade 2s overall. |
| UK DVSA | Driving fault, serious, dangerous. Fail on more than 15 driving faults, or any serious or dangerous fault ([gov.uk DT1](https://www.gov.uk/guidance/guidance-for-driving-examiners-carrying-out-driving-tests-dt1/annex-6-guide-to-assessment-and-marking)). |
| City Car Driving | Points per violation and instant fail on serious ones. Strict, with almost no tolerance. |
| Carnetsoft / Green Dino | Per-procedure error log by category, used to steer lessons, not a pass/fail mark. |
| Ours | RSA grades with the RSA fail rule in the header comment. Not yet grouped by heading and aspect. |

None of the commercial products uses the Irish sheet. That is our edge, but
only if it is faithful.

---

## 4. The Irish test (what we must model)

### 4.1 Marking

- Three grades. **Fail** on: any grade 3; 4 grade 2s on the same aspect;
  6 or more grade 2s under one heading; 9 or more grade 2s overall. Grade 1s
  are unlimited ([boards.ie summary](https://www.boards.ie/discussion/comment/108773878/),
  [BP Driving School](https://bpdrivingschool.com/blog-how-rsa-driving-test-graded-faults-explained.html)).
  This matches the comment in `rules.ts`, but the code doesn't yet group
  faults by aspect and heading, so it can't apply the rule.
- **18 headings**, each with aspects (approach, at junction, at roundabout,
  turning right, and so on). From driving-school write-ups of the sheet:
  rules of the road and checks, position, mirrors, signals, clearance,
  overtaking and meeting, observation, right of way, progress, speed, traffic
  controls, anticipation, courtesy, vehicle controls, secondary controls,
  reverse, turnabout, hill start
  ([Russell Driving](https://www.russelldriving.com/driving-test-report-explained/),
  [BP](https://bpdrivingschool.com/blog-how-rsa-driving-test-graded-faults-explained.html)).
  **[exact list and aspect grid: check against the RSA PDF]**
- **Manoeuvres:** reverse around a corner, turnabout (three-point turn), hill
  start. Parking is mentioned in some 2026 guides
  ([RSA standard procedures 2025](https://www.rsa.ie/docs/default-source/road-safety/r3-education/driving-test-standard-proceedures-2025.pdf),
  [BP turnabout](https://bpdrivingschool.com/blog-turnabout-3-point-turn-ireland.html)).
  **[confirm whether parking is now examined]**
- **Automatic test:** same roads, manoeuvres and marking; licence code 78
  ([odo.ie summary](https://www.odo.ie/guides/automatic-driving-test-ireland)).
  On an automatic, the hill start tests brake-to-accelerator timing without
  rolling back.
- **Finglas centre:** Jamestown Business Park, Jamestown Road, Dublin 11.
  Pass rate about 46% in 2022 against about 53% nationally. Local schools
  stress mini-roundabouts. The RSA doesn't publish test routes.

### 4.2 What a mock test needs

1. Start at the centre. Pre-drive checks (secondary controls: lights, wipers,
   demister).
2. About 30 minutes of driving on local roads, with the examiner giving
   directions in RSA wording ("at the roundabout, take the second exit")
   **[duration unverified]**.
3. Two or three manoeuvres at plausible spots: a quiet corner for the
   reverse, a quiet road for the turnabout, a real gradient for the hill
   start.
4. A report in the RSA grid, with each fault pinned on the map and replayable.

---

## 5. Real-world map driving and exploring

- **Microsoft Flight Simulator (Asobo, Blackshark.ai, Bing).** About 2.5 PB of
  Bing imagery plus OSM vectors. ML classifies buildings (footprint, height,
  roof type, neighbourhood type) and rebuilds about 1.5 billion of them.
  Hand-built photogrammetry covers some cities. MSFS 2024 adds 3D vegetation
  and 30 biomes
  ([TechCrunch](https://techcrunch.com/2020/08/17/meet-the-startup-that-helped-microsoft-build-the-world-of-flight-simulator),
  [PC Gamer](https://pcgamer.com/games/sim/more-details-on-ms-flight-simulator-2024-including-full-3d-landscapes-in-30-biomes),
  [Game Developer](https://www.gamedeveloper.com/game-platforms/head-in-the-cloud-i-flight-simulator-i-s-cutting-edge-tech-today-and-tomorrow)).
  The lesson: data plus inference is right from altitude. **At street level
  its roads and junctions are not drivable-grade.** Lane-level correctness
  needs lane data that imagery inference doesn't give.
- **GeoFS.** A browser flight sim on CesiumJS: world terrain, Sentinel-2
  imagery (Bing for HD), Cesium OSM Buildings
  ([Cesium blog](https://cesium.com/blog/2017/11/16/gefs/)). It shows the
  cheapest way to cover the globe at altitude. Google Photorealistic 3D Tiles
  are closed to new EEA-billed projects (see `research/05` §2.1).
- **Euro Truck Simulator 2 (SCS, about 400 staff in 2025).** Handmade map,
  1:19 between cities, 1:15 in the UK, about 1:3 in cities. Compression makes
  long drives fun; recognisable landmarks matter more than exact distances
  ([racinggames.gg](https://racinggames.gg/article/euro-truck-simulator-2-is-roughly-119-and-thats-why-it-works),
  [Wikipedia](https://en.wikipedia.org/wiki/SCS_Software)). That's wrong for us:
  test prep needs 1:1.
- **Test Drive Unlimited Solar Crown (KT Racing).** Hong Kong Island at 1:1,
  over 600 km of roads, hand-authored with invented landmarks
  ([Pure Xbox](https://purexbox.com/news/2021/07/test_drive_unlimited_3_heads_to_hong_kong_in_september_2022)).
  1:1 handmade is an AAA, multi-year budget.
- **CARLA.** Towns are OpenDRIVE files built in RoadRunner and dressed in
  Unreal. The Digital Twin Tool imports OSM roads and decorates them
  procedurally with buildings and vegetation (experimental). SUMO
  co-simulation runs SUMO traffic and CARLA rendering in lock-step at 0.05 s,
  converts maps with `netconvert_carla.py`, and has known traffic-light
  mismatches (SUMO lights per lane, CARLA per road)
  ([CARLA maps](https://carla.readthedocs.io/en/0.9.15/tuto_content_authoring_maps/),
  [SUMO co-sim](https://carla.readthedocs.io/en/0.9.9/adv_sumo/)). This is
  the same pairing we use: SUMO for the logic network and our own renderer
  for looks.
- **Streets GL.** TypeScript and WebGL2, geometry generated from OSM on the
  fly, Simple 3D Buildings, roads, trees, terrain LOD, deferred PBR, TAA, SSR
  ([GitHub](https://github.com/strandedkitty/streets-gl)). The best open
  reference for "OSM looks good in a browser".
- **OSM2World.** Java, 250+ OSM tags including lane markings, street
  furniture and indoor, PBR materials, glTF output, SRTM terrain
  ([osm2world.org](https://osm2world.org/),
  [SotM 2026 talk](https://2026.stateofthemap.org/sessions/XQUCJM)). Good to
  read for which tags matter and how to draw them.
- **osm2streets (A/B Street).** Rust. Cleans OSM into lanes and junction
  polygons, handling dual carriageways, dog-leg junctions and parallel
  sidewalks ([SotM 2022](https://pretalx.com/sotm2022/talk/9NHQQM/)). It's an
  alternative or check for SUMO's junction shapes.
- **Hop.Earth** (browser, 2026): OSM plus DEM streamed live; "drive any road"
  (`research/05` §2.3).

**What it takes to make roads look and behave right from open data:**

1. **Lane-level topology:** lane count, turn lanes, which lane goes where,
   bus and cycle lanes. Source: OSM `lanes`, `turn:lanes`, `lanes:psv`,
   `cycleway`. Fallback: SUMO type defaults (wrong on Finglas arterials).
2. **Junction control:** roundabouts, mini-roundabouts, signals, give way and
   stop. Source: OSM `junction`, `highway=*` nodes, DCC SCATS sites.
3. **Junction surfaces:** from lane edges (SUMO or osm2streets); paint from
   the national manual.
4. **Elevation:** lidar DTM, smoothed along the road so road cross-fall and
   kerbs look right.
5. **Sight lines:** walls, hedges, parked cars. These decide whether
   observation at a junction is hard, which is the point of practice.
6. **Verification:** someone who drives there checks each test-route junction
   once. A dozen junctions done by hand beat any amount of inference.

---

## 6. Irish data sources

All licences checked via search extracts. Irish government open data is
CC BY 4.0 by default (Circular 12/16). The default attribution is "Contains
Irish Public Sector Data licensed under a Creative Commons Attribution 4.0
International (CC BY 4.0) license"
([OSM wiki: Ireland/Open Data](https://wiki.openstreetmap.org/wiki/Ireland/Open_Data)).

| Data | Source | Licence | Use for us |
|---|---|---|---|
| Road network with lanes, roundabouts, signals, crossings, `maxspeed` | OpenStreetMap (Overpass or Geofabrik Ireland extract) | ODbL (credit "© OpenStreetMap contributors"; share-alike applies to the derived *database*, not the game) | **Primary road source.** Replace Overture for roads, or merge `lanes`/`junction`/`turn:lanes` onto Overture segments. |
| Buildings | OSM (Irish community building project since 2019), via Overture | ODbL | Already in. 20,950 of 21,755 Finglas footprints come from OSM ([OSM wiki: Ireland/Buildings](https://wiki.openstreetmap.org/wiki/Ireland%2FBuildings)). |
| Terrain (DTM) and surface (DSM) | GSI Open Topographic Lidar (GSI, OPW, TII, NYU and others; 2015–2021+), GeoTIFF; 1 m GSI and NYU, 2 m OPW | **CC BY 4.0** | Road and ground elevation (hill start). Building heights as DSM − DTM. **Check the coverage viewer for the Finglas bbox** ([data.gov.ie](https://data.gov.ie/dataset/open-topographic-lidar-data), [viewer](https://opendata-geodata-gov-ie.hub.arcgis.com/datasets/ie-gsi-open-topographic-lidar-data-ireland-itm-download-viewer)). |
| Dublin city-centre lidar (300 pts/m²) | NYU 2015 | CC BY 4.0 | City centre only, not Finglas (`research/05`). |
| Global DEM fallback | Copernicus GLO-30 | Copernicus DEM licence (free, with attribution) | 30 m DSM; only if lidar is missing. |
| Boundaries, townlands, base data | Tailte Éireann (ex-OSi) open data portal and GeoHive | CC BY 4.0 for open sets. The detailed National Map (Prime2) is mostly **not** open. | Place names and boundaries. Not a road source ([Tailte open data](https://tailte.ie/services/open-data/), [Surveying portal](https://data-osi.opendata.arcgis.com/)). |
| Traffic signal and SCATS sites | Dublin City Council | CC BY | Check SUMO's guessed signals, junction by junction ([data.gov.ie](https://data.gov.ie/dataset/traffic-signals-and-scats-sites-locations-dcc)). |
| Traffic volumes (5-min, per approach, SCATS) | DCC, half-yearly releases to Jul–Dec 2025 | CC BY 4.0 | Calibrate NPC traffic density by hour on Finglas arterials ([Jan–Jun 2025](https://data.gov.ie/dataset/dcc-scats-detector-volume-jan-jun-2025)). |
| Speed limits | **DCC: not published as open data** (a data.gov.ie request says it exists only as an internal GIS and PDF map). DLR publishes its own (CC BY). | n/a for DCC | Use OSM `maxspeed` (1,674 Finglas ways tagged, mostly 30 and 50) ([request](https://data.gov.ie/en_GB/dataset/suggest/0f4bce26-f5ef-4cf4-abdc-c6b3c90d99b0)). |
| Sign and marking rules | Department of Transport, *Traffic Signs Manual* (ch. 5 regulatory signs, ch. 7 road markings, Dec 2024) | Government publication; copyright not stated as CC **[unverified]** | Dimensions and layouts to follow. Redraw signs ourselves; don't copy the artwork files without checking. ([gov.ie](https://www.gov.ie/en/department-of-transport/publications/traffic-signs-manual), [trafficsigns.ie](https://trafficsigns.ie/working-drawings)) |
| Street-level sign and marking detections | Mapillary | **CC BY-SA 4.0** (with special permission for OSM) | BY-SA is outside our CC0/CC-BY/MIT asset rule. Use only to *check* OSM, not as shipped data, unless the owner agrees ([OSM wiki](https://wiki.openstreetmap.org/wiki/Mapillary)). |
| Weather | Open-Meteo | CC BY 4.0 | Already planned (ROADMAP 3). |

---

## 7. Team sizes and timelines (where known)

| Product | Team | Time |
|---|---|---|
| City Car Driving | Forward Development, a small single-game studio (Novosibirsk) **[size unknown]** | 2007 first release; 2.0 in early access June 2026 with a third of the map and no school mode yet |
| ETS2 / ATS | SCS Software, about 400 staff (2025) | ETS2 2012, map still expanding |
| BeamNG | 70+ | Since 2011 |
| MSFS 2020/2024 | Asobo plus Blackshark.ai plus Microsoft | About 4 years to 2020 |
| TDU Solar Crown | KT Racing (AAA studio) | Announced 2020, released 2024 |
| Green Dino / Nederlandse Rijsimulator | Small company plus TU Delft research group | Since the early 1990s; about 300 simulators sold |
| Carnetsoft | Small specialist firm **[size unknown]** | About 50-lesson curriculum built over years |
| STISIM | STI, decades of research | 500+ customer organisations |

What this means for us: a two-person team (owner plus Claude) can't
out-content any of these. It can beat all of them on **one thing nobody
sells: the real Finglas test area, marked to the RSA sheet.** Scope should stay
there until it is good.

---

## 8. Ranked: what matters most for "practise for the Irish test in Finglas"

1. **Correct roads around the test centre.** Get OSM lanes, turn lanes,
   roundabouts, mini-roundabouts, give way and stop, and bus lanes into the
   SUMO build (ROADMAP 13, moved to the top). Check the signals against DCC
   SCATS. Then hand-check the 15–20 junctions most used by the test.
   *Today: 0 roundabouts, 1 lane nearly everywhere.*
2. **Examiner coverage of the RSA sheet.** Add roundabouts (lane on approach,
   give way to the right, signal on exit, hesitation), progress and undue
   hesitancy, following distance, mirrors before signal, clearance to parked
   cars and cyclists, position at turns, and speed for conditions. Group
   faults into heading and aspect so the real fail rule applies. Add
   tolerances and hysteresis (the City Car Driving complaints).
3. **The three manoeuvres plus a real hill.** Reverse around a corner,
   turnabout and hill start, each marked by aspect. This needs GSI lidar
   elevation, and automatic creep and hold tuned in the car physics.
4. **Mock test mode.** Start at Jamestown Road, use RSA-style spoken
   directions, keep the examiner silent during the drive, show the RSA grid
   report at the end, pin each fault on the map and allow a replay.
5. **Lesson mode with an instructor.** Spoken cue straight after a fault,
   with a one-line reason. Fade the cues as the learner improves. Exercises
   map to RSA headings (Carnetsoft's part task, then automation, then
   integration).
6. **The road users that cause Finglas faults.** Cyclists on the left,
   parked cars on estate roads, buses pulling out, pedestrians at zebras, and
   traffic density from SCATS by hour. Add scripted hazards for lessons.
7. **Observation you can actually do.** Head checks and mirror glances on
   wheel buttons are already in. Add a wider field of view or triple screens.
   Consider webcam head tracking later, since Carnetsoft tracks gaze.
8. **Irish signs and markings to the Traffic Signs Manual:** yellow box,
   mini-roundabout disc, yield and stop lines, school zones, speed-limit
   change signs.
9. **Weather (rain) and night.** Lights, wipers, stopping distance
   (ROADMAP 3).
10. **Visual polish** (ROADMAP 6–11). It is pleasant, but it moves the test
    score least.

**Honest critique of the current running order:** the "Next: look" block
(items 6–11) sits ahead of instructor mode (12) and real OSM road data (13).
For the stated goal (pass the Finglas test) that order is backwards. Items
13 and 12, then the lidar elevation, should come before most of the look
work. This is the owner's call; I haven't changed `ROADMAP.md`.

---

## Sources

Listed inline. Key ones:
- RSA *Making Your Mark* marking guidelines (PDF): https://www.rsa.ie/docs/default-source/services/s3.2-adi/making-your-mark-marking-guidelines-for-the-driving-test.pdf
- RSA standard test procedures 2025: https://www.rsa.ie/docs/default-source/road-safety/r3-education/driving-test-standard-proceedures-2025.pdf
- Carnetsoft virtual instructor: https://cs-driving-simulator.com/the-virtual-instructor/
- Hirsch & Bellavance 2017: https://doi.org/10.3141/2660-01
- de Winter et al., simulator performance and test results: https://swov.nl/en/publicatie/relationships-between-driving-simulator-performance-and-driving-test-results
- STISIM SDL: https://web.mit.edu/course/16/16.400/www/auto_sim/Help/SDL.htm
- CARLA SUMO co-simulation: https://carla.readthedocs.io/en/0.9.9/adv_sumo/
- GSI open lidar: https://data.gov.ie/dataset/open-topographic-lidar-data
- DCC SCATS volumes: https://data.gov.ie/dataset/dcc-scats-detector-volume-jan-jun-2025
- OSM wiki, Ireland/Open Data: https://wiki.openstreetmap.org/wiki/Ireland/Open_Data
