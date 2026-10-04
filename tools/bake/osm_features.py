"""Bake the OSM features that aren't roads: street lamps, house numbers, walls and hedges.

The roads bake (osm_fetch.py) keeps highways only. This keeps the things a
street is lined with, from the same sources (an Overpass server, else the OSM
API tiles already cached by osm_fetch):

  lamps      every highway=street_lamp node (real lamp positions)
  addresses  every addr:housenumber (on a building: its centre; on a node: there)
  barriers   barrier=wall / hedge / retaining_wall ways (estate walls, hedges)

Coordinates use the world bake's frame (bake_world.py Frame: equirectangular
around the meta origin), in decimetres. Data © OpenStreetMap contributors, ODbL.

usage: osm_features.py <place>    (bbox from places.json, origin from the baked meta)
writes game/public/world/<place>.features.json; exit 3 if no source answered.
"""

import json
import math
import os
import sys
import urllib.error
import urllib.parse
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(__file__))
from osm_fetch import OVERPASS, api_tiles, get  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WORLD = os.path.join(ROOT, "game", "public", "world")
DATA = os.path.join(ROOT, "research", "data")
BARRIERS = {"wall": 0, "hedge": 1, "retaining_wall": 2}


def overpass(w, s, e, n):
    q = f"""[timeout:180];
(node["highway"="street_lamp"]({s},{w},{n},{e});
 nwr["addr:housenumber"]({s},{w},{n},{e});
 way["barrier"~"^(wall|hedge|retaining_wall)$"]({s},{w},{n},{e}););
(._;>;);
out;"""
    for url in OVERPASS:
        try:
            return get(url, urllib.parse.urlencode({"data": q}).encode(), timeout=200)
        except (urllib.error.URLError, OSError) as err:
            print(f"  overpass {url}: {err}", file=sys.stderr)
    return None


def main():
    name = sys.argv[1]
    places = json.load(open(os.path.join(os.path.dirname(__file__), "places.json")))
    p = places[name] if isinstance(places, dict) else next(q for q in places if q["name"] == name)
    w, s, e, n = p["bbox"]
    meta = json.load(open(os.path.join(WORLD, f"{name}.json")))
    lon0, lat0 = meta["origin"]["lon"], meta["origin"]["lat"]
    kx, ky = 111320.0 * math.cos(math.radians(lat0)), 110574.0
    hx, hz = meta["half"]["x"], meta["half"]["z"]

    def xz(lon, lat):
        return (lon - lon0) * kx, -(lat - lat0) * ky

    cache = os.path.join(DATA, name, "osm_tiles")
    os.makedirs(cache, exist_ok=True)
    m = 0.002  # the same margin as osm_fetch, so its cached tiles are reused
    body = overpass(w - m, s - m, e + m, n + m)
    chunks = [body] if body else api_tiles(w - m, s - m, e + m, n + m, cache)
    if not chunks:
        print("no OSM source answered", file=sys.stderr)
        sys.exit(3)

    nodes, ways, seen = {}, [], set()
    for c in chunks:
        for el in ET.fromstring(c):
            if el.tag == "node":
                nodes[el.get("id")] = el
            elif el.tag == "way" and el.get("id") not in seen:
                seen.add(el.get("id"))
                ways.append(el)
    tags = lambda el: {t.get("k"): t.get("v") for t in el.findall("tag")}
    pos = lambda nd: xz(float(nd.get("lon")), float(nd.get("lat")))
    inside = lambda x, z: abs(x) < hx and abs(z) < hz
    dm = lambda v: int(round(v * 10))

    lamps, addresses, barriers, streets = [], [], [], []
    street_ix = {}

    def add_address(t, x, z):
        if not inside(x, z):
            return
        st = t.get("addr:street", "")
        if st not in street_ix:
            street_ix[st] = len(streets)
            streets.append(st)
        addresses.append([t["addr:housenumber"], street_ix[st], dm(x), dm(z)])

    for nid, nd in nodes.items():
        t = tags(nd)
        if not t:
            continue
        x, z = pos(nd)
        if t.get("highway") == "street_lamp" and inside(x, z):
            lamps += [dm(x), dm(z)]
        if "addr:housenumber" in t:
            add_address(t, x, z)
    for way in ways:
        t = tags(way)
        pts = [pos(nodes[r.get("ref")]) for r in (nd for nd in way.findall("nd")) if r.get("ref") in nodes]
        if len(pts) < 2:
            continue
        if "addr:housenumber" in t:
            ring = pts[:-1] if pts[0] == pts[-1] and len(pts) > 3 else pts
            add_address(t, sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring))
        kind = BARRIERS.get(t.get("barrier", ""))
        if kind is not None and any(inside(x, z) for x, z in pts):
            try:
                height = float(t.get("height", "0").replace("m", "").strip())
            except ValueError:
                height = 0.0
            barriers.append([kind, dm(height), [v for x, z in pts for v in (dm(x), dm(z))]])

    out = os.path.join(WORLD, f"{name}.features.json")
    json.dump({"attribution": "© OpenStreetMap contributors (ODbL)", "units": "decimetres",
               "lamps": lamps, "streets": streets, "addresses": addresses, "barriers": barriers},
              open(out, "w"), separators=(",", ":"))
    print(f"  {len(lamps) // 2} lamps, {len(addresses)} house numbers on {len(streets)} streets, "
          f"{len(barriers)} walls/hedges -> {os.path.relpath(out, ROOT)} ({os.path.getsize(out) // 1024} KB)", file=sys.stderr)


if __name__ == "__main__":
    main()
