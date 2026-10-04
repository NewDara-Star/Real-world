# 19: Cities that publish their own 3D model, and how to import them

Date: 2026-10-04. Goal: find places whose government already publishes a 3D
city model or digital twin we can download, so a new place starts from real
buildings, roofs, terrain and sometimes roads instead of Overture footprints
with guessed heights. This extends `17-boundless-nyc-and-digital-twins.md` §9
(rows there are referenced, not repeated) and `16-tokyo-teardown.md` (how the
jeantimex Tokyo project reads PLATEAU).

**How much of this is verified.** This sandbox's proxy blocks almost every
government portal (mlit.go.jp, geospatial.jp, the Tokyo digital twin site,
opengeodata.nrw.de, swisstopo, wien.gv.at, data.gov.uk, IGN, CNIG, LINZ,
csdi.gov.hk, the PLATEAU catalogue API, 3dbag.nl via WebFetch, and many more).
Marks:

- **[v]** read from the source itself (hel.fi, GitHub READMEs and LICENSE
  files, the AWS open-data registry YAML on GitHub).
- **[s]** search-engine extract of the official page. Usually right, but read
  the licence text yourself before shipping.
- **[m]** from memory or inferred. Treat as unverified.

The licence rule (CLAUDE.md, plus research 17): CC0, CC BY, MIT, and ODbL for
map data are fine. Government "attribution" licences that work like CC BY
(dl-de/by-2.0, Licence Ouverte 2.0, OGL v3, Swiss "open use, must provide
source", Taiwan OGDL 1.0) are marked ✅ with the name, since they only ask for
credit. Non-commercial, share-alike on assets (GPL/CC BY-SA), "view only",
"members only" or "licence required" are ❌. ⚠️ means usable only after the
owner reads the terms or decides.

## 1. Tokyo Metropolitan Government digital twin

The link the owner shared, `info.tokyo-digitaltwin.metro.tokyo.lg.jp/3dmodel/`
("3Dモデルでみる東京"), is the landing page of the **Tokyo Digital Twin 3D
Viewer** (`3dview.tokyo-digitaltwin.metro.tokyo.lg.jp`). It's a TerriaJS
browser viewer; its source is on GitHub under `tokyo-digitaltwin` [s]. The
page itself is a viewer. The **data** behind it is downloadable from two
places: the Tokyo Open Data Catalogue (`catalog.data.metro.tokyo.lg.jp`) and
the G-Spatial Information Center (`geospatial.jp/ckan`). Both are blocked
here, so everything below is [s].

What TMG publishes:

| Product | Content | Format | Coverage | Size / how |
|---|---|---|---|---|
| **City 3D digital map** (都市の3Dデジタルマップ, catalogue id `t000008d2000000017`) | Buildings (LoD1/LoD2, some textured), roads (交通・道路), footpaths (交通・徒歩道), street furniture (都市設備), vegetation, underground malls (Shinjuku east exit, Tokyo station, added Feb 2025), land use, plus planning and hazard attributes | CityGML to the **PLATEAU standard product spec**; also served as 3D Tiles in the viewer | 23 wards and Tama (FY2022–23, published 2024-03-29), then the islands; Ogasawara finished March 2026, so **all of Tokyo** is now covered | Per municipality and per ~1 km grid square (JIS X 0410 3rd-level mesh). Built from TMG's own aerial lidar and photos plus the urban planning base map |
| **Wards point cloud** (区部点群データ, `t000029d0000000024`, published 2024-10-31) | Aerial lidar, ≥16 pts/m², classified. 7 products: original (DSM) and ground (DEM) points as classified LAS, 0.25 m grids, 0.25 m micro-topography maps | LAS (zipped) + GeoTIFF-style grids; JGD2011 Plane Rectangular Zone IX (EPSG:6677) | 23 wards | Per 1:500 map sheet; average ~200 MB per zip, largest ~400 MB. The whole wards set is roughly terabytes [m: estimate] |
| **Tama and islands point cloud** (published Sept 2023) | 9 products incl. DSM and 0.25 m grids; "highest-precision public aerial lidar in Japan" | LAS + grids | Tama and the islands except Ogasawara | Same sheet scheme |

**Licence:** the point clouds are **CC BY 4.0**, commercial use allowed [s:
several press reports and the catalogue extract]. The 3D digital map is on
the same open-data catalogue; the extract says commercial and personal use are
allowed, but I couldn't read the licence field directly. Tokyo's catalogue
default is CC BY 4.0 [m]. **✅ fits, verify the 3D map's licence field.**
Credit line: "東京都デジタルツイン実現プロジェクト / Tokyo Metropolitan
Government".

**Relation to PLATEAU.** PLATEAU (MLIT) is the national programme and the
data standard. MLIT built the first 23-ward model in 2020 (`plateau-tokyo23ku`
on geospatial.jp, updated in 2022 and later). TMG then built its own,
newer and wider model (wards, Tama and islands) **to the PLATEAU spec**, so the
same reader handles both, and it appears in PLATEAU's catalogue. In practice:
use the newest PLATEAU/TMG CityGML for buildings, roads and furniture, and
TMG's lidar for terrain and anything PLATEAU misses. PLATEAU is
multi-licensed: the government standard terms, CC BY 4.0, and also ODC-BY or
ODbL at the user's choice [s: PLATEAU site policy and FAQ]. Converter:
**PLATEAU GIS Converter** (Rust CLI and GUI, **MIT** [v]) turns PLATEAU
CityGML into 3D Tiles, glTF, OBJ, GeoPackage, GeoJSON, MVT and more.

Tokyo drives on the **left**, like Ireland. That's a real point in its
favour as a second "familiar" place.

## 2. The big table

Grouped by region. "Data" uses: B = buildings (LoD level), T = textures,
R = roads/lanes, G = terrain, V = trees, F = street furniture, P = point
cloud, M = photogrammetry mesh.

### Japan

| Place | Data | Format | Licence | Fits? | Access, size | Link |
|---|---|---|---|---|---|---|
| Tokyo (TMG) | B LoD1–2, some T, R, footpaths, F, V, underground, land use | CityGML (PLATEAU spec), 3D Tiles | CC BY 4.0 [s/m] | ✅ | Catalogue download per area, no registration | catalog.data.metro.tokyo.lg.jp/dataset/t000008d2000000017 |
| Tokyo (TMG) lidar | P ≥16 pts/m², DSM/DEM, 0.25 m grids | LAS, grids | CC BY 4.0 [s] | ✅ | ~200 MB per 1:500 sheet | catalog.data.metro.tokyo.lg.jp/dataset/t000029d0000000024 |
| **PLATEAU, all of Japan** (265 municipalities as of 2025-12, target 500 by FY2027; 23 M buildings, 30,000 km², 51% of the population) e.g. Tokyo 23 wards, Osaka, Yokohama, Nagoya, Sapporo, Sendai [city list partly m] | B LoD1–2 (LoD3 in spots), T, R LoD1–3 (lanes, sidewalks, signs and signals in LoD3 spots such as Sendai Aoba-dori), bridges, F, V, land use, hazard | CityGML 2.0 + i-UR ADE; 3D Tiles, MVT, FBX, OBJ, GeoJSON | Gov standard terms / CC BY 4.0 / ODC-BY / ODbL [s] | ✅ | geospatial.jp per city; PLATEAU data catalogue API per grid square (research 16). Raw 0.2–3.6 GB per ~1 km area incl. photos (16) | mlit.go.jp/plateau/en/ |

### Netherlands

| Place | Data | Format | Licence | Fits? | Access, size | Link |
|---|---|---|---|---|---|---|
| 3D BAG (whole country) | B LoD1.2/1.3/2.2, ~10 M | CityJSON, OBJ, GPKG, WFS | CC BY 4.0 (see 17) | ✅ | Tiles; full GPKG tens of GB [m] | 3dbag.nl/en/download |
| Kadaster **3D Basisvoorziening** | B LoD2.2 with attributes, **terrain, roads and water as 3D surfaces** (from BGT), DTM | CityJSON, 3D Tiles, quantized mesh | CC BY 4.0 [s] | ✅ | PDOK, OGC API (`api.pdok.nl/kadaster/3d-basisvoorziening/ogc/v1`) | data.overheid.nl/dataset/80592-3d-basisvoorziening |
| AHN (national lidar) | P, DSM/DTM 0.5 m | LAZ, GeoTIFF | CC0 [m] | ✅ | Tiles | ahn.nl |
| Den Haag | B LoD2 with roofs, 2.5D terrain, 112k buildings | CityJSON (2022), CityGML (2021) | CC BY 4.0 [s] | ✅ | Download | ckan.dataplatform.nl (3D Stadsmodel Den Haag 2022 CityJSON) |
| Rotterdam | B LoD1/LoD2 (205k), landmark bridges | CityGML 2.0 | open data, licence not confirmed | ⚠️ | 3drotterdam.nl export | 3drotterdam.nl |

### Germany

Almost every state now publishes LoD2 for free; cityweft lists 15 of 16
states as sources [s]. The licences differ by state.

| Place | Data | Format | Licence | Fits? | Access, size | Link |
|---|---|---|---|---|---|---|
| North Rhine-Westphalia | B LoD1, LoD2 (from lidar + cadastre), DGM1 | CityGML; OGC API | **dl-de/zero-2.0** [s] | ✅ (no conditions) | Tile download, OGC API `ogc-api.nrw.de/3dg/v1` | opengeodata.nrw.de/produkte/geobasis/3dg/lod2_gml/ |
| Bavaria | B LoD2, ~9.8 M objects, ridge/eave ±20–30 cm; DEM1, orthophotos | CityGML 1.0 | **CC BY 4.0** [s] | ✅ | Tiles [m: 2 km] | geodaten.bayern.de/opengeodata/OpenDataDetail.html?pn=lod2 |
| Berlin | B LoD2, textured LoD2, M | CityGML, mesh | dl-de/zero-2.0 (see 17) | ✅ | Berlin 3D download portal | businesslocationcenter.de/berlin3d-downloadportal |
| Hamburg | B LoD1, LoD2 (yearly), textured variants | CityGML | **dl-de/by-2.0** [s] | ✅ (credit) | Transparenzportal | suche.transparenz.hamburg.de/dataset/3d-stadtmodell-lod2-de-hamburg2 |
| Lower Saxony | B LoD1, LoD2, orthos | CityGML | **CC BY 4.0** [s] | ✅ | opengeodata.lgln.niedersachsen.de | opengeodata.lgln.niedersachsen.de/#lod2 |
| Thuringia | B LoD1, LoD2 | CityGML | dl-de/by-2.0 [s] | ✅ | Download page | geoportal.thueringen.de |
| Saxony | B LoD1, LoD2, bridges, towers | CityGML | dl-de/by-2.0 [m] | ✅? | geodaten.sachsen.de | geodaten.sachsen.de |
| Baden-Württemberg | B LoD1, LoD2, DEM1, orthos | CityGML | open since 2024; dl-de/by-2.0 [m] | ✅? | opengeodata.lgl-bw.de | opengeodata.lgl-bw.de |
| Hesse, Brandenburg, Rhineland-Palatinate, Schleswig-Holstein, Mecklenburg-Vorpommern, Saxony-Anhalt, Bremen | B LoD1/LoD2, DTM/DSM in several | CityGML | each state's open licence (dl-de/zero or dl-de/by) [m] | ✅? check each | Direct tile folders (e.g. data.geobasis-bb.de/geobasis/daten/3d_gebaeude/lod2_gml/) | see awesome-citygml list |
| Ingolstadt LoD3 road space (TUM) | R LoD3 with roadside objects, ~50 LoD3 buildings | CityGML 2/3, OpenDRIVE | roads **CC BY-NC-SA 4.0**, LoD3 buildings **CC BY-SA 4.0** [v] | ❌ | GitHub | github.com/savenow/lod3-road-space-models |

### Switzerland, Austria

| Place | Data | Format | Licence | Fits? | Access, size | Link |
|---|---|---|---|---|---|---|
| Switzerland (swissBUILDINGS3D 3.0) | B LoD2 with roof overhangs; closed solids or separate roof/wall/footprint parts | CityGML, GDB, DWG | OGD "open use, must provide source", commercial OK [s] | ✅ | swisstopo download, tiles | opendata.swiss/en/dataset/swissbuildings3d-3-0-beta |
| Switzerland terrain (swissALTI3D, swissSURFACE3D) | G 0.5 m, P | GeoTIFF, LAZ | same OGD terms [m] | ✅ | Tiles | swisstopo.admin.ch |
| Zürich city | B LoD2 roof model, city model, terrain | DXF, GPKG, OBJ, SHP | **CC0** (almost all Open Data Zürich) [s] | ✅ | data.stadt-zuerich.ch | data.stadt-zuerich.ch (tag 3d-stadtmodell) |
| Vienna | B LoD1.4 (650k bodies), LoD2.1 generalised roofs, LoD2.4 detailed roofs | CityGML | **CC BY 4.0** [s] | ✅ | Click tiles in the viewer | wien.gv.at/stadtentwicklung/stadtvermessung/geodaten/dachmodell/ |
| Linz | B LoD2 | CityGML | not confirmed | ⚠️ | Folder download | geo.data.linz.gv.at/katalog/geodata/3d_geo_daten_lod2/ |

### Nordic and Baltic

| Place | Data | Format | Licence | Fits? | Access, size | Link |
|---|---|---|---|---|---|---|
| **Helsinki** | B LoD1/LoD2 semantic, **textured LoD2**, terrain; separate photogrammetric M (summer aerial photos, ±20 cm) | CityGML 2.0; mesh OBJ and 3MX | **CC BY 4.0** for both [v] | ✅ | Area download tool (textured or not); Stadi3D tool | hel.fi/en/decision-making/information-on-helsinki/maps-and-geospatial-data/helsinki-3d |
| Espoo | B LoD0–3 (LoD3 = textured), roads, water, relief, vegetation, land use; textures 5 cm GSD (2024) | CityGML 2.0 via WFS | **CC BY 4.0** (open above-ground data) [s] | ✅ | WFS | kartat.espoo.fi/3D/services_en.html |
| Vantaa | B LoD1/LoD2 with textures from oblique photos | CityGML, SketchUp, KML | CC BY 4.0 [m] | ✅? | Download | betaavoindata.fi/data/en_GB/dataset/vantaan-3d-rakennukset |
| Finland (NLS) | P 0.5 and 5 pts/m², DEM 2 m | LAZ, GeoTIFF | CC BY 4.0 [s] | ✅ | NLS file service | maanmittauslaitos.fi |
| Stockholm | B textured 3D model | — | "license required" on the data portal [s] | ❌ | — | dataportalen.stockholm.se |
| Oslo / Norway (FKB-Bygning) | B 2.5D (roof heights) | SOSI, GML | free only for Norge digitalt partners; private users buy [s] | ❌ | — | geonorge.no |
| Denmark | B (GeoDanmark buildings), national DSM/DTM 0.4 m (Danmarks Højdemodel); a national LoD2 CityGML existed [m] | GML, GeoTIFF, LAZ | CC BY 4.0 [s] | ✅ | Dataforsyningen (free login) | dataforsyningen.dk |
| Estonia (national) | B LoD1 + LoD2, 907,856 objects, address and registry IDs; DTM, DSM | CityGML (336 MB), OBJ (247 MB), GDB | Land Board open-data licence, attribution [s; text not read] | ✅? | Direct download after accepting terms. **Whole country in 336 MB** | geoportaal.maaamet.ee/eng/Download-3D-data-p837.html |
| Riga | B LoD1/LoD2, trees, meshes, point clouds in viewer | CityGML, OBJ, SketchUp, GDB | "freely used by anyone" [s]; licence name unknown | ⚠️ | georiga.eu | georiga.eu/en/atvertie-dati/lod2/ |

### France, Benelux, Iberia, Italy

| Place | Data | Format | Licence | Fits? | Access, size | Link |
|---|---|---|---|---|---|---|
| Lyon (Métropole) | B LoD2 **textured** (2009, 2012, 2015, 2018), terrain | CityGML | **Licence Ouverte / Etalab 2.0** [s] | ✅ | Per commune | data.grandlyon.com (maquettes 3D texturées) |
| France (IGN) | BD TOPO buildings with heights (LoD1); **LiDAR HD** national classified P ≥10 pulses/m², 0.5 m DSM/DTM | GPKG, LAZ, GeoTIFF | Licence Ouverte 2.0 [s] | ✅ | geoservices.ign.fr, 1 km tiles | geoservices.ign.fr |
| Paris (APUR) | B footprints with height and date (volumes bâtis, 1 M buildings) | SHP/GeoJSON | **ODbL** [s] | ✅ (ODbL) | opendata.apur.org | opendata.paris.fr (volumesbatisparis) |
| Luxembourg (national) | B **LoD2.2** (2023 photos), bridges and rail LoD3, trees, lidar 2024 | CityGML/INSPIRE GML | **CC0** [s] | ✅ | data.public.lu | data.public.lu/en/datasets/base-de-donnees-nationale-des-batiments-3d-2023/ |
| Flanders (3D GRB) | B LoD1/LoD2 from GRB + DHM Flanders lidar | various | Modellicentie Gratis Hergebruik (CC BY-like) [m] | ✅? | Digitaal Vlaanderen | vlaanderen.be/digitaal-vlaanderen/.../3d-grb |
| Brussels (UrbIS 3D) | B and structures, LoD2 | SketchUp, GML, GPKG, DWG… | free, "no limitations to public access"; exact licence not read [s] | ⚠️ | datastore.brussels/web/urbis-download | geobru catalogue record e9ec2aa4… |
| Namur | B LoD2 textured, citadel, bridges | CityGML, SketchUp | not confirmed | ⚠️ | data.namur.be | data.namur.be |
| Barcelona (CartoBCN) | B LoD1/LoD2 | various | catalogue under CC BY 4.0 [s], 3D product not checked | ⚠️ | cartobcn | w20.bcn.cat/cartobcn |
| Spain (PNOA LiDAR, Catastro) | P national, DTM/DSM; cadastral buildings with floors above ground | LAZ, GeoTIFF, INSPIRE GML | CC BY 4.0 [s] | ✅ | centrodedescargas.cnig.es | cnig.es |
| Lisbon | nothing open in 3D found; 2D Geodados only | — | — | — | — | — |
| Italy (Milan, Bologna, Trento) | only research models found (Trento LoD2, 2015) | — | — | — | — | — |

### Central and Eastern Europe

| Place | Data | Format | Licence | Fits? | Access, size | Link |
|---|---|---|---|---|---|---|
| Poland (national, GUGiK) | B LoD1 whole country (heights from lidar, 2019–2024 versions), **LoD2 for 236 counties** (2018); 3D tree models in some counties | CityGML 2.0 | free download since 2019–20 under Polish law; no named licence [s] | ⚠️ (likely fine, read the terms) | geoportal.gov.pl, "Data to download > 3D models of buildings" | geoportal.gov.pl/pl/dane/inne-dane/modele-3d-budynkow/ |
| Prague | B (all buildings and bridges, 0.5 m), DEM 1 m, digital twin | various | IPR Praha open data; licence not read [m: CC BY 4.0] | ⚠️ | geoportalpraha.cz | geoportalpraha.cz/en/data-and-services/articles-and-projects/3D-model |
| Brno | B LoD1, roofs, bridges | SHP, DWG | not checked | ⚠️ | data.gov.cz | data.gov.cz |

### UK and Ireland

| Place | Data | Format | Licence | Fits? | Access, size | Link |
|---|---|---|---|---|---|---|
| England (EA National LIDAR Programme) | DSM/DTM 1 m, all England (2017–2023), plus point cloud | GeoTIFF, LAZ | **OGL v3** [s] | ✅ | data.gov.uk / DEFRA survey portal | data.gov.uk (National LIDAR Programme) |
| London | no open 3D model. OS building heights are paid; commercial models (VU.CITY etc.) | — | — | ❌ | — | — |
| Glasgow | B LoD1/LoD2 (research, City3D) | CityGML | not checked | ⚠️ | Zenodo 15000747 | zenodo.org/records/15000747 |
| Ireland | GSI lidar, Tailte Éireann HVD buildings, DCC trees and lights (all in 17 §9). Docklands 3D model is CC BY-NC | — | — | see 17 | — | — |

### Asia (outside Japan)

| Place | Data | Format | Licence | Fits? | Access, size | Link |
|---|---|---|---|---|---|---|
| **Hong Kong** (LandsD 3D Visualisation Map, 3D Spatial Data) | B (210k; Level 1 extruded, Level 2/3 photo-textured), infrastructure incl. **roads, flyovers, footbridges**, V, terrain, water; 3D pedestrian network 9,100 km; indoor maps | 3D Tiles (WGS84), FBX, 3DS, Max, VRML | CSDI terms: download, redistribute, commercial use free, **must credit the HK Government and CSDI** [s] | ⚠️ (custom terms, CC BY-like; owner should read) | CSDI portal, API | portal.csdi.gov.hk (3D Spatial Data API) |
| Singapore | Virtual Singapore is not public. OneMap3D is view-only. HDB public housing LoD1 by NUS (research) | CityJSON, OBJ (HDB3D) | Virtual SG: closed; HDB3D: not confirmed | ❌ / ⚠️ | — | github.com/ualsg/hdb3d-data |
| South Korea (V-World) | Nationwide 3D buildings, textured, in the V-World viewer | API (WebGL) | KOGL Type 1 (attribution) for the API [s]; bulk 3D download unclear | ⚠️ | API key | vworld.kr |
| Taiwan (NLSC) | Nationwide 3D buildings (since 2020, updated yearly) | KMZ, I3S, 3D Tiles; CityGML ADE designed | OGDL-Taiwan 1.0 (CC BY-compatible) [s] for open sets; large-scale data by official request | ⚠️ | 3dmaps.nlsc.gov.tw | 3dmaps.nlsc.gov.tw |
| China (Shenzhen, etc.) | nothing open; GABLE research LoD1 (Beijing, Shanghai, Tianjin) | SHP | not checked; Chinese survey law restricts geodata export | ❌ | — | github.com/AICyberTeam/GABLE |

### Oceania

| Place | Data | Format | Licence | Fits? | Access, size | Link |
|---|---|---|---|---|---|---|
| Melbourne (City of) | M textured photomesh 2018 and 2020; LoD1/2 street-space research model | mesh tiles; CityGML | **CC BY 3.0 AU** [s] | ✅ | data.melbourne.vic.gov.au | data.gov.au (melbourne-city-of-melbourne-3d-textured-mesh-photomesh-2020) |
| Victoria (Vicmap Buildings) | B LoD1 statewide, LoD2 in Melbourne, some textured | various | CC BY 4.0 [m] | ✅? | land.vic.gov.au | land.vic.gov.au (Vicmap Buildings) |
| Adelaide | B textured and untextured, terrain | FBX, SketchUp, multipatch | CC BY [s] | ✅ | data.sa.gov.au | data.sa.gov.au/data/dataset/3d-model |
| NSW Spatial Digital Twin | B 546k, 3D roads 20,000 km, 22 M trees | web viewer, some open layers | mixed; some data restricted [s] | ⚠️ | — | nsw.gov.au (Spatial Digital Twin open data guideline) |
| Wellington | B 3D (2017 capture), CBD to Rongotai | SketchUp (S3) | not confirmed [m: CC BY 4.0] | ⚠️ | data.govt.nz | catalogue.data.govt.nz (tag CBD) |
| New Zealand (LINZ) | National lidar DEM/DSM 1 m (Auckland 2024 etc.), NZ Building Outlines | GeoTIFF, GPKG | **CC BY 4.0** [s] | ✅ | LINZ Data Service, AWS | linz.govt.nz |

### Americas

| Place | Data | Format | Licence | Fits? | Access, size | Link |
|---|---|---|---|---|---|---|
| New York City | B LoD2 (2014, every building); **planimetrics: roadbed, curbs, sidewalks**; 2017 topobathy lidar (180 GB) | CityGML, multipatch, DGN, 3dm; LAS | NYC Open Data terms (free use) (17) | ✅ | maps.nyc.gov/download/3dmodel; NYC Open Data | catalog.data.gov/dataset/3-d-building-model |
| Washington DC | B 3D multipatch from lidar (2013, 2022, 2024), detailed roofs; lidar | multipatch, I3S scene | **CC BY 4.0** [s] | ✅ | opendata.dc.gov; 1.7–6 GB per ward (2024) | catalog.data.gov/dataset/buildings-3d-scene-2024 |
| Boston (BPDA) | B, terrain, citywide | SketchUp, multipatch, others | free download; terms not read | ⚠️ | bostonplans.org | bostonplans.org/3d-data-maps/3d-smart-model/3d-data-download |
| Cambridge MA | B, terrain | CAD, multipatch | not checked | ⚠️ | cambridgema.gov | cambridgema.gov/GIS/3D |
| Philadelphia | B LoD2 textured (2008, 2010, 2015) | GDB | not checked | ⚠️ | PASDA | pasda.psu.edu (dataset 7146) |
| San Francisco | B footprints with lidar heights (2011 lidar) | SHP/GeoJSON | **CC0** (per the OSM import page) [s] | ✅ | data.sfgov.org | wiki.openstreetmap.org/wiki/San_Francisco_Building_Height_Import |
| Los Angeles County (LARIAC) | B outlines with heights (3 M) | GDB | "LARIAC members only" [s] | ❌ | — | — |
| USA (Open City Model) | B LoD1, 125 M buildings by state | CityGML, CityJSON | **ODbL** [v] | ✅ | GitHub/AWS | github.com/opencitymodel/opencitymodel |
| USA (USGS 3DEP) | P and 1 m DEM, most of the US | LAZ (EPT on AWS), GeoTIFF | **Public domain** [v] | ✅ | AWS `usgs-lidar` | registry.opendata.aws/usgs-lidar |
| Toronto | B 3D massing, citywide | SketchUp, DWG, SHP, GDB | Open Government Licence – Toronto [s] | ✅ | open.toronto.ca | open.toronto.ca/dataset/3d-massing/ |
| **Montreal** | B **LoD2 textured** (2009, 2013, 2016) for several boroughs, terrain; lidar | CityGML, DWG | **CC BY 4.0** [s] | ✅ | donneesquebec.ca, per tile | donneesquebec.ca (vmtl-batiment-3d-2016-maquette-citygml-lod2-avec-textures2) |
| Calgary | B LoD2 citywide | CAD, GDB | Open Government Licence – City of Calgary [s] | ✅ | data.calgary.ca | data.calgary.ca/Base-Maps/3D-Buildings-Citywide/cchr-krqg |
| Vancouver | B footprints with lidar heights; lidar 2022 | SHP, LAS | Open Government Licence – Vancouver [m] | ✅? | opendata.vancouver.ca | opendata.vancouver.ca |
| Winnipeg | B LoD1-like, 240k | SHP | not checked | ⚠️ | computecanada object store | see awesome-citygml |
| São Paulo | P lidar 2017, 5–30 pts/m², whole city; DSM/DTM 0.5 m | LAZ, EPT on AWS | **GPL-3.0** [v] | ⚠️ (copyleft licence on data; ask the owner) | AWS `laz-m3dc-pmsp`, GeoSampa | registry.opendata.aws/pmsp-lidar |
| Mexico City | B LoD1/LoD2 research (TU Delft, central-west CDMX, 2026) | CityJSON, OBJ | not checked | ⚠️ | — | 3d.bk.tudelft.nl/ken/en/2026/08/12/open-3d-city-models-mexico.html |
| Buenos Aires | "Ciudad 3D" planning viewer (code MIT); no bulk 3D buildings found | — | — | ❌ for data | — | — |
| Bogotá | IDECA has heights in planning layers; no open 3D model found | — | — | — | — | — |

### Africa and the Middle East

| Place | Data | Format | Licence | Fits? | Access, size | Link |
|---|---|---|---|---|---|---|
| Cape Town | B footprints with mean height from **2023 lidar nDSM** (10 pts/m²), 2023 aerials | ArcGIS REST / download | City of Cape Town open data terms; not read | ⚠️ | citymaps.capetown.gov.za | citymaps.capetown.gov.za (Open_Data_Service) |
| Johannesburg | commissioned lidar and 3D (Woolpert); inner-city twin pilot | — | not open | ❌ | — | — |
| Kigali | 3D city model and topo maps on a geoportal | — | not open as far as found | ❌ | — | — |
| Lagos | nothing official. Use Overture + Google Open Buildings (research 03) | — | — | — | — | — |
| Dubai, Abu Dhabi, Riyadh | government digital twins (Dubai: 195k buildings) for agencies and partners | — | not public | ❌ | — | — |

### Global and national fallbacks

| Dataset | Data | Format | Licence | Fits? | Notes |
|---|---|---|---|---|---|
| **GlobalBuildingAtlas** (TUM, 2025) | 2.75 bn polygons, 2.68 bn LoD1 with heights, 3 m height maps | GeoJSON, GeoTIFF | polygons partly **ODbL**; **LoD1 and heights CC BY-NC 4.0** [v] | ❌ for heights | Search results say "CC BY 4.0"; the repo README says NC. Don't use the heights. |
| EUBUCCO | 200 M EU buildings, height for 74% | GPKG | **ODbL** (95%+) [s] | ✅ | Heights come from the national sets above |
| Microsoft Global ML Footprints | 1.4 bn footprints, some heights | GeoJSONL | **ODbL** [s] | ✅ | Already inside Overture |
| Google Open Buildings 2.5D | heights, 4 m, Global South | COG | CC BY 4.0 / ODbL [s] | ✅ | In use (`fetch_heights.py`) |
| GHSL built height | 100 m grid | GeoTIFF | CC BY 4.0 [m] | ✅ | Too coarse per building |
| ESA WorldCover | 10 m land cover | COG | CC BY 4.0 [m] | ✅ | Ground cover only |
| Copernicus DEM GLO-30 | 30 m DSM | GeoTIFF | Copernicus DEM licence, free with credit [s] | ⚠️ (in 17) | Fallback terrain |
| Overture, OSM | footprints, some heights, roads | GeoParquet, PBF | ODbL | ✅ | In use |

That is about 90 entries; about 50 are marked ✅ (some with a "?" still to confirm).

## 3. Pipeline: what to read first

Today `bake_world.py` writes LGW2: each building is one footprint ring plus
one height (int16 decimetres), and `world.ts` grows walls and a procedural
roof (hip roof for houses, flat slab with parapet for blocks). Heights come
from Overture tags, then Google's 2.5D raster, then a guess. A city model can
improve this in two steps, and the first one is cheap.

### Formats, in order of payoff

1. **CityJSON** as the one internal 3D format. 3D BAG, the Dutch 3D
   Basisvoorziening and Den Haag ship it directly. Everything in CityGML
   converts to it with **citygml-tools** (citygml4j, **Apache 2.0** [v]):
   `citygml-tools to-cityjson`. It reads CityGML 1.0 (Bavaria), 2.0 (most)
   and 3.0. Then read and filter it in Python with **cjio** (**MIT** [v]) or
   plain `json`. CityJSON is about 6x smaller than CityGML XML and has one
   shared vertex list, so it's easy to parse. **This one path covers
   Germany, Switzerland, Austria, Finland, Estonia, Luxembourg, Lyon,
   Montreal, NYC, Poland and the Netherlands.**
2. **PLATEAU CityGML** via the **PLATEAU GIS Converter** (MIT [v]) or
   citygml-tools. PLATEAU uses the i-UR ADE (`uro:` attributes such as
   building use, storeys and year). citygml-tools may drop unknown ADE
   attributes [m]; the PLATEAU converter keeps them (GeoPackage/GeoJSON
   output). Use the PLATEAU converter for Japan, or a small streaming reader
   like Tokyo's `citygml.mjs` (research 16) for just the elements we need.
3. **Lidar** for terrain everywhere and heights where there's no model:
   GeoTIFF DSM/DTM through `rasterio` (already used), and LAS/LAZ through
   **PDAL** (BSD) or **laspy** (BSD-2) [m], gridded to a DTM and nDSM.
   Covers Ireland (GSI), England, Netherlands, France, Spain, Finland,
   Denmark, NZ, the US, Tokyo and Cape Town. For Finglas this is the real
   win (research 17 item 4); there's no Irish LoD2.
4. **3D Tiles / glTF / I3S / FBX / OBJ meshes** last and case by case (Hong
   Kong, DC, Helsinki mesh, Melbourne mesh, Zürich OBJ). These are
   display meshes without per-building semantics, often textured with
   aerial photos. Unpack with **3d-tiles-tools** (CesiumGS, Apache 2.0 [m])
   or py3dtiles (Apache 2.0 [v]); load glTF with trimesh (MIT [m]). Never
   Google Photorealistic 3D Tiles (17).

Avoid FME (commercial) and 3dfier/roofer for shipping code (GPL-3.0 [v]; fine
to run as tools, since their output isn't GPL, but we don't need them because
the data is already reconstructed).

### A generic `tools/bake/import_citymodel.py`

One script, one adapter per source:

```
import_citymodel.py --place hamburg --source hamburg-lod2 --bbox W S E N
  1. fetch    adapter lists tile URLs for the bbox (NRW 1 km grid, Bavaria tiles,
              PLATEAU mesh codes, 3D BAG tile index, PDOK OGC API) and caches
              them under research/data/<place>/ (never committed).
  2. convert  CityGML -> CityJSON (citygml-tools), or PLATEAU converter -> GPKG.
  3. project  pyproj from the source CRS to WGS84, then our Frame (metres
              around the tile centre). Subtract the terrain height at each
              footprint so walls start at the ground.
  4. extract  per building: footprint (GroundSurface, else the convex
              projection), eave height, ridge height, roof type, roof
              triangles (RoofSurface), storeys, use, year, source ID.
              Optional: mean colour per roof/wall from its texture.
  5. join     match to Overture/OSM footprints by overlap (IoU > 0.5) to keep
              names and classes; city-model geometry wins where present.
  6. write    LGW3 = LGW2 + an optional roof-mesh section per building
              (int16 dm vertices, uint16 indices, roof-type byte), plus a
              terrain grid from the DTM.
```

**Step one (1–2 days):** use the city model only for footprints, eave
height, ridge height and roof type, written into the existing LGW2 fields
plus one roof-type byte. `world.ts` already draws hip and flat roofs, so it
would pick the roof from data instead of a hash. Almost no client work.

**Step two (2–4 days):** the LGW3 roof-mesh section, drawn with the facade
material's roof code. Real roof shapes are what you notice from a car on a
hill, and they're the main thing LoD2 gives over our extrusions.

**Textures: leave them out at first.** Facade photos are from oblique aerial
imagery (Hamburg 20 cm, Espoo 5 cm): smeared, with baked shadows and cars,
megabytes per block, and every distinct texture is a sampler problem (16 per
shader, and `textures.ts` already packs two atlases). Take the **mean colour
per wall and roof** from the texture and feed it to the facade palette (the
`avg` trick in `facade.ts`). Revisit photo walls for distant LOD only.

### Gotchas

- **Coordinate systems.** Each source has its own: EPSG:25832/25833 (German
  UTM), 28992 (Dutch RD New), 2056 (Swiss LV95), 31256 (Vienna MGI), 3879
  (Helsinki GK25), 6677 (Tokyo plane IX), **6697 for PLATEAU CityGML, stored
  latitude-first**, 2263 (NY State Plane in **US feet**). Always go through
  pyproj with `always_xy=True` and test a known landmark.
- **Vertical datums.** NAP, DHHN2016, JGD2011 heights, ellipsoidal heights
  in some 3D Tiles. LoD2 heights are usually absolute. Subtract the DTM at
  the footprint, or buildings float or sink. Our ground is flat today, so the
  importer must lower or raise each building onto it until lidar terrain lands.
- **LoD2 isn't one solid per building.** Expect BuildingParts (terraces, wings),
  roof overhangs (Swiss data, which offers a "closed solids" variant), shared
  party walls, and models with only an untyped MultiSurface and no
  Roof/Wall labels (then classify faces by normal: up-facing = roof).
- **Alignment with roads.** Cadastre footprints and OSM/SUMO road centrelines
  differ by 0.5–2 m. Check for buildings that intrude into the carriageway
  and clip or nudge them. The SUMO network stays the source of truth for
  driving.
- **Dataset age.** NYC 2014, Montreal 2016, Lyon 2018, Melbourne 2020. Mix
  with Overture for newer buildings and flag ones that are gone.
- **Size.** Fetch only the bbox. Estonia's whole country is 336 MB of
  CityGML, but a German state is tens of GB, Tokyo's lidar is about 200 MB
  per 1:500 sheet, and PLATEAU areas with photos run 0.2–3.6 GB per ~1 km.
  The baked `.bin` must stay small (Finglas is 572 KB today); a roof mesh
  section might add 1–3 MB per place [estimate].
- **Licence carry-over.** Textures normally share the dataset licence, but
  read the terms (Espoo links textures by URL; Hamburg sells some textured
  products). dl-de/by-2.0 and OGL want a specific credit line and a link to the
  licence. Add one row per source to a provenance table (17 item 11) and to the
  in-game credits.
- **"Open" isn't always open.** GlobalBuildingAtlas heights are NC despite
  what search snippets say; Stockholm and Norway need a licence; NSW and
  Virtual Singapore are mostly view-only; São Paulo's lidar is GPL-3.0.

## 4. Next 10 places: easiest, with the richest data

Ranked by (data richness × licence clarity) ÷ import effort. All pass the
licence rule unless noted.

1. **Tokyo (a central ward, e.g. Shinjuku or Setagaya).** PLATEAU/TMG
   buildings with roofs and textures, road and footpath polygons, furniture,
   vegetation, plus 16+ pts/m² lidar. CC BY 4.0. **Left-hand traffic.** A
   reference implementation exists (research 16). Effort: PLATEAU reader
   and the 6697 axis order.
2. **Rotterdam, Den Haag or Amsterdam (Netherlands).** 3D BAG plus the
   Kadaster 3D Basisvoorziening (buildings, **road and terrain surfaces**,
   CityJSON) plus AHN lidar (CC0). CityJSON is the simplest format of all, so
   this is the best first test of the importer. Right-hand traffic.
3. **Helsinki (and Espoo next door).** Semantic textured LoD2, terrain, a
   photogrammetric mesh, all CC BY 4.0 [v]. Espoo adds roads and vegetation
   in CityGML.
4. **Berlin.** LoD2 with textures and a mesh under dl-de/zero (no
   conditions). Germany's capital, a big driving-test market.
5. **Hamburg or any NRW city (Cologne, Düsseldorf, Dortmund).** LoD2 on a
   clean tile grid, dl-de/by or zero, OGC API in NRW. Once one German state
   works, the rest are just more adapters.
6. **Zürich.** CC0 city model and roofs, swissBUILDINGS3D, 0.5 m Swiss
   terrain for hills. Strong hill-start material.
7. **Vienna.** Three LoDs including detailed LoD2.4 roofs, CC BY 4.0.
8. **New York City.** LoD2 for every building, planimetric **curbs,
   sidewalks and roadbed** polygons (which we'd otherwise have to infer), and
   lidar. Free terms. Old (2014) and in US feet.
9. **Hong Kong.** Textured buildings, roads, flyovers and footbridges as 3D
   Tiles, commercial use allowed with credit. **Left-hand traffic.** Mesh-only
   import path (step 4 above), so more work, and the owner should read the
   CSDI terms first. ⚠️
10. **Luxembourg City.** CC0 national LoD2.2 (2023), LoD3 bridges and rail,
    trees and 2024 lidar. The cleanest licence on the list; small enough to
    take the whole country.

Next in line: Montreal (CC BY textured LoD2, older), Lyon (textured, Licence
Ouverte), Tallinn (all of Estonia in 336 MB), Washington DC (CC BY 4.0 3D
buildings), Bavaria (Munich, CC BY 4.0), Melbourne (CC BY mesh).

**For Finglas and Yaba nothing changes:** Ireland and Lagos have no open LoD2.
Finglas gets real heights and terrain from GSI lidar (17 item 4), which the
same importer's lidar path produces. Yaba stays on Overture + Google 2.5D.

## 5. What I couldn't check

- The licence field of TMG's 3D digital map dataset (likely CC BY 4.0).
- Exact download sizes for PLATEAU Tokyo 23 wards and the full TMG lidar.
- Licences for Saxony, Baden-Württemberg, the smaller German states,
  Rotterdam, Brussels, Barcelona 3D, Prague, Riga, Poland, Wellington,
  Boston, Philadelphia, Cape Town.
- The PLATEAU catalogue API (`api.plateauview.mlit.go.jp/datacatalog`)
  is blocked here; research 16 describes how Tokyo's fetcher uses it.
- Run these checks on the owner's machine before importing any place.

## Sources

- Tokyo: info.tokyo-digitaltwin.metro.tokyo.lg.jp/3dmodel/ (blocked; via
  search) · metro.tokyo.lg.jp/information/press/2024/03/2024032929 (3D map) ·
  metro.tokyo.lg.jp/information/press/2024/10/2024103126 (wards point cloud) ·
  cgworld.jp/flashnews/202411-Tokyo-DigitalTwin.html ·
  prtimes.jp/main/html/rd/p/000004613.000052467.html (Tama/islands) ·
  my.metro.tokyo.lg.jp/w/039-20260327-249543388 (Ogasawara, 2026) ·
  note.com/smart_tokyo/n/nf03e0d0060aa · gigazine.net/gsc_news/en/20241227-tokyo-digitaltwin-3dmodel-viewer/
- PLATEAU: mlit.go.jp/plateau/site-policy/ · mlit.go.jp/plateau/faq/ ·
  geospatial.jp/ckan/dataset/plateau-tokyo23ku · unoosa.org (MLIT slides, 2026:
  265 locations) · archdaily.com/1040412 ·
  github.com/Project-PLATEAU/PLATEAU-GIS-Converter (MIT, read)
- Dataset list used as a starting point: github.com/OloOcki/awesome-citygml
  (README read, updated 2026-05-18)
- Germany: ckan.open.nrw.de (3d-gebaudemodell-nw-lod2) · geodaten.bayern.de
  (hinweise_daten_lod2_download.pdf) · gdk.gdi-de.org (Hamburg INSPIRE LoD2)
  · lgln.niedersachsen.de · cityweft.com/post/germany-nationwide-lod2-building-data-cityweft
  · github.com/savenow/lod3-road-space-models (licences read)
- Switzerland/Austria: opendata.swiss/en/dataset/swissbuildings3d-3-0-beta ·
  wien.gv.at/stadtentwicklung/stadtvermessung/geodaten/dachmodell/ ·
  opendata.swiss (Stadt Zürich)
- Nordic/Baltic: hel.fi Helsinki 3D page (read) · kartat.espoo.fi/3D ·
  maanmittauslaitos.fi · geoportaal.maaamet.ee/eng/Download-3D-data-p837.html
  · data.norge.no (FKB-Bygning) · lists.openstreetmap.org talk-se 2022-03
- France/Benelux/Iberia: data.grandlyon.com · wiki.openstreetmap.org/wiki/Lyon,_France/Buildings_Heights_Import
  · geoservices.ign.fr · data.gouv.fr (LiDAR HD) · geocatalogue.apur.org ·
  data.public.lu · data.overheid.nl/dataset/80592-3d-basisvoorziening ·
  ckan.dataplatform.nl (Den Haag) · geobru-geonetwork.irisnet.be (UrbIS 3D)
- Poland/Czechia: geoportal.gov.pl/pl/dane/inne-dane/modele-3d-budynkow/ ·
  geoportalpraha.cz
- UK: data.gov.uk (National LIDAR Programme)
- Asia: portal.csdi.gov.hk/csdi-webpage/apidoc/3d-spatial-data-api ·
  portal.csdi.gov.hk/csdi-webpage/doc/TNC · data.gov.hk (3D Visualisation
  Map) · spdx.org/licenses/OGDL-Taiwan-1.0 · 3dmaps.nlsc.gov.tw · namu.moe/w/V-World
- Oceania: data.gov.au (Melbourne photomesh, Adelaide 3D model) ·
  nsw.gov.au (Spatial Digital Twin) · catalogue.data.govt.nz · linz.govt.nz
  (attributing elevation data)
- Americas: catalog.data.gov (NYC 3-D Building Model, NYC planimetrics, DC
  Buildings 3D 2024) · bostonplans.org · open.toronto.ca/dataset/3d-massing/ ·
  donneesquebec.ca · calgary.ca/research/open-data.html ·
  github.com/awslabs/open-data-registry (pmsp-lidar.yaml, usgs-lidar.yaml, read)
  · github.com/opencitymodel/opencitymodel (read) ·
  3d.bk.tudelft.nl/ken/en/2026/08/12/open-3d-city-models-mexico.html
- Africa/Middle East: citymaps.capetown.gov.za · jda.org.za · dm.gov.ae ·
  wam.ae
- Global: github.com/zhu-xlab/GlobalBuildingAtlas (licence notice read) ·
  essd.copernicus.org/articles/17/6647/2025/ · zenodo.org/record/7225259
  (EUBUCCO) · wiki.openstreetmap.org/wiki/Microsoft_Building_Footprints ·
  developers.google.com/earth-engine (Open Buildings temporal, Copernicus DEM)
- Tools: github.com/citygml4j/citygml-tools (Apache 2.0) ·
  github.com/cityjson/cjio (MIT) · py3dtiles (Apache 2.0) ·
  github.com/3dcitydb/3dcitydb (Apache 2.0) · tudelft3d/3dfier and 3DGI/roofer
  (GPL-3.0); LICENSE files read
