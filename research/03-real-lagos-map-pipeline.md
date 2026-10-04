# 03 — Real Lagos map pipeline (data sources, tooling, licensing)

Goal: a walkable 3D version of real Lagos in the browser that runs on low-end Android phones, and can later grow to all of Nigeria and Africa.

Date of research: 2026-10-04. Every number marked **[measured]** was fetched and computed in this session. The scripts and sample data are in `research/data/` (17 MB). Numbers marked **[web]** come from web search snippets and have not been verified here.

---

## TL;DR

1. **Overpass, Geofabrik and openstreetmap.org are blocked by this sandbox's egress proxy** (403 on CONNECT). That includes `overpass-api.de`, `overpass.kumi.systems`, `overpass.private.coffee`, `overpass.openstreetmap.fr`, `maps.mail.ru`, `api.openstreetmap.org`, `download.geofabrik.de` and `planet.openstreetmap.org`. WebFetch is blocked for the same hosts. Instead, I measured OSM content through **Overture Maps release `2026-09-23.1`** on public S3. Overture's buildings, transportation and base themes are OSM-derived (ODbL), and its building theme is conflated with Google and Microsoft ML footprints. The fetcher is `data/overture_bbox_fetch.py`: plain pyarrow with row-group bbox pruning. A bbox query takes 2–20 s and a metro-Lagos building query 46 s.
2. **Building footprints in Lagos are good.** Metro Lagos (3.05–3.70E, 6.38–6.70N) has **2,497,220 buildings** in Overture: 67.5% from OSM, 29.6% from Google Open Buildings and 2.9% from Microsoft **[measured]**. OSM coverage is excellent in Yaba, Surulere, Mushin, Oshodi and Ajegunle (82–91% of footprints come from OSM). It is weak in **Ikeja (12%)** and **Victoria Island (23%)**, where the ML footprints fill in.
3. **Heights are almost absent from OSM.** Only 0.10% of metro-Lagos buildings have `height` and 0.12% have `building:levels` **[measured]**. The fix is **Google Open Buildings 2.5D Temporal (2023)**, a 0.5 m-pixel raster with a building-height band that covers Lagos. In Yaba it gives a median height of 5.5 m, p90 9 m and max 85 m **[measured]**. Merge rule: OSM tags first, then the Google raster, then a heuristic.
4. **Recommended pipeline (offline bake):**
   - Inputs:
     - Overture/OSM for buildings, roads, water, landuse and places
     - OSM PBF for transit relations and rich road tags
     - Google 2.5D raster for heights
     - Copernicus GLO-30 for terrain (Lagos is nearly flat: metro median 6 m, max 84 m)
   - Processing: build **1 km (or z16) tiles** of merged, low-poly glTF using **meshopt + quantization (gltfpack)**, **KTX2** atlases and a procedural window shader.
   - Delivery: stream the tiles from a CDN into three.js.
   - Measured cost of one dense 1 km² Yaba tile: **2,228 buildings → 25.6k triangles → 92 KB GLB (47 KB gzipped)** with `gltfpack -cc` **[measured]**.
5. **Google Photorealistic 3D Tiles are a bad fit.** They cost $6 per 1,000 root-tile loads after 1,000 free per month **[web]**. The terms forbid caching, offline use and extracting meshes. They are far too heavy for low-end phones, and I could not confirm photogrammetry coverage for Lagos. Keep them at most for a marketing flyover.
6. **Licensing:**
   - The game is an ODbL *Produced Work*. Show "© OpenStreetMap contributors" (plus Overture, Google Open Buildings and Microsoft credits) in the splash screen, credits and map screen. That is enough for a game.
   - If clients can download extractable vector/mesh tiles, treat the processed geodata as a *Derivative Database*. Then publish it, or the recipe to rebuild it, under ODbL.
   - Code and art stay proprietary.
   - Use the ODbL option for Google Open Buildings (dual CC BY 4.0 / ODbL) so everything stays under one license.

---

## 1. OpenStreetMap: what is in Yaba and the rest of Lagos

### 1.1 Access check

| Endpoint | Result |
|---|---|
| `https://overpass-api.de/api/interpreter` | **blocked** (proxy 403 "policy denial") |
| `https://overpass.kumi.systems/api/interpreter` | **blocked** |
| `https://overpass.private.coffee`, `overpass.openstreetmap.fr`, `maps.mail.ru` | **blocked** |
| `download.geofabrik.de`, `planet.openstreetmap.org`, `api.openstreetmap.org` | **blocked** |
| `overturemaps-us-west-2.s3.amazonaws.com` | **open**: used for all OSM-derived measurements |
| `storage.googleapis.com` (Open Buildings + Temporal) | **open** |
| `copernicus-dem-30m.s3.amazonaws.com`, `elevation-tiles-prod.s3.amazonaws.com` | **open** |
| GitHub git (anonymous clone) | open. The GitHub REST API is not open for unattached repos |

To re-run the raw Overpass check on an unrestricted machine, use this (it returns counts only):

```
[out:json][timeout:120];
(
  way["highway"](6.49,3.36,6.53,3.40);
)->.roads; .roads out count;
(way["building"](6.49,3.36,6.53,3.40);relation["building"](6.49,3.36,6.53,3.40);)->.b; .b out count;
way["building"]["height"](6.49,3.36,6.53,3.40); out count;
way["building"]["building:levels"](6.49,3.36,6.53,3.40); out count;
nwr["name"]["amenity"](6.49,3.36,6.53,3.40); out count;
node["natural"="tree"](6.49,3.36,6.53,3.40); out count;
```

The Geofabrik Nigeria extract (`nigeria-latest.osm.pbf`) is **≈677 MB**. That figure comes from a search-engine snapshot of the Geofabrik page with data up to 2026-07-03 **[web]**, because I could not reach the host. Nigeria is large for an African country because of heavy HOT/ML-assisted building mapping.

### 1.2 Yaba bbox (lat 6.49–6.53, lon 3.36–3.40 ≈ 4.4 × 4.4 km ≈ 19.5 km²), Overture 2026-09-23.1 [measured]

These are Overture rows that intersect the bbox. Sample files are `data/yaba_overture_*.parquet`.

**Buildings: 48,512** (48,284 with their centroid inside the bbox)

| Source | Count | with `height` | with `num_floors` (= building:levels) |
|---|---|---|---|
| OpenStreetMap | 39,672 (81.8%) | 14 | 52 |
| Google Open Buildings (fills OSM gaps) | 8,145 | 0 | 0 |
| Microsoft ML Buildings | 695 | 0 | 0 |
| **Total** | **48,512** | **14 (0.03%)** | **52 (0.11%)** |

- Only 64 buildings are named, 49 have a `class` (house, commercial, dormitory, church, mosque, stadium, train_station…), and **0 have roof_shape**.
- Where tagged, heights run p10 6.6 m, p50 18 m, max 40 m. These are the few tagged landmarks, not typical buildings.
- For comparison, **Google Open Buildings v3** alone has **50,884 polygons** in the same bbox. 33,185 of them have confidence ≥ 0.75, the median area is 60 m² and p10/p90 are 15/288 m² (`data/yaba_google_open_buildings_v3.csv.gz`). OSM and Google agree within about 5% on count, so Yaba is close to fully mapped.

**Roads: 3,185 segments, 332.7 km**

| Class | Segments | Named | Length (km) |
|---|---|---|---|
| residential | 1,663 | 792 | 163.3 |
| service | 635 | 7 | 59.5 |
| tertiary | 178 | 132 | 18.3 |
| primary | 137 | 122 | 15.8 |
| unclassified | 134 | 119 | 13.7 |
| secondary | 106 | 72 | 11.6 |
| trunk | 102 | 95 | 12.0 |
| motorway (incl. Third Mainland Bridge) | 70 | 28 | 29.7 |
| path / footway / steps / track | 55 / 49 / 10 / 4 | ~2 | 8.4 |
| rail (standard gauge) | 27 | 7 | – |
| ferry (water) | 10 | 0 | – |

- 3,180 of the 3,185 segments come from OSM and 5 from TomTom.
- Overture reports the surface as unpaved for 2,135, paved for 396, paving stones for 6 and missing for 611. Treat "unpaved" with suspicion: it may be a default inferred by Overture, so check it against raw OSM `surface=*`.
- Overture segments are split differently from OSM ways, so these counts are not OSM way counts.

**Named places: 3,325** (Overture Places come from Meta, Microsoft, AllThePlaces and Foursquare, not OSM; CDLA-Permissive-2.0)

- Every place has a name. 595 have confidence ≥ 0.7 and the mean confidence is 0.51.
- Top categories: fashion/apparel 238, professional services 224, Christian worship 193, religious org 165, real estate 112, beauty 92, restaurants 59, hotels 57, education 61+66.
- High-confidence examples: Cold Stone Creamery Yaba, The Nest Hub, St Augustine Akoka, several TotalEnergies stations.

**Landuse, vegetation, water and infrastructure (OSM-derived Overture base theme)**

- land_use: 119 polygons. Pitch 33, residential 26, school 19, hospital 6, park 6, retail 4, farmland 3, university 2 (UNILAG, YabaTech), etc.
- land (OSM natural): **60 individual trees**, 5 scrub, 4 wetland, 2 forest, 1 wood, sand, islet. That is **almost no tree mapping**, so vegetation has to be procedural.
- land_cover (ESA WorldCover-derived): 44 polygons of shrub, barren, forest, crop, wetland, urban and grass.
- water: 170 features. 143 canal and 10 drain lines (the Lagos open-drain network), 7 streams, 4 swimming pools and the **Lagos Lagoon** polygon.
- infrastructure: 341 features. 131 gates, 84 bridge structures (31 named), 19 crossings, 18 parking, 14 power towers, 11 bus stops, 10 traffic signals, 7 platforms, 4 stop positions.

### 1.3 Building coverage by neighbourhood [measured]

Each cell is about 2 × 2 km (±0.009°, 3.96 km²), counting buildings by centroid. "OSM share" is the share of Overture's conflated buildings that come from OSM. A high Google/Microsoft count means OSM is missing buildings there. Built cover is the footprint area divided by the cell area. Data: `data/lagos_neighborhood_building_coverage.json`.

| Neighbourhood (cell centre) | OSM | Google | Microsoft | Total | **OSM share** | height / levels tags | Built cover |
|---|---|---|---|---|---|---|---|
| Yaba (6.510, 3.378) | 7,168 | 1,183 | 183 | 8,534 | **84%** | 1 / 1 | 30.2% |
| Surulere (6.497, 3.352) | 9,843 | 1,691 | 102 | 11,636 | **85%** | 0 / 0 | 37.9% |
| Ikeja – Allen / Computer Village (6.600, 3.348) | 939 | 6,914 | 142 | 7,995 | **12%** | 14 / 46 | 35.6% |
| Lekki Phase 1 (6.447, 3.470) | 3,933 | 1,579 | 136 | 5,648 | **70%** | 125 / 3 | 25.8% |
| Victoria Island (6.428, 3.420) | 980 | 2,957 | 364 | 4,301 | **23%** | 236 / 6 | 23.1% |
| Oshodi (6.553, 3.340) | 7,822 | 1,567 | 125 | 9,514 | **82%** | 0 / 11 | 37.4% |
| Mushin (6.528, 3.350) | 10,074 | 1,530 | 158 | 11,762 | **86%** | 0 / 0 | 42.0% |
| Ajegunle (6.455, 3.335) | 11,668 | 1,009 | 157 | 12,834 | **91%** | 0 / 0 | 42.6% |
| Ikorodu town (6.615, 3.505) | 4,459 | 4,842 | 228 | 9,529 | **47%** | 0 / 4 | 32.9% |
| Eko Atlantic (6.410, 3.405) | 45 | 198 | 40 | 283 | 16% | 7 / 18 | 1.9% (mostly sand/sea) |

What the table shows:
- The dense mainland neighbourhoods (Yaba, Surulere, Mushin, Oshodi, Ajegunle) are thoroughly traced in OSM, probably from HOT/ML-assisted imports. Footprints there are fine for a game.
- **Ikeja and VI are mostly ML footprints.** These are often merged blobs over dense blocks with no tags. VI, however, has the most height tags (236), which are the towers.
- **Eko Atlantic is mostly empty in every dataset.** It is still under construction, so expect hand-modelling.
- Height tags exist only for about 0.1% of buildings. They cluster in VI and Lekki (towers such as Civic Towers 90 m, Union Bank Building 124 m, 4 Bourdillon 110 m).

### 1.4 Metro Lagos totals (3.05–3.70E, 6.38–6.70N, which includes some of Ogun State) [measured]

- Buildings: **2,497,220**. OSM 1,685,656, Google 738,199, Microsoft 73,365. Height tags 2,577, levels 2,967.
- Road segments: **174,164**. Residential 132,163, service 16,691, tertiary 7,204, unclassified 5,364, secondary 5,208, primary 2,501, trunk 1,735, motorway 680.
- Rail: 86 segments, including the **Lagos–Ibadan SGR** and the **LRMT Blue Line** (tagged subway). **Ferry routes: 102 segments.** All saved in `data/lagos_overture_ferry_and_rail_segments.parquet`.
- Infrastructure: 13,900 features. 6,206 gates, 2,313 walls, 1,322 power towers, 1,157 bridges (460 named), 132 ferry terminals, 164 traffic signals, 141 bus stops, 41 bus stations.
- Places: **61,268** (13,626 with confidence ≥ 0.7). Trees: only **381** mapped trees in the whole metro area.
- Named-feature gazetteer (11,002 rows: buildings, landuse, infrastructure and places with confidence ≥ 0.8): `data/lagos_named_features.csv`.

---

## 2. Other datasets

| Dataset | What you get for Lagos | Measured / notes | License |
|---|---|---|---|
| **Overture Maps** (S3 `overturemaps-us-west-2/release/2026-09-23.1`, GeoParquet) | Conflated buildings (OSM, Google and Microsoft) with GERS stable IDs. Transportation segments and connectors (routable graph), places, base (land_use, land_cover, water, infrastructure, land) and addresses | All figures in §1 come from here. Bbox fetch time: 2–20 s for Yaba, 46 s for 2.5 M metro buildings. **It has no transit routes or relations** except road `routes` (A5, F266, Trans-African Hwy). DuckDB extensions are blocked here, so I used pyarrow (`data/overture_bbox_fetch.py`) | Buildings, transportation, base and divisions: **ODbL**. Places: **CDLA-Permissive-2.0**. Credit "© OpenStreetMap contributors, Overture Maps Foundation" plus Google and Microsoft where used |
| **Google Open Buildings v3** (gs://open-buildings-data/v3) | Footprints, confidence ≥ 0.65, area, plus code. No heights | Lagos sits in the S2 L6 tile `103b_buildings.csv.gz` (567 MB gz, 5,810,224 buildings). The parent L4 tile `103` is 2.03 GB. Streaming the L6 tile took **31 s**. The part of the metro bbox inside it holds **2,818,315** buildings (conf ≥ 0.9: 1.16 M). Yaba: 50,884 | **CC BY 4.0 or ODbL v1.0** (your choice). Pick ODbL to mix with OSM |
| **Google Open Buildings 2.5D Temporal v1** (gs://open-buildings-temporal-data/v1, also on Earth Engine) | Yearly 2016–2023 rasters at 0.5 m pixels (≈4 m effective, from Sentinel-2). Bands: `building_fractional_count`, `building_height`, `building_presence`. UTM 31N tiles of 25,000 × 25,000 px as COGs, readable with HTTP range requests | Yaba 2023, read in 25 s without downloading the whole tile: built-pixel fraction 30.7%. Heights: p10 4.0, p25 4.5, **p50 5.5**, p75 7.0, p90 9.0, p99 19, **max 85 m**. Histogram 3–6 m: 7.66 M px, 6–9 m: 5.62 M, 9–12 m: 0.94 M, >20 m: 0.13 M. Sample: `data/yaba_google_temporal_2023_1km.tif` (uint8-packed) | **CC BY 4.0 and ODbL** **[web]**. Attribute Google and Copernicus Sentinel-2 |
| **Microsoft Global ML Building Footprints** | Footprints for Nigeria (search reports 50.5 M for Nigeria and Kenya combined **[web]**). Height is −1 or absent in this region. Inside Overture they appear only where OSM and Google have nothing (73 k in metro Lagos) | Not downloaded directly (minedbuildings host blocked); seen via Overture | ODbL |
| **OpenMapTiles / Protomaps basemap** | Vector tiles with `building` render_height/min_height (from OSM tags, else defaults), roads, water, landuse and POIs. Protomaps publishes a daily planet `.pmtiles`, and `pmtiles extract --bbox` gives a Lagos file of a few tens of MB | Hosts blocked here. Good for the client-side extrusion alternative (§3B) | ODbL data. OpenMapTiles schema is CC BY; Protomaps code is BSD |
| **MapLibre GL JS fill-extrusion** (Mapbox GL equivalent) | Instant 2.5D extruded buildings from vector tiles | Good for a prototype or minimap, not for a walkable game (no physics, poor camera control at street level) | MapLibre BSD. Avoid Mapbox SDK v2+ (proprietary, metered) |
| **Google Photorealistic 3D Tiles** (Map Tiles API, Cesium ion, 3DTilesRendererJS) | Textured photogrammetry mesh in 2,500+ cities and 49 countries **[web]**. **Lagos photogrammetry is not confirmed.** Outside covered cities you get globe terrain with satellite drape | Cost: 1,000 root-tile requests per month free, then $6.00 per 1,000 (tiers down to $2.40) **[web]**; roughly one root request per app launch. Terms (Google Maps Platform): no caching or prefetch beyond what the terms allow, no offline use, no extracting or modifying meshes, mandatory Google logo and data attributions. Bandwidth: tens to hundreds of MB per session, with large textures. **Not viable on low-end Android or for game collision** | Proprietary (GMP ToS) |
| **Esri World Imagery** | Very high-resolution imagery | ArcGIS ToS: no bulk baking into game textures without a licence. Use only as a mapping reference (OSM's editor licence allows tracing) | Proprietary |
| **Sentinel-2** (Copernicus) / **EOX s2cloudless** | 10 m imagery, NDVI for tree placement, ground-colour texture | Free. s2cloudless 2016 is CC BY 4.0; later years are CC BY-NC-SA (not for commercial use) | Copernicus free licence with attribution |
| **ESA WorldCover 10 m** | Tree, grass, built, water and wetland classes. Overture land_cover is derived from it | Best driver for procedural trees | CC BY 4.0 |
| **Copernicus GLO-30 DEM** (S3 `copernicus-dem-30m`) | 30 m DSM. Tile `N06_00_E003_00` is a 28.3 MB COG | Metro Lagos elevation min 0, p5 0, **median 6.3 m**, p95 48.5, max 83.7. Yaba median 6.8, max 29.6. Ikeja median 36.5. **It is a DSM**: buildings and trees add bumps, so smooth it or clamp under footprints. Sample: `data/lagos_copernicus_glo30_dsm.tif` (int16 dm) | Copernicus DEM licence (free, attribution "© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the EU and ESA") |
| **SRTM / AWS Terrain Tiles (Terrarium PNG)** | Ready-made web-mercator height PNGs | Fetched `terrarium/12/2086/1973.png` (Yaba): HTTP 200, **31 KB** (`data/terrarium_z12_yaba.png`). Drop-in for three.js terrain | Mixed public sources; attribution list on the AWS registry |
| **FABDEM** (forest- and building-removed DEM) | Bare-earth version of Copernicus | Better for a city, but **CC BY-NC-SA**, so not for a commercial game | NC |

Terrain takeaway: Lagos is a flat coastal city (most of it is 0–10 m, Ikeja and the north rise to 30–50 m). A single low-resolution heightfield per tile, or even a flat plane with water at 0 m plus gentle Ikeja slopes, is enough. Don't spend budget on terrain LOD.

---

## 3. Tooling: map data to game-ready low-poly 3D

### 3.1 Tools reviewed

| Tool | What it is | Fit for this project |
|---|---|---|
| **Streets GL** (github.com/StrandedKitty/streets-gl, **cloned and inspected**) | MIT TypeScript WebGL2 renderer for OSM. Last commit 2025-08-21. Builds geometry on the fly in workers from vector tiles at **zoom 16 (TileSize 611.5 m)**; `WorkersCount = min(4, cores)`, `MaxConcurrentTiles 150`. Data comes from a modified Planetiler plus the Esri Terrain3D tileset. Implements Simple 3D Buildings roofs and default level height 4 m (`Tile3DExtrudedGeometryBuilder.ts`) | **Excellent reference code** for footprint cleaning (`VectorBuildingOutlinesCleaner`), roof builders, road and area handlers, and its tile grid. **Not usable as-is on low-end phones**: its README says a "modern discrete GPU" is recommended (deferred PBR, TAA, SSAO, SSR). Borrow the geometry builders and drop the renderer |
| **OSM2World** (Java, LGPL) | Converts OSM to OBJ or glTF tiles, with S3DB roofs, street furniture, trees and road markings. Batch tile generation is possible | Good offline generator for richer street furniture. Java toolchain. The art style is "GIS-ish" and needs restyling |
| **Blender-OSM (blosm, premium/free)** / **BlenderGIS** | Imports OSM, terrain and imagery into Blender. blosm can also import Google 3D Cities, but that runs into Google's licence | Best for **hand-polished hero districts and landmarks** (Lagos Island/Marina, National Theatre, Third Mainland Bridge approach). Export to glTF |
| **OSMBuildings** (JS) | Lightweight 2.5D building viewer over GeoJSON or tiles | Quick prototype. Limited for a game |
| **three-geo** (w3reality) | three.js terrain plus satellite drape from Mapbox tiles | Needs a Mapbox token. Terrain is not important for Lagos. Low value |
| **Planetiler** (Java) / **tippecanoe** / **Martin** | Build MVT/PMTiles from PBF or GeoParquet | Planetiler is the fastest way to tile all of Nigeria or Africa. Use it in the "client-side extrusion" alternative or as an intermediate step |
| **3d-tiles-tools / CesiumJS / 3DTilesRendererJS** | OGC 3D Tiles streaming with LOD built in | A good *format* option if we want HLOD streaming. 3DTilesRendererJS works with three.js |
| **gltfpack / meshoptimizer** (tested via npm) | Simplify, quantize, meshopt-compress, KTX2 | **Use it.** Measured numbers are in §3.3 |
| **Draco** | Geometry compression | Smaller raw output than meshopt, but slower WASM decode. meshopt plus gzip/brotli is about as small and decodes much faster on weak CPUs. Prefer meshopt |
| **KTX2 / Basis (toktx, gltfpack -tc)** | GPU-compressed textures (ETC1S/UASTC) | Use ETC1S for the facade/road/ground atlases (smallest; transcodes to ETC2/ASTC on Android). Use UASTC only for hero assets |
| **CityEngine** (Esri, commercial) | Rule-based procedural cities from footprints | Great facades, but a paid licence and a non-web pipeline. A custom procedural shader gets 80% of the look for free |
| **Unity/Unreal** (Cesium for Unity/Unreal, ArcGIS Maps SDK; Mapbox Unity SDK is deprecated) | Engine-native streaming | Unity WebGL and Unreal Pixel Streaming are too heavy for low-end Android browsers. Not recommended |

### 3.2 How the existing Lagos browser game (gta.koha.wtf, "Surviving Nigeria") does it [inspected]

- Title: "Surviving Nigeria: multiplayer Lagos in your browser". Built with three.js (a 658 KB three chunk and a 1.03 MB main bundle). Uses PostHog and GA analytics.
- **OSM credit:** the text "Street layout © OpenStreetMap contributors" appears on the **main menu footer** and again on the in-game **map overlay** ("Street layout © OpenStreetMap contributors · M to close"). That matches the OSMF game guideline (credits, menu or map view).
- **World data:** a single `assets/world-*.bin`. It is **418,537 bytes gzipped (715,761 raw)** in a custom `EKO1` binary with quantized int16 coordinates, holding roads, colliders, props, viaducts, map, bus stops, police, fuel, hospitals and stalls.
- Buildings appear to be procedural "streetfronts" (`streetfronts-*.webp` atlas) rather than real footprints. Landmarks are hand-modelled GLBs (`gani-fawehinmi-park`, `peace-park`), vehicles are `danfo-v3.glb`, `keke.glb` and `okada.glb`, and characters are Microsoft **Rocketbox** avatars (MIT).
- Lesson: they cover only a curated slice of the city. One tiny binary loads fast on a phone, but it doesn't scale to the whole city. We want the same compactness, but tiled.

### 3.3 Mesh budget test: one dense 1 km² tile in Yaba [measured]

Setup:
- Cell: 3.3730–3.3820E, 6.5050–6.5140N (Tejuosho / Yaba market area), about 1 × 1 km.
- Buildings: 2,228 (OSM 1,919, Google 271, Microsoft 38).
- Height rule: OSM `height`, else `num_floors × 3.2 m`, else the median Google 2.5D height within ±4 m of the centroid, else 3.5 m (the fallback applied to 318 buildings). Resulting median 4.5 m, p90 7.0 m.
- Geometry: extruded flat-shaded walls plus earcut roofs, simplified to about 0.4 m. Script: `data/extrude_budget_prototype.py`. Result: `data/yaba_1km_extrusion_budget.json`.

| Encoding | Bytes | gzip -9 |
|---|---|---|
| Raw float32 positions + uint32 indices (50,050 verts, **25,574 tris**) | 907 KB | 254 KB |
| int16 positions (10 cm quantization) + uint16 indices | 454 KB | 221 KB |
| glTF via gltfpack, no quantization (`-noq`) | 394 KB | 190 KB |
| gltfpack `-c` (meshopt) `-noq` | 164 KB | 89 KB |
| **gltfpack `-cc` + quantization (default)** | **92 KB** | **47 KB** |

These figures are positions and indices only. Normals, UVs and vertex colours will roughly double them, so plan on **about 100–200 KB per dense km²** for building geometry.

Extrapolation:
- The roughly 1,000 km² of built-up Lagos comes to **about 100–200 MB of building tiles in total**.
- A player streams a 3 × 3 km ring, so about **1–2 MB** is in flight at any time. That works on 3G/4G.
- A dense km² is about 26k triangles, and a 3 × 3 ring at LOD0 is about 230k triangles. That is too many for a low-end phone, so use **LOD0 only within about 400 m** and box or impostor LODs beyond.

### 3.4 Recommended pipeline

```
           ┌───────────────── OFFLINE (CI, Python + Node, per region) ───────────────────┐
Overture GeoParquet (bbox) ─┐                                                            
  buildings/transport/base  │   1. normalise to UTM 31N (Nigeria spans 31N–33N; use a    
OSM PBF (Geofabrik Nigeria) ├─►    local ENU per tile in the long run)                   
  route relations, tags     │   2. heights: OSM height > levels×3.2 > Google 2.5D median 
Google 2.5D Temporal COG ───┤      > class/area heuristic (towers in VI/Lekki/Ikoyi hand-fixed)
Copernicus GLO-30 / ESA WC ─┤   3. clean footprints (merge slivers, drop <8 m², snap), 
Landmark GLBs (hand-made) ──┘      road graph → ribbons + junction polygons, water, ground
                                4. bake tiles: 1 km grid (or z16 = 611 m like Streets GL)
                                   LOD0 full footprints+roofs, LOD1 simplified boxes merged,
                                   LOD2 skyline impostor / merged block hulls
                                5. gltfpack -cc -tc (meshopt + quantize + KTX2 ETC1S atlases)
                                6. gameplay layer per tile: road graph/navmesh, colliders,
                                   spawn points, POIs, bus stops → compact binary (like EKO1)
                                7. publish /tiles/{lod}/{x}/{y}.glb + manifest.json to CDN,
                                   plus the ODbL derived dataset + build recipe (share-alike)
           └──────────────────────────────────────────────────────────────────────────────┘
           ┌───────────────────────── RUNTIME (three.js, WebGL2 → WebGL1 fallback) ───────┐
           tile ring around player (LOD0 r≈400 m, LOD1 r≈1.2 km, LOD2 to fog), worker-side
           meshopt decode, 1 draw call per tile per material, InstancedMesh for trees,
           street lights, poles, danfos, kekes, okadas; procedural window shader (no textures
           per building: floor height + window grid from UV, vertex-colour variation,
           baked AO in vertex colour, no realtime shadows on low tier); fog hides pop-in;
           dynamic resolution; budget ≈100–150k tris, <100 draws, <64 MB textures on low tier.
           └──────────────────────────────────────────────────────────────────────────────┘
```

Low-end Android targets (Adreno 610 / Mali-G52 class, 3–4 GB RAM, Chrome):
- WebGL2 with ETC2-transcoded KTX2 textures and a 1–2k atlas.
- Avoid post-processing.
- Use an index-buffered merged mesh per tile and per material.
- Cap devicePixelRatio at 1–1.5.
- Keep the JS heap under 200 MB.
- Run tile decode and gameplay binary parsing in a Web Worker.

Scaling to Nigeria and Africa:
- The same job can run per S2 cell or per z10 tile in parallel. Overture and Google data are already partitioned, and Planetiler handles continent-scale PBFs.
- Lagos-scale density is worst-case. Most of Africa is sparse, so storage grows far more slowly than area.

### 3.5 Alternatives

- **A. Pre-baked glTF tiles (recommended above).** Gives the best runtime performance and art control. Needs a bake pipeline and CDN storage of about 100–200 MB per megacity.
- **B. Client-side extrusion from vector tiles (Streets GL or OSMBuildings style).** Ship MVT/PMTiles (a Protomaps extract of a few tens of MB for Lagos) and build meshes in workers. Downloads are tiny and one pipeline covers the whole planet. It costs CPU on weak phones and gives less control. **This is a good "phase 0" prototype and the long-tail approach for the rest of Africa**, with pre-baked tiles reserved for hero cities.
- **C. Hybrid (likely final).** Pre-baked hero districts (Yaba, Lagos Island/Marina, VI/Ikoyi, Lekki, Ikeja, Oshodi) plus client-side extrusion everywhere else.
- **D. Google Photorealistic 3D Tiles.** Not recommended (cost, terms, weight, coverage unconfirmed). See §2.
- **E. Fully procedural (koha style).** Real road graph with procedural street-fronts and no real footprints. Smallest and fastest, but "real Lagos" only at the street-layout level.

---

## 4. Transit and landmarks

### 4.1 Transit data

- **GTFS:** I found no official LAMATA GTFS feed. DigitalTransport4Africa's open GTFS collection (gitlab.com/digitaltransport/data) lists Abidjan, Accra, Addis, Cairo, Douala, Freetown, Harare, Kampala, Kumasi, Bamako and Nairobi, **not Lagos** **[web]**. Re-check git.digitaltransport4africa.org before ruling it out.
- **Community danfo data** (licences unverified, check before use):
  - `Soigwe/danforoute` covers danfo, BRT, LRMT Blue/Red and LASWA ferries.
  - `OGRoute/Danfo-AI` has a 2026 route DB of 108 routes, 85 stops and 77 danfo routes **[web]**.
  - `King-juicy999/LagosFare` is a fare and route helper.
  - WhereIsMyTransport mapped Lagos formal and informal transit around 2019, but under a commercial licence.
- **OSM (via PBF, since Overture drops relations):**
  - Measured: LRMT Blue Line track (4 segments), Lagos–Ibadan SGR, **102 ferry route segments**, **132 ferry terminals** (e.g. Marina/CMS, Five Cowries/Falomo, Tin Can Island), 141 bus stops and 41 bus stations (Obalende Motor Park, Mile 12 Terminal, Tafawa Balewa Square Bus Terminal, Oshodi Transport Interchange T1–T3).
  - Use `osmium tags-filter nigeria-latest.osm.pbf r/route=bus,ferry,subway,light_rail,train` to get BRT, bus and ferry route relations with stop order.
- **Rail facts [web]:**
  - Blue Line phase 1 (Marina – National Theatre – Iganmu – Suru Alaba – Mile 2) is 13 km, opened in Sept 2023, and carried about 15k riders per day in 2026.
  - Red Line (Agbado – Oyingbo) is 27 km with 8 stations, in service since Oct 2024.
  - A Purple Line is being planned.
  - BRT: Mile 12–CMS (BRT Lite) and its Ikorodu extension, plus Oshodi–Abule Egba.
- **Game plan:** author a small JSON route file (GTFS-like: routes, ordered stop IDs and shape snapped to our road graph) for about 20 iconic danfo routes (Oshodi–Yaba, Ojuelegba–CMS, Obalende–Ajah…), the BRT corridors, the Blue and Red Lines, and 3–4 LASWA ferry lines. Seed it from OSM relations and refine by hand.

### 4.2 Landmarks: located in the data [measured]

Coordinates come from Overture / OSM (`data/lagos_named_features.csv`).

| Landmark | Found as | lat, lon | 3D source |
|---|---|---|---|
| Third Mainland Bridge | OSM bridge + motorway | 6.5036, 3.3978 (one of many segments) | Procedural from OSM `bridge=yes` + `layer` (deck, piers every ~40 m). No free 3D model found |
| Carter Bridge / Eko Bridge | OSM bridge | 6.4665, 3.3852 / 6.4710, 3.3749 | Procedural |
| Lekki–Ikoyi Link Bridge + Toll | Place / building | 6.4501, 3.4551 / 6.4484, 3.4595 | Hand-model the cable-stayed pylon |
| Lekki Toll Gate | Place | 6.4358, 3.4470 | Hand-model (simple canopy) |
| National (Arts) Theatre | OSM building + Blue Line station | 6.4765, 3.3695 | **Sketchfab**: "National Theatre, Lagos" by CCOGISO (digital-twin scan) and "Nigeria National Theatre" by ohmeighzah. **Check each licence**, or remodel low-poly (the shape is a simple military-cap disc) |
| CMS / Marina | Ferry terminal | 6.4492, 3.3898 | Procedural plus a CMS cathedral (Cathedral Church of Christ, OSM building, 6.4509, 3.3902) |
| Balogun Market | No single feature (area). Teslim Balogun Stadium found at 6.4997, 3.3608 | – | Procedural stalls with instanced umbrellas |
| Computer Village | OSM landuse=retail | 6.5943, 3.3404 | Procedural |
| Kalakuta Republic Museum | Place | 6.6029, 3.3486 (Ikeja) | Hand-model |
| New Afrika Shrine | Place | 6.6230, 3.3567 | Hand-model |
| Quilox | Place (dance club) | 6.4381, 3.4381 | Generic VI building |
| Eko Atlantic | Place + sparse buildings | 6.4215, 3.4253 | Mostly hand-built skyline (data nearly empty) |
| Tafawa Balewa Square | landuse + bus terminal | 6.4471, 3.4011 | Procedural plaza + horse/eagle statues hand-made |
| Lagos National Stadium (Surulere) | landuse=stadium | 6.4971, 3.3650 | Hand-model (bowl) |
| Oshodi Transport Interchange T1–T3 | OSM buildings | 6.5549, 3.3512 | Hand-model or extrude |
| Tejuosho Market, Yaba Market, Ladipo, Idumota, Mile 12, Obalende, Falomo, Tinubu Square, Freedom Park, Lagos City Hall (20 m), Union Bank Building (124 m), Civic Towers (90 m), Civic Centre, Eko Hotel (15 m), Ikeja City Mall, Murtala Muhammed Airport, Lekki Conservation Centre, Unilag | All present | see CSV | Mostly extrude; hero-model 5–10 |
| "Shitta" | Only as a place name (Shitta amala, Surulere area) | ~6.5007, 3.3567 | Area/bus-stop, not a building |

Other free 3D assets:
- Danfo bus models on Sketchfab: "Lagos state Commercial Bus" by kesterTolu and "Lagos Danfo Bus" by Iam_thearchitect, both CC BY **[web]**. There is also "VW Danfo Lowpoly" by naves, licence to be checked.
- Microsoft Rocketbox avatars (MIT) work for pedestrians, as koha uses.
- sketchfab.com is blocked here, so verify each licence (CC BY, CC0, or "Standard"/NC) on the page before use. Keep an asset attribution file.

---

## 5. Licensing

| Data | Licence | What the game must do |
|---|---|---|
| OpenStreetMap (direct, or via Overture buildings, transportation and base) | **ODbL 1.0** | The rendered game is a **Produced Work**. Display "© OpenStreetMap contributors" with a link to openstreetmap.org/copyright where players will see it. The OSMF Attribution Guidelines allow a splash screen, the credits, the menu, the in-game map or "another suitable location" for games. **Share-alike** applies to any *Derivative Database* you make public: if players can download the processed vector or mesh tiles and the data is extractable, publish the derived geodata (or the full recipe and inputs to regenerate it) under ODbL. Game code, art, textures and landmark models are separate works and are not forced open (ODbL 4.5 collective database/works). Extracts under 100 features, or qualitative non-systematic picks, count as "insubstantial" per OSMF guidance |
| Google Open Buildings v3 and 2.5D Temporal | **CC BY 4.0 or ODbL v1.0** (dual) | Choose ODbL so the merged database stays under one licence. Credit "Google Open Buildings" (and Copernicus Sentinel-2 for Temporal) |
| Microsoft Global ML Building Footprints | ODbL | Credit Microsoft |
| Overture Maps | Buildings, transportation, base and divisions: ODbL. Places: CDLA-Permissive-2.0 | Overture asks for (but doesn't require) "© Overture Maps Foundation". The underlying sources' attributions are required: "© OpenStreetMap contributors, Overture Maps Foundation" + Google + Microsoft + Esri Community Maps where present |
| Copernicus GLO-30 DEM | Free Copernicus licence | Credit DLR/Airbus/Copernicus |
| ESA WorldCover | CC BY 4.0 | Credit ESA WorldCover |
| Sentinel-2 / s2cloudless | Copernicus free / s2cloudless 2016 CC BY; later years NC | Avoid NC years for a commercial game |
| Google Photorealistic 3D Tiles, Esri imagery | Proprietary | No baking or caching into game assets |
| Sketchfab models | Per model | Track each one. CC BY needs credit; NC rules out commercial use |

Suggested in-game credit line:
`Map data © OpenStreetMap contributors (ODbL) · Overture Maps Foundation · Google Open Buildings · Microsoft Building Footprints · Copernicus DEM/Sentinel-2 · ESA WorldCover`
Show it in the main menu footer and the map screen, the same way gta.koha.wtf does, with a credits page that lists everything.

---

## 6. Next steps

1. From an unrestricted machine, run the Overpass count query (§1.1) and `osmium` on the Nigeria PBF. This confirms raw-OSM POI counts, tree counts and transit relations, which Overture doesn't carry.
2. Extend `data/extrude_budget_prototype.py` into the real baker. Add normals, UVs and vertex colours, roads as ribbons, the LOD1 box merge, and `gltfpack -cc -tc` output. Then load 3 × 3 tiles in a three.js test page and profile it on a low-end Android device.
3. Build the height model. Calibrate the Google 2.5D heights against the 2,577 OSM-tagged buildings, and hand-fix the 30 tallest VI, Ikoyi and Lekki towers.
4. Assemble the transit JSON (BRT, Blue/Red Line, ferries and about 20 danfo routes) from OSM relations plus community repos once their licences are verified.
5. Pick 10 hero landmarks and commission or remodel low-poly GLBs (Third Mainland approach, National Theatre, Lekki–Ikoyi bridge, Tafawa Balewa Square, National Stadium, Oshodi interchange, CMS cathedral, Eko Atlantic skyline, Lekki toll gate, Kalakuta Museum).

## Appendix: files in `research/data/`

| File | Content |
|---|---|
| `overture_bbox_fetch.py` | pyarrow-only Overture bbox extractor (row-group pruning; works without DuckDB extensions). Usage: `python3 overture_bbox_fetch.py buildings building 3.36,6.49,3.40,6.53 out.parquet` with `AWS_CA_BUNDLE` set |
| `yaba_overture_{buildings,segment,connector,place,land_use,land_cover,land,water,infrastructure}.parquet` | Overture 2026-09-23.1 for the Yaba bbox |
| `yaba_google_open_buildings_v3.csv.gz` | 50,884 Google v3 footprints (WKT) for the Yaba bbox |
| `yaba_google_temporal_2023_1km.tif` | 2.5D Temporal 2023 for the 1 km test cell. Band 1 = height × 2 (0.5 m units, 255 = nodata), band 2 = presence % |
| `lagos_copernicus_glo30_dsm.tif` | Copernicus GLO-30 DSM for metro Lagos (int16 decimetres) |
| `terrarium_z12_yaba.png` | AWS Terrain Tiles Terrarium z12 tile over Yaba |
| `lagos_neighborhood_building_coverage.json` | §1.3 table data |
| `lagos_overture_ferry_and_rail_segments.parquet` | 102 ferry + 86 rail segments, metro Lagos |
| `lagos_named_features.csv` | 11,002 named features (buildings, landuse, infrastructure, places conf ≥ 0.8) |
| `extrude_budget_prototype.py`, `yaba_1km_extrusion_budget.json` | §3.3 mesh budget test |

Sources (web): Geofabrik Nigeria page (download.geofabrik.de/africa/nigeria.html); Overture attribution docs (docs.overturemaps.org/attribution); Google Open Buildings Temporal (sites.research.google/gr/open-buildings/temporal, Earth Engine catalog GOOGLE/Research/open-buildings-temporal/v1); Map Tiles API billing (developers.google.com/maps/documentation/tile/usage-and-billing); Cesium community thread "Google 3D Tiles Cost"; OSMF Attribution Guidelines (osmfoundation.org/wiki/Attribution) and Licence/Community Guidelines; Microsoft GlobalMLBuildingFootprints (github.com/microsoft/globalmlbuildingfootprints); DigitalTransport4Africa (digitaltransport4africa.org); brtdata.org Lagos; Wikipedia Blue Line / Red Line (Lagos); allafrica.com Blue Line ridership 2026; Sketchfab model pages listed above; github.com/StrandedKitty/streets-gl (cloned); gta.koha.wtf (page and bundle inspected).
