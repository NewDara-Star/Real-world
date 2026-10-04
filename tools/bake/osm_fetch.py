"""Fetch real OpenStreetMap road data for a bounding box, for SUMO's netconvert.

OSM has what the driving test turns on and Overture leaves out: lane counts,
turn lanes, roundabouts and mini-roundabouts, speed limits, turn
restrictions, stop and give-way signs, signals and crossings.

Sources, in order: an Overpass server (one query for the whole box), else the
OSM editing API in small tiles. The API's usage policy allows downloading
small areas, not bulk scraping, so tiles are small, fetched one at a time with
a pause, cached on disk, and split further only when the API says a tile has
too many nodes. A place's box is a few km across: a handful of requests, once.

Output keeps only what the road network needs: ways tagged highway, every node
they use or that carries a tag, and turn-restriction relations between kept
ways. Data © OpenStreetMap contributors, ODbL.

usage: osm_fetch.py W S E N <out.osm> [--cache DIR]
exit 3 if no source answered, so the caller can fall back to Overture.
"""

import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

UA = "RealWorld-bake/0.1"  # generic: no personal names or handles in request headers
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
API = "https://api.openstreetmap.org/api/0.6/map?bbox={w},{s},{e},{n}"
TILE = 0.012  # degrees: about 0.8 km × 1.3 km in Dublin, well under the API's node cap


def get(url: str, data: bytes | None = None, timeout: int = 120) -> bytes:
    req = urllib.request.Request(url, data=data, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def overpass(w: float, s: float, e: float, n: float) -> bytes | None:
    q = f"""[timeout:180];
(way["highway"]({s},{w},{n},{e});
 node["highway"]({s},{w},{n},{e});
 node["crossing"]({s},{w},{n},{e}););
(._;>;);
(._;rel(bw)["type"="restriction"];);
out meta;"""
    for url in OVERPASS:
        try:
            return get(url, urllib.parse.urlencode({"data": q}).encode(), timeout=200)
        except (urllib.error.URLError, OSError) as err:
            print(f"  overpass {url}: {err}", file=sys.stderr)
    return None


def api_tiles(w: float, s: float, e: float, n: float, cache: str) -> list[bytes] | None:
    out: list[bytes] = []
    todo = []
    x = w
    while x < e:
        y = s
        while y < n:
            todo.append((x, y, min(x + TILE, e), min(y + TILE, n)))
            y += TILE
        x += TILE
    while todo:
        tw, ts, te, tn = todo.pop(0)
        path = os.path.join(cache, f"{tw:.5f}_{ts:.5f}_{te:.5f}_{tn:.5f}.osm")
        if os.path.exists(path):
            out.append(open(path, "rb").read())
            continue
        try:
            body = get(API.format(w=tw, s=ts, e=te, n=tn))
        except urllib.error.HTTPError as err:
            if err.code == 400:  # too many nodes: split in four and try again
                mx, my = (tw + te) / 2, (ts + tn) / 2
                todo[:0] = [(tw, ts, mx, my), (mx, ts, te, my), (tw, my, mx, tn), (mx, my, te, tn)]
                continue
            print(f"  osm api: {err}", file=sys.stderr)
            return None
        except (urllib.error.URLError, OSError) as err:
            print(f"  osm api: {err}", file=sys.stderr)
            return None
        open(path, "wb").write(body)
        out.append(body)
        print(f"  tile {len(out)} ({len(body) // 1024} KB)", file=sys.stderr)
        time.sleep(1.5)  # be gentle with the editing API
    return out


def merge(chunks: list[bytes], out_path: str) -> dict[str, int]:
    nodes: dict[str, ET.Element] = {}
    ways: dict[str, ET.Element] = {}
    rels: dict[str, ET.Element] = {}
    for c in chunks:
        root = ET.fromstring(c)
        for el in root:
            if el.tag == "node":
                nodes[el.get("id")] = el
            elif el.tag == "way" and any(t.get("k") == "highway" for t in el.findall("tag")):
                ways[el.get("id")] = el
            elif el.tag == "relation" and any(t.get("k") == "type" and t.get("v", "").startswith("restriction") for t in el.findall("tag")):
                rels[el.get("id")] = el
    used = {nd.get("ref") for w in ways.values() for nd in w.findall("nd")}
    keep = {i: n for i, n in nodes.items() if i in used or n.find("tag") is not None}
    # A way cut by a tile edge can miss nodes outside the box; drop those refs.
    for w in ways.values():
        for nd in list(w.findall("nd")):
            if nd.get("ref") not in keep:
                w.remove(nd)
    ways = {i: w for i, w in ways.items() if len(w.findall("nd")) >= 2}
    rels = {i: r for i, r in rels.items() if all(m.get("type") != "way" or m.get("ref") in ways for m in r.findall("member"))}
    root = ET.Element("osm", version="0.6", generator="realworld osm_fetch", copyright="OpenStreetMap and contributors", license="https://opendatacommons.org/licenses/odbl/1-0/")
    for group in (keep, ways, rels):
        for i in sorted(group, key=int):
            root.append(group[i])
    ET.ElementTree(root).write(out_path, encoding="utf-8", xml_declaration=True)
    tag = lambda el, k, v=None: any(t.get("k") == k and (v is None or t.get("v") == v) for t in el.findall("tag"))
    return {
        "ways": len(ways), "nodes": len(keep), "restrictions": len(rels),
        "with_lanes": sum(tag(w, "lanes") for w in ways.values()),
        "with_turn_lanes": sum(tag(w, "turn:lanes") or tag(w, "turn:lanes:forward") or tag(w, "turn:lanes:backward") for w in ways.values()),
        "with_maxspeed": sum(tag(w, "maxspeed") for w in ways.values()),
        "roundabout_ways": sum(tag(w, "junction", "roundabout") or tag(w, "junction", "circular") for w in ways.values()),
        "mini_roundabouts": sum(tag(n, "highway", "mini_roundabout") for n in keep.values()),
        "signals": sum(tag(n, "highway", "traffic_signals") for n in keep.values()),
    }


def main():
    args = sys.argv[1:]
    cache = None
    if "--cache" in args:
        i = args.index("--cache")
        cache = args[i + 1]
        del args[i : i + 2]
    w, s, e, n = (float(v) for v in args[:4])
    out = args[4]
    cache = cache or os.path.join(os.path.dirname(out), "osm_tiles")
    os.makedirs(cache, exist_ok=True)
    # A margin so roads leaving the box still have their junctions.
    m = 0.002
    w, s, e, n = w - m, s - m, e + m, n + m
    print("fetching OSM roads", file=sys.stderr)
    body = overpass(w, s, e, n)
    chunks = [body] if body else api_tiles(w, s, e, n, cache)
    if not chunks:
        print("no OSM source answered", file=sys.stderr)
        sys.exit(3)
    stats = merge(chunks, out)
    print("  " + ", ".join(f"{k} {v}" for k, v in stats.items()), file=sys.stderr)


if __name__ == "__main__":
    main()
