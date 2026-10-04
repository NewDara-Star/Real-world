"""Bake a playable world tile from Overture Maps extracts.

Reads the Yaba Overture parquet extracts in research/data and writes:
  game/public/world/<name>.bin   compact binary geometry (buildings, roads, areas)
  game/public/world/<name>.json  metadata (origin, street names, places, spawn)

Coordinates are metres relative to the tile centre, stored as int16 decimetres:
x points east, z points south (three.js convention, north is -z).

Usage: python3 tools/bake/bake_world.py [--name yaba] [--bbox W S E N]
"""
import argparse
import hashlib
import json
import math
import os
import struct

import duckdb
import numpy as np
import rasterio
import shapely
from rasterio.warp import transform as rio_transform
from shapely.geometry import box

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DATA = os.path.join(ROOT, "research", "data")
OUT = os.path.join(ROOT, "game", "public", "world")

# Road classes: id, width in metres. Order matters: the id is written to the file.
ROAD_CLASSES = {
    "motorway": (1, 18.0), "trunk": (2, 14.0), "primary": (3, 11.0), "secondary": (4, 9.0),
    "tertiary": (5, 8.0), "residential": (6, 6.0), "unclassified": (6, 6.0), "unknown": (6, 6.0),
    "service": (7, 4.0), "track": (8, 3.5), "path": (9, 2.0), "footway": (9, 2.0), "steps": (9, 2.0),
}
RAIL_CLASS = (10, 3.5)
WATER_LINE_CLASS = (11, 5.0)

# Area kinds written to the file.
AREA_WATER, AREA_GREEN, AREA_PITCH, AREA_PAVED = 1, 2, 3, 4
GREEN_LANDUSE = {"park", "grass", "garden", "cemetery", "grave_yard", "farmland", "species_management_area"}
PITCH_LANDUSE = {"pitch", "track", "stadium"}
PAVED_LANDUSE = {"retail", "commercial", "railway"}

PLACE_KEEP = (
    "market", "shopping", "church", "mosque", "worship", "religious", "hospital", "university", "college",
    "school", "stadium", "bank", "restaurant", "eatery", "bar", "lounge", "club", "hotel", "gym", "fitness",
    "park", "bus", "station", "cinema", "theater", "professional_service", "technical", "office", "fire",
)


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--name", default="yaba")
    p.add_argument("--bbox", nargs=4, type=float, default=[3.362, 6.494, 3.384, 6.520], metavar=("W", "S", "E", "N"))
    return p.parse_args()


class Frame:
    """Equirectangular projection around the tile centre (fine at 2 km scale)."""

    def __init__(self, w, s, e, n):
        self.lon0, self.lat0 = (w + e) / 2, (s + n) / 2
        self.kx = 111320.0 * math.cos(math.radians(self.lat0))
        self.ky = 110574.0

    def xz(self, coords):
        a = np.asarray(coords, dtype=np.float64)[:, :2]
        return np.c_[(a[:, 0] - self.lon0) * self.kx, -(a[:, 1] - self.lat0) * self.ky]


def q(v):
    """Metres -> int16 decimetres."""
    return np.clip(np.round(v * 10.0), -32767, 32767).astype(np.int16)


def stable_rand(key):
    return int(hashlib.md5(key.encode()).hexdigest()[:8], 16) / 0xFFFFFFFF


def load_height_raster():
    path = os.path.join(DATA, "yaba_google_temporal_2023_1km.tif")
    if not os.path.exists(path):
        return None
    ras = rasterio.open(path)
    # Band 1: height in 0.5 m steps, band 2: building presence in percent (see research doc 03).
    return ras, ras.read(1) / 2.0, ras.read(2) / 100.0


def raster_height(raster, lon, lat):
    if raster is None:
        return None
    ras, h, presence = raster
    xs, ys = rio_transform("EPSG:4326", ras.crs, [lon], [lat])
    r, c = ras.index(xs[0], ys[0])
    if not (0 <= r < h.shape[0] and 0 <= c < h.shape[1]):
        return None
    win = h[max(0, r - 6):r + 7, max(0, c - 6):c + 7]
    pw = presence[max(0, r - 6):r + 7, max(0, c - 6):c + 7]
    v = win[(pw > 0.3) & (win > 0)]
    return float(np.median(v)) if v.size else None


def guess_height(key, area_m2):
    """Plausible Lagos mainland storey counts when no data exists."""
    r = stable_rand(key)
    if area_m2 < 60:
        floors = 1
    elif area_m2 < 200:
        floors = 1 + (r > 0.55)
    elif area_m2 < 600:
        floors = 2 + (r > 0.5)
    else:
        floors = 3 + int(r * 3)
    return floors * 3.2 + 0.4


def lines_of(geom):
    if geom.is_empty:
        return []
    if geom.geom_type == "LineString":
        return [geom]
    if geom.geom_type in ("MultiLineString", "GeometryCollection"):
        return [g for g in geom.geoms if g.geom_type == "LineString"]
    return []


def polys_of(geom):
    if geom.is_empty:
        return []
    if geom.geom_type == "Polygon":
        return [geom]
    if geom.geom_type in ("MultiPolygon", "GeometryCollection"):
        return [g for g in geom.geoms if g.geom_type == "Polygon"]
    return []


def main():
    args = parse_args()
    w, s, e, n = args.bbox
    frame = Frame(w, s, e, n)
    clip = box(w, s, e, n)
    con = duckdb.connect()
    where = f"bbox.xmax >= {w} and bbox.xmin <= {e} and bbox.ymax >= {s} and bbox.ymin <= {n}"

    def pq(layer):
        return os.path.join(DATA, f"yaba_overture_{layer}.parquet")

    # ---- buildings -------------------------------------------------------
    raster = load_height_raster()
    buildings = []
    height_src = {"tagged": 0, "raster": 0, "guess": 0}
    rows = con.sql(
        f"select id, geometry, height, num_floors, class from '{pq('buildings')}' where {where}"
    ).fetchall()
    for bid, wkb, height, floors, cls in rows:
        geom = shapely.from_wkb(wkb)
        cen = geom.centroid
        if not clip.contains(cen):
            continue
        for poly in polys_of(geom):
            poly = shapely.simplify(poly, 0.000003)
            if poly.is_empty or poly.geom_type != "Polygon":
                continue
            ring = frame.xz(poly.exterior.coords)[:-1]
            if len(ring) < 3:
                continue
            area = abs(shapely.area(shapely.Polygon(ring)))
            if area < 6:
                continue
            if height:
                h, src = float(height), "tagged"
            elif floors:
                h, src = float(floors) * 3.2 + 0.4, "tagged"
            else:
                h = raster_height(raster, cen.x, cen.y)
                src = "raster"
                if h is None or h < 2.5:
                    h, src = guess_height(bid, area), "guess"
            height_src[src] += 1
            # Counter-clockwise in the x/z plane (seen from above, with z south) for consistent walls.
            if shapely.Polygon(ring).exterior.is_ccw:
                ring = ring[::-1]
            buildings.append((min(h, 120.0), ring))

    # ---- roads, rail, water lines ---------------------------------------
    names, name_idx = [], {}

    def name_id(nm):
        if not nm:
            return 0xFFFF
        if nm not in name_idx:
            name_idx[nm] = len(names)
            names.append(nm)
        return name_idx[nm]

    roads = []
    rows = con.sql(
        f"select subtype, class, names.primary, geometry from '{pq('segment')}' where {where}"
    ).fetchall()
    for subtype, cls, nm, wkb in rows:
        if subtype == "rail":
            cid, width = RAIL_CLASS
        elif subtype == "road" and cls in ROAD_CLASSES:
            cid, width = ROAD_CLASSES[cls]
        else:
            continue
        geom = shapely.intersection(shapely.from_wkb(wkb), clip)
        for line in lines_of(geom):
            pts = frame.xz(shapely.simplify(line, 0.000002).coords)
            if len(pts) >= 2:
                roads.append((cid, width, name_id(nm), pts))

    # ---- areas: water, green space, pitches, paved ------------------------
    areas = []
    rows = con.sql(f"select subtype, class, geometry from '{pq('water')}' where {where}").fetchall()
    for subtype, cls, wkb in rows:
        if cls == "swimming_pool":
            continue
        geom = shapely.intersection(shapely.from_wkb(wkb), clip)
        for poly in polys_of(geom):
            areas.append((AREA_WATER, frame.xz(shapely.simplify(poly, 0.000003).exterior.coords)[:-1]))
        for line in lines_of(geom):
            pts = frame.xz(shapely.simplify(line, 0.000002).coords)
            if len(pts) >= 2:
                roads.append((WATER_LINE_CLASS[0], WATER_LINE_CLASS[1], 0xFFFF, pts))
    rows = con.sql(f"select class, geometry from '{pq('land_use')}' where {where}").fetchall()
    for cls, wkb in rows:
        kind = AREA_GREEN if cls in GREEN_LANDUSE else AREA_PITCH if cls in PITCH_LANDUSE else AREA_PAVED if cls in PAVED_LANDUSE else 0
        if not kind:
            continue
        geom = shapely.intersection(shapely.from_wkb(wkb), clip)
        for poly in polys_of(geom):
            areas.append((kind, frame.xz(shapely.simplify(poly, 0.000003).exterior.coords)[:-1]))
    areas = [a for a in areas if len(a[1]) >= 3]

    # ---- places ------------------------------------------------------------
    places, seen = [], set()
    rows = con.sql(
        f"select names.primary, basic_category, confidence, geometry from '{pq('place')}' "
        f"where {where} and confidence >= 0.8 and names.primary is not null order by confidence desc"
    ).fetchall()
    for nm, cat, conf, wkb in rows:
        pt = shapely.from_wkb(wkb)
        if not clip.contains(pt) or not cat or not any(k in cat for k in PLACE_KEEP):
            continue
        key = nm.lower().strip()
        if key in seen or len(nm) > 48:
            continue
        seen.add(key)
        x, z = frame.xz([(pt.x, pt.y)])[0]
        places.append({"name": nm, "cat": cat, "x": round(float(x), 1), "z": round(float(z), 1)})
    places = places[:260]

    # ---- write -------------------------------------------------------------
    os.makedirs(OUT, exist_ok=True)
    buf = bytearray(b"LGW1")
    buf += struct.pack("<I", len(buildings))
    for h, ring in buildings:
        buf += struct.pack("<HH", int(round(h * 10)), len(ring))
        buf += q(ring).tobytes()
    buf += struct.pack("<I", len(roads))
    for cid, width, nid, pts in roads:
        buf += struct.pack("<BBHH", cid, int(round(width * 2)), nid, len(pts))
        buf += q(pts).tobytes()
    buf += struct.pack("<I", len(areas))
    for kind, ring in areas:
        buf += struct.pack("<BH", kind, len(ring))
        buf += q(ring).tobytes()
    with open(os.path.join(OUT, f"{args.name}.bin"), "wb") as f:
        f.write(buf)

    half_x = (e - w) / 2 * frame.kx
    half_z = (n - s) / 2 * frame.ky
    cchub = next((p for p in places if "co-creation" in p["name"].lower()), None)
    spawn = {"x": cchub["x"] + 12, "z": cchub["z"] + 8} if cchub else {"x": 0, "z": 0}
    meta = {
        "name": args.name,
        "origin": {"lon": frame.lon0, "lat": frame.lat0},
        "half": {"x": round(half_x, 1), "z": round(half_z, 1)},
        "names": names,
        "places": places,
        "spawn": spawn,
        "attribution": "© OpenStreetMap contributors, Overture Maps Foundation, Google Open Buildings",
    }
    with open(os.path.join(OUT, f"{args.name}.json"), "w") as f:
        json.dump(meta, f, separators=(",", ":"), ensure_ascii=False)

    import gzip
    print(json.dumps({
        "buildings": len(buildings), "heights": height_src, "roads": len(roads), "areas": len(areas),
        "street_names": len(names), "places": len(places),
        "bin_bytes": len(buf), "bin_gzip_bytes": len(gzip.compress(bytes(buf), 9)),
        "extent_m": [round(half_x * 2), round(half_z * 2)], "spawn": spawn,
    }, indent=1))


if __name__ == "__main__":
    main()
