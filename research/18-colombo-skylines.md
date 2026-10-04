# 18: Colombo: Skylines (team-watchdog/colombo-skylines), a teardown

Date: 2026-10-04. Repo cloned at commit `190388c` (6 Sep 2024, shallow clone,
so earlier history not seen), plus its wiki (`colombo-skylines.wiki.git`) and
the companion repo `team-watchdog/satellite2024` (README and file list only).
Authors: Nimesha Periyapperuma and Yudhanjaya Wijeratne, Watchdog Sri Lanka,
funded through LIRNEasia / GIZ SCOPE.

## What it is

**A Cities: Skylines (2015, Paradox/Colossal Order) save game of the Colombo
Municipal Council area as of 2020**, plus the mod configs and image overlays
needed to load it. It is not a 3D model, not a web viewer and not a pipeline.
There is **no code at all** in the repo: no scripts, no importer, no
generator. Everything was built by hand inside the game editor using mods,
with open data used as traced reference images.

Their aim is a public-facing "crude digital twin" for explaining transport
and planning decisions, chosen because C:S costs $20 against $6–8.6k a year
for CUBE (the transport-planning package Sri Lankan academics use).

### Licence

- README: "Our map (as a savefile, modlist and instructions) is presented
  under the MIT License". No `LICENSE` file in the repo; the text is inline in
  `README.md`. The game, and every mod and workshop asset the save depends on,
  stay under their own terms (README says so).
- `satellite2024`: MIT (`LICENSE`, "Copyright (c) 2024 Watchdog").
- The overlay PNGs are screenshots over a **Mapbox** basemap (the Mapbox and
  OpenStreetMap credit is visible in the corner), so they carry Mapbox's terms,
  not MIT. Not reusable by us.
- They also used **Google Maps and Google Street View** as tracing and style
  reference (README "Visuals", wiki §1 and §6). That is against our rules;
  nothing from that part carries over.

### Files that matter

| Path | What it is |
|---|---|
| `README.md`, wiki `Introduction-and-methodology.md` | The whole method. The wiki is the longer version |
| `localappdata/Cities_Skylines/Saves/Colombo Skylines.crp` (78.9 MB) | The city: Colossal Raw Asset Package, a binary Unity/C:S serialisation. Only the game opens it |
| `localappdata/Cities_Skylines/Maps/colombo v2.crp` (8 MB) | The bare map (terrain, water, roads) before zoning |
| `localappdata/Cities_Skylines/Addons/Assets/lotus-tower.crp` | Their hand-built Lotus Tower (Nelum Kuluna) landmark |
| `steamappdata/BuildingThemes.xml` | Building sets per district, themes "Colombo 1" to "Colombo 15" (Colombo's postal districts) plus "Common" |
| `localappdata/Cities_Skylines/RealisticPopulationConfig.xml` | Floor area per household per building level ("Colombo Low/High Residential" packs) |
| `steamappdata/TMPE_GlobalConfig.xml` | Traffic Manager: President Edition settings (lane change costs, reckless drivers, parking AI) |
| `localappdata/Cities_Skylines/ImageOverlayRenewalConfig.xml` | Where each reference image sits in the world: 2560 px images drawn at 8640 m side, offset (-2300, -400), 11–31 % opacity |
| `Colombo Overlays/*.png` (also in `steamappdata/Files/`) | The reference images: CMC divisions, UDA plan zones, Meta population density, schools, hospitals, transport |
| `localappdata/Cities_Skylines/MoreCityStatistics.csv` | In-game stats log (mode share, vehicle limit use) |
| wiki `Mods-and-assets-list.md` (1,900 lines) | Steam Workshop mods and assets. Assets include "BKK Housing", "Bordeaux Thiers", "SoCal_lowres", "Canadian House": generic foreign buildings |

## How it was made (the method, step by step)

1. **Pick a year and an area.** 2020, CMC boundary (Colombo and
   Thimbirigasyaya divisional secretariats). C:S hard limits shape the whole
   project: 1,048,576 citizens, 49,152 buildings, 65k moving and 65k parked
   vehicles, 256 transit lines, ~299 km² with the 81 Tiles mod.
2. **Roads from OSM, imported by class, one class at a time.** Motorway,
   trunk, primary, secondary, tertiary and link roads, each tested in game
   before the next, because a full import breaks the game's limits. The
   importer isn't named (likely the built-in or a workshop OSM importer;
   **unverified**). Imported geometry was poor (their own screenshot shows the
   Dehiwala road turned into spaghetti), so it served as **markers**:
   **every visible road was then redrawn by hand** over CMC maps and Google
   Maps.
3. **Terrain and water by eye.** Green space, water bodies, canals and the
   shape of the land were sculpted with C:S terrain tools over Sentinel-2 and
   Google Earth imagery. No DEM is mentioned. Colombo is flat and coastal, so
   this was enough for them.
4. **Scale check.** Two measured lengths: 7,728 m vs 7,780 m real, 4,585.6 m
   vs 4,611.2 m. They call it a ">99 % match". It's a scale check on two
   lines, not a positional accuracy measure.
5. **Land use from the plan PDF.** They found the UDA development plan's
   aspirational "character zones" useless ("at no point do these ... resemble
   reality"), dug a land-use map out of the plan PDF, georeferenced it as an
   overlay and painted C:S zones over it on the 8 m × 8 m grid. Category
   mapping was **by behaviour, not label**: government offices became
   commercial (people arrive in the morning, leave in the evening); temples,
   churches and mosques became parks (open to all, raise neighbours'
   happiness).
6. **Density from a population raster.** Meta Data for Good's high-resolution
   population map (30 m, built with CIESIN; this is the HRSL, **licence
   CC BY 4.0 on HDX, unverified here**) rendered as a heat map overlay. Bright
   areas were rezoned high-density.
7. **Fill-in lanes.** C:S only grows buildings beside a road, so they added
   many small lanes ("mawathas") that are not all real.
8. **Hand-placed anchors.** Major schools, hospitals and universities placed
   from CMC maps, because they drive trips.
9. **Districts.** 15 districts from CMC ward maps, used for per-district
   statistics and for per-district building themes.
10. **Population calibration.** 1,048,000 people for 2020 (555,300 resident,
    492,700 commuters), derived from Prof. Amal Kumarage's 2014 figures and
    2035 projections by interpolation; cross-checked with CMC (555,031
    residents, "nearly 500,000" floating). Commuters are housed in tower
    blocks at the edge of the map on **seven entry corridors**, weighted by
    CoMTrans corridor counts (Kandy Rd 24.7 %, Malabe Rd 18.2 %, Negombo Rd
    16.7 %, Galle Rd 14.1 %, High Level Rd 10.0 %, Horana Rd 9.4 %, Low Level
    Rd 6.8 %). Realistic Population 2 sets households from floor area
    (low-density residential: one household per 42.5–55 m² by level).
11. **Transport.** Three rail lines and six bus routes placed from Google Maps
    and routemaster.lk. Vehicle mix (motorcycle, three-wheeler, car, van) set
    from the RDA National Road Master Plan's cordon counts. TM:PE set to
    "Sri Lankan habits": buses may ignore lane arrows, vehicles may enter
    blocked junctions, U-turn at junctions, change lane in junctions, **10 %
    of drivers reckless**, kerbside parking.
12. **Look.** "Burned everything to the ground and started over": thousands of
    workshop assets curated per district after looking at Street View, one
    custom landmark. Their own verdict: "still not very Sri Lankan ... a
    generic European blend". `BuildingThemes.xml` confirms it: only Colombo 2,
    3, 4, 6 and 7 have sets (58–214 buildings each); the other ten districts
    are empty, and the sets are Bangkok, Bordeaux, Southern California and
    Canadian houses.

The companion `satellite2024` repo is their remote-sensing side: Sentinel-2
yearly cloud-free mosaics 2017–2024 made in Sepal.io (Earth Engine) from
three seasons with < 20 % cloud, stitched in QGIS, then a "bluescale"
luminance render to show built-up land, and a pix2pix GAN trained on a
single 2018 government land-use map to classify later years ("not
particularly precise", their words).

## Compared with our pipeline

| Area | Colombo: Skylines | Us (`tools/bake/`, `world.ts`, `facade.ts`, `roadrender.ts`) |
|---|---|---|
| Automation | None. Months of hand work in a game editor | One command, `add_place.py`: Overture fetch → `bake_world.py` → OSM rebuild + SUMO `netconvert` → `bake_net.py` |
| Roads | OSM by class, then redrawn by hand | Overture segments → `overture_to_osm.py` → SUMO lanes, junction rules, signals. Width from a fixed class table (`ROAD_CLASSES` in `bake_world.py`) |
| Buildings | Workshop assets grown by zone | Real footprints extruded; heights tagged → Google 2.5D raster (Lagos) → size-based guess (`guess_height`) |
| Land use | Plan PDF + population raster, by behaviour | Overture `land_use` into 4 area kinds (water, green, pitch, paved) |
| Style | Per-district building sets | Per-place style (`lagos`/`dublin`), per-building hash for colour and roof (`world.ts` ~l.460) |
| Terrain | Sculpted by eye | Flat. Plans: Copernicus GLO-30 for Lagos (research 03), lidar for Finglas (ROADMAP item 7) |
| Traffic demand | Population, jobs, schools and corridor-weighted commuters | Cars spawn on a uniformly random lane in a ring round the player (`trafficnet.ts` `spawnCar`, l.332) |
| Driver behaviour | TM:PE: 10 % reckless, junction blocking, U-turns, kerb parking | One law-abiding IDM driver type |
| Validation | Two measured lengths; population totals against CMC | Bake prints counts and height sources; no accuracy check |

**Where they are better than us:** demand (where traffic and people come
from), local driving behaviour, land use mapped by how people use it, and
style varied by district instead of by city. Also the honesty of their
calibration notes: every number has a source and a stated gap (they get a
1:10 vehicle ratio against a real 1:5 and say so).

**Where we are better:** everything reproducible. Our world is rebuilt from
data by a script; theirs is a binary save that only exists as one person's
hand edits and depends on 1,900 lines of workshop items that can vanish. Our
roads have real lanes and junction rules from SUMO; their roads are traced.
Our buildings sit on real footprints with measured heights where they exist.

## Things to adopt, ranked

Ranked by value to the driving test first, Lagos second. Effort: S = under a
day, M = a few days, L = a week or more.

1. **Weighted traffic demand instead of uniform spawns (S, then M).**
   Colombo's corridor weighting is the cheapest real gain. Step one (S): weight
   `spawnCar` lane choice by road class (arterials busier than cul-de-sacs),
   so estates are quiet and the N2/Finglas Road is busy. Step two (M): weight
   by measured flows. Ireland: TII publishes traffic counter data on national
   roads, and Dublin City Council has SCATS junction counts (**both
   unverified for licence and coverage of Finglas**). Lagos: no open counts
   known; use class weights and the population field from item 2.
2. **A population density field from an open raster (M).** Bake a coarse grid
   (say 50 m) from Meta HRSL or WorldPop (both CC BY 4.0, **verify before
   use**) into the place JSON. Use it to scale pedestrian density in
   `trafficnet.ts`, parked-car density and, for Lagos, as a prior on building
   height where Google 2.5D has no data (dense cells lean taller). For
   Finglas, the CSO Small Area population counts would be an alternative
   (**licence unverified**). Colombo used this exact raster for the same job.
3. **A per-place driver profile (M).** Turn TM:PE's knobs into ours: a share
   of "assertive" drivers (shorter IDM time gap, smaller gap acceptance at
   give-ways, late merges), junction blocking allowed or not, U-turns at
   junctions, kerbside stopping (danfos and kekes stopping anywhere to load).
   Finglas: a small assertive share is realistic and useful practice (someone
   pulling out on you is a test scenario). Lagos: much higher. Colombo's 10 %
   reckless is one data point, not a calibration; ours needs its own numbers.
   Fits ROADMAP item 17.
4. **Style by district, not by city (M).** Colombo's one good visual idea:
   pick the building set per neighbourhood. For us that means a style
   region per area (palette, roof mix, shopfront chance, storey bias),
   taken from Overture `divisions` neighbourhood polygons or OSM
   `admin_level`/`landuse` (**check Overture neighbourhood coverage for
   Finglas and Yaba**). Finglas village, the 1950s–60s council estates and the
   industrial estates look nothing alike; nor do Yaba and Ebute Metta. The
   per-building hash stays for variety inside a region. Style reference: the
   owner's own photos or Mapillary (CC BY-SA, **check terms for use as
   reference only**), never Street View.
5. **Map land use by behaviour (S).** Like their government → commercial and
   temple → park mapping: collapse Overture `land_use` and place categories
   into a handful of behaviour classes (residential, retail frontage,
   workplace, institution, open) that drive pedestrians, parking and
   shopfronts. Today we keep four area kinds that only change the ground
   colour. Pairs with item 4.
6. **Floor area to occupancy (S, part of item 2).** Realistic Population's
   rule (one household per ~45–55 m² of floor area, floors × footprint) gives
   a per-building head count from data we already have. Use it to place
   pedestrians at doors and parked cars on driveways in proportion.
7. **A bake accuracy report (S).** Colombo checked two lengths by hand. We can
   do better automatically: in `add_place.py`, compare baked road lengths
   with OSM, count roads whose width collides with building footprints,
   report height sources (already counted) and footprint coverage against
   Google Open Buildings presence. Catches bad bakes before they reach the
   game.
8. **Don't trust road class for width in Lagos (S–M).** Colombo found Sri
   Lankan road classes say little about real size; ADB said the same. Lagos
   is similar (**our expectation, unverified**). When OSM has `lanes`/`width`,
   use them (planned OSM import, research 15 row 7); otherwise clamp the class
   width to the clearance between building frontages on each side.
9. **Reference overlay in the map view (S–M).** Their workflow lived on
   georeferenced overlays at set opacity. A debug toggle in `map.ts` that
   draws an open raster (ESA WorldCover, Google 2.5D presence, our population
   grid) under our baked roads and footprints would make misalignment and
   gaps obvious. Only CC-BY or CC0 rasters; no Google Maps or Mapbox tiles.

## What not to adopt

- **Cities: Skylines or its files.** The `.crp` save is a proprietary binary
  format that needs the game; nothing in it is extractable data for us.
- **Workshop assets.** Mixed and often unclear licences, foreign styles (the
  authors admit it), and not CC0/CC-BY.
- **Tracing from Google Maps, Google Earth or Street View.** Against our rules
  and Google's terms.
- **The overlay PNGs.** Mapbox basemap screenshots.
- **Hand-redrawing roads.** Doesn't scale and can't be rebuilt. SUMO from OSM
  is the right base; fix data upstream in OSM where it's wrong.
- **Fake fill-in lanes.** They exist only because C:S needs road frontage to
  grow buildings. We have real footprints.
- **Terrain sculpted by eye.** Use GLO-30 (Lagos) and lidar (Finglas) as
  planned.
- **pix2pix land-use classification.** ESA WorldCover (CC BY 4.0, already in
  Overture `land_cover`) and Google Dynamic World (CC BY 4.0, **verify**) do
  the job with published accuracy. A GAN trained on one map is not worth
  building.
- **Agent lifecycle simulation** (ageing, schooling, jobs). Far outside a
  driving school's needs; a density field and time-of-day curves get most of
  the effect.
- **The "99 % match" metric.** Two lengths prove scale, not position.

## Lessons for Lagos (poor official data)

Colombo's data problem is close to Lagos's: plans that describe aspirations,
road classes that don't match the roads, no official building heights. What
worked for them, in our terms:

- Triangulate totals from several weak sources and write down each one
  (they used UN-Habitat, CoMTrans, CMC, HIES and a professor's projections,
  and noted where they disagree: 9,582 to 14,742 people per km²).
- Use satellite-derived global layers for what governments don't publish:
  population (HRSL/WorldPop), heights (Google 2.5D, which we already use),
  land cover (WorldCover).
- Talk to a local transport academic for flows; for Lagos, LAMATA and
  University of Lagos transport research are the likely equivalents
  (**not checked**).
- Map categories by behaviour, and calibrate against a couple of totals you
  trust rather than chasing per-building truth.
