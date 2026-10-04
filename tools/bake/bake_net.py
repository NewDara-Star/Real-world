"""Pack a SUMO .net.xml into the game's compact road-rules file (LNT1).

What the game gets, all in the world's local metres (x east, z south):
  - lanes: road, footpath, junction-internal, crossing and walking-area
    lanes with shapes, widths and speed limits
  - edges: lane groups between junctions, with stop / give-way sign flags
  - junctions: outline polygon, right-of-way request matrix (response, foes)
  - links: lane -> lane through the junction, with turn direction, priority
    state, signal index and the junction request index
  - signal programs: phase durations and per-link states

usage: bake_net.py <net.xml> <osm> <world.json> <out.bin>
"""

import math
import struct
import sys
import xml.etree.ElementTree as ET

from pyproj import Transformer

NET, OSM, WORLD, OUT = sys.argv[1:5]

import json

meta = json.load(open(WORLD))
LON0, LAT0 = meta["origin"]["lon"], meta["origin"]["lat"]
HALF_X, HALF_Z = meta["half"]["x"] + 60, meta["half"]["z"] + 60
KX = 111320.0 * math.cos(math.radians(LAT0))
KY = 110574.0

root = ET.parse(NET).getroot()
loc = root.find("location").attrib
offx, offy = (float(v) for v in loc["netOffset"].split(","))
to_ll = Transformer.from_crs(loc["projParameter"], "EPSG:4326", always_xy=True)


def world(x: float, y: float) -> tuple[float, float]:
    lon, lat = to_ll.transform(x - offx, y - offy)
    return (lon - LON0) * KX, -(lat - LAT0) * KY


def shape(s: str) -> list[tuple[float, float]]:
    return [world(*map(float, p.split(",")[:2])) for p in s.split()]


def inside(pts) -> bool:
    return any(abs(x) < HALF_X and abs(z) < HALF_Z for x, z in pts)


JTYPES = ["priority", "traffic_light", "right_before_left", "allway_stop", "priority_stop", "dead_end",
          "unregulated", "zipper", "traffic_light_right_on_red", "rail_crossing", "internal", "left_before_right"]
KIND = {"normal": 0, "sidewalk": 1, "internal": 2, "crossing": 4, "walkingarea": 5}

# ---- junctions ----
junctions, jindex = [], {}
for j in root.iter("junction"):
    if j.get("type") == "internal":
        continue
    pos = world(float(j.get("x")), float(j.get("y")))
    if not inside([pos]):
        continue
    shp = shape(j.get("shape", "")) if j.get("shape") else []
    reqs = sorted(j.findall("request"), key=lambda r: int(r.get("index")))
    n = len(reqs)

    def bits(s: str) -> int:
        # SUMO writes index 0 as the RIGHTMOST character.
        return int(s, 2) if s else 0

    rows = [(bits(r.get("response")), bits(r.get("foes")), r.get("cont") == "1") for r in reqs]
    jindex[j.get("id")] = len(junctions)
    junctions.append({"id": j.get("id"), "type": JTYPES.index(j.get("type")) if j.get("type") in JTYPES else 0,
                      "pos": pos, "shape": shp, "rows": rows, "int": (j.get("intLanes") or "").split()})

# Roundabouts: SUMO lists each ring's junctions. Mini-roundabouts are single OSM
# nodes; mini_roundabouts.py already made them give-way-to-the-right junctions.
ring = {jid for r in root.iter("roundabout") for jid in r.get("nodes", "").split()}
for j in junctions:
    j["flags"] = 0x80 if j["id"] in ring else 0

# ---- edges and lanes ----
lanes, lindex, edges, eindex = [], {}, [], {}
names, nindex = [], {}


def name_id(s):
    if not s:
        return 0xFFFF
    if s not in nindex:
        nindex[s] = len(names)
        names.append(s)
    return nindex[s]


for e in root.iter("edge"):
    fn = e.get("function", "normal")
    eid = e.get("id")
    lane_els = e.findall("lane")
    if not lane_els:
        continue
    shapes = [shape(l.get("shape")) for l in lane_els]
    if not any(inside(s) for s in shapes):
        continue
    if fn == "normal":
        if e.get("from") not in jindex and e.get("to") not in jindex:
            continue
        eindex[eid] = len(edges)
        edges.append({"from": jindex.get(e.get("from"), 0xFFFFFFFF), "to": jindex.get(e.get("to"), 0xFFFFFFFF),
                      "name": name_id(e.get("name")), "prio": int(e.get("priority", "0")), "flags": 0,
                      "first": len(lanes), "n": len(lane_els), "id": eid})
    junction_of = None
    if fn in ("internal", "crossing", "walkingarea"):
        junction_of = eid[1:].rsplit("_", 1)[0]
        if junction_of not in jindex:
            continue
    for l, s in zip(lane_els, shapes):
        allow = l.get("allow", "").split()
        disallow = l.get("disallow", "").split()
        open_ = not allow
        passenger = "passenger" in allow or (open_ and "passenger" not in disallow)
        # SUMO keeps service roads (driveways, car parks) to delivery vehicles so
        # through-routes avoid them: drivable, but flagged so AI traffic skips them.
        service = not passenger and "delivery" in allow
        car = passenger or service
        ped = "pedestrian" in allow or (open_ and "pedestrian" not in disallow and fn in ("crossing", "walkingarea"))
        ped_only = fn == "normal" and ped and not car
        kind = KIND[fn]
        if fn == "normal" and ped_only:
            kind = KIND["sidewalk"]
        if fn == "internal" and not car:
            kind = 3  # pedestrian internal
        lindex[l.get("id")] = len(lanes)
        lanes.append({"kind": kind, "allow": (1 if car else 0) | (2 if ped else 0) | (4 if service else 0),
                      "edge": eindex.get(eid, 0xFFFFFFFF), "index": int(l.get("index")),
                      "speed": float(l.get("speed")), "width": float(l.get("width", "3.2")),
                      "length": float(l.get("length")), "shape": s,
                      "junction": jindex.get(junction_of, 0xFFFFFFFF) if junction_of else 0xFFFFFFFF})

ids = {e["id"] for e in edges}
for e in edges:
    other = e["id"][1:] if e["id"].startswith("-") else "-" + e["id"]
    if other in ids:
        e["flags"] |= 4
    if not e["id"].startswith("-"):
        e["flags"] |= 8

# ---- signal programs ----
tls, tindex = [], {}
for t in root.iter("tlLogic"):
    tindex[t.get("id")] = len(tls)
    tls.append({"offset": float(t.get("offset", "0")),
                "phases": [(float(p.get("duration")), p.get("state")) for p in t.findall("phase")]})

# ---- links ----
conn_via = {}  # internal lane id -> next connection (for chains through internal junctions)
all_conns = list(root.iter("connection"))
for c in all_conns:
    if c.get("from", "").startswith(":") and c.get("via"):
        conn_via[f'{c.get("from")}_{c.get("fromLane")}'] = c.get("via")

links = []
for c in all_conns:
    fl = f'{c.get("from")}_{c.get("fromLane")}'
    tl_ = f'{c.get("to")}_{c.get("toLane")}'
    if c.get("from", "").startswith(":") and not c.get("from", "").rsplit("_", 1)[-1].startswith(("w", "c")):
        continue  # second half of a chained internal lane: folded into its first link
    if fl not in lindex or tl_ not in lindex:
        continue
    vias = []
    v = c.get("via")
    while v:
        if v not in lindex:
            vias = None
            break
        vias.append(lindex[v])
        v = conn_via.get(v)
    if vias is None:
        continue
    # Junction request index: position of the via lane (or its successor) in intLanes.
    j = lanes[vias[0]]["junction"] if vias else lanes[lindex[tl_]]["junction"] if lanes[lindex[tl_]]["kind"] == 4 else 0xFFFFFFFF
    req = -1
    if j != 0xFFFFFFFF:
        ints = junctions[j]["int"]
        cands = [c.get("via")] + ([conn_via.get(c.get("via"))] if c.get("via") else []) + ([tl_] if not c.get("via") else [])
        for cand in cands:
            if cand and cand in ints:
                req = ints.index(cand)
                break
    links.append({"from": lindex[fl], "to": lindex[tl_], "vias": vias, "dir": c.get("dir", "s"), "state": c.get("state", "M"),
                  "tl": tindex.get(c.get("tl"), -1), "li": int(c.get("linkIndex", "-1")), "j": j, "req": req})

# ---- stop / give-way signs from the OSM nodes onto the edge they control ----
def ll_world(lon, lat):
    return (lon - LON0) * KX, -(lat - LAT0) * KY


signs = []
for n in ET.parse(OSM).getroot().iter("node"):
    tags = {t.get("k"): t.get("v") for t in n.findall("tag")}
    hw = tags.get("highway")
    if hw not in ("stop", "give_way"):
        continue
    p = ll_world(float(n.get("lon")), float(n.get("lat")))
    best, bd = None, 1e9
    for i, e in enumerate(edges):
        if e["to"] == 0xFFFFFFFF:
            continue
        road = [lanes[e["first"] + k] for k in range(e["n"]) if lanes[e["first"] + k]["kind"] == 0]
        if not road:
            continue
        ln = road[0]
        end = ln["shape"][-1]
        d = math.dist(p, end)
        # The sign belongs to the edge that ENDS near it (traffic approaching the junction).
        if d < 30 and d < bd:
            best, bd = i, d
    if best is not None:
        edges[best]["flags"] |= 1 if hw == "stop" else 2
        signs.append((1 if hw == "stop" else 2, best))

# ---- zebra / marked crossings from the OSM crossing nodes ----
cross_mid = [(i, l["shape"][0], l["shape"][-1]) for i, l in enumerate(lanes) if l["kind"] == 4]
zebras = 0
for n in ET.parse(OSM).getroot().iter("node"):
    tags = {t.get("k"): t.get("v") for t in n.findall("tag")}
    if tags.get("highway") != "crossing" or tags.get("crossing") == "traffic_signals":
        continue
    marked = tags.get("crossing:markings") in ("zebra", "yes", "lines") or tags.get("crossing") in ("zebra", "marked", "uncontrolled") or tags.get("crossing_ref") == "zebra"
    if not marked:
        continue
    p = ll_world(float(n.get("lon")), float(n.get("lat")))
    best, bd = None, 8.0
    for i, a, b in cross_mid:
        d = math.dist(p, ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2))
        if d < bd:
            best, bd = i, d
    if best is not None:
        lanes[best]["allow"] |= 8
        zebras += 1
print(f"{zebras} marked crossings", file=sys.stderr)

# ---- mini-roundabouts: the junctions mini_roundabouts.py made right_before_left ----
# (One source of truth: that pass did the matching; netconvert is told not to
# create right_before_left junctions itself, so the type alone marks them.)
minis = 0
for j in junctions:
    if JTYPES[j["type"]] == "right_before_left":
        j["flags"] |= 0x40
        minis += 1
print(f"{sum(1 for j in junctions if j['flags'] & 0x80)} roundabout junctions, {minis} mini-roundabouts", file=sys.stderr)

# ---- write ----
buf = bytearray(b"LNT1")
buf += struct.pack("<H", len(names))
for s in names:
    b = s.encode()[:255]
    buf += struct.pack("<B", len(b)) + b


def pts(p):
    out = struct.pack("<H", len(p))
    for x, z in p:
        out += struct.pack("<ff", x, z)
    return out


buf += struct.pack("<I", len(junctions))
for j in junctions:
    buf += struct.pack("<Bff", j["type"] | j["flags"], *j["pos"]) + pts(j["shape"])
    n = len(j["rows"])
    nb = (n + 7) // 8
    buf += struct.pack("<H", n)
    for resp, foes, cont in j["rows"]:
        buf += resp.to_bytes(nb, "little") + foes.to_bytes(nb, "little") + struct.pack("<B", 1 if cont else 0)

buf += struct.pack("<I", len(edges))
for e in edges:
    buf += struct.pack("<IIHbBIB", e["from"], e["to"], e["name"], max(-128, min(127, e["prio"])), e["flags"], e["first"], e["n"])

buf += struct.pack("<I", len(lanes))
for l in lanes:
    buf += struct.pack("<BBIBfffI", l["kind"], l["allow"], l["edge"], l["index"], l["speed"], l["width"], l["length"], l["junction"]) + pts(l["shape"])

buf += struct.pack("<I", len(links))
for k in links:
    buf += struct.pack("<IIBccbhIh", k["from"], k["to"], len(k["vias"]), k["dir"].encode(), k["state"].encode(), k["tl"], k["li"], k["j"], k["req"])
    for v in k["vias"]:
        buf += struct.pack("<I", v)

buf += struct.pack("<H", len(tls))
for t in tls:
    buf += struct.pack("<fB", t["offset"], len(t["phases"]))
    for d, st in t["phases"]:
        b = st.encode()
        buf += struct.pack("<fH", d, len(b)) + b

open(OUT, "wb").write(buf)
kinds = {}
for l in lanes:
    kinds[l["kind"]] = kinds.get(l["kind"], 0) + 1
print(f"{len(junctions)} junctions, {len(edges)} edges, {len(lanes)} lanes {kinds}, {len(links)} links, "
      f"{len(tls)} signal programs, {len(signs)} stop/give-way signs, {len(buf) / 1e6:.1f} MB", file=sys.stderr)
