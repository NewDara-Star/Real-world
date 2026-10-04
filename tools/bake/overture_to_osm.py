"""Rebuild an OSM XML file from Overture transportation + infrastructure.

Overture is derived from OSM, but no OSM extract host is reachable from the
build machine, so this turns the Overture parquet extracts back into the OSM
shape that SUMO's netconvert understands: ways with highway/oneway/maxspeed
tags, nodes tagged traffic_signals / crossing / stop / give_way, and turn
restriction relations. netconvert then does the hard part (lanes, junction
right-of-way, signal programs, footpaths and crossings).

usage: overture_to_osm.py <segment.parquet> <infrastructure.parquet> <connector.parquet> <out.osm>
"""

import sys
from xml.sax.saxutils import quoteattr

import pyarrow.parquet as pq
import shapely

SEGMENT, INFRA, CONNECTOR, OUT = sys.argv[1:5]

# Overture road class -> OSM highway value. Rail and unknowns are dropped.
HIGHWAY = {
    "motorway": "motorway", "trunk": "trunk", "primary": "primary", "secondary": "secondary",
    "tertiary": "tertiary", "residential": "residential", "living_street": "living_street",
    "unclassified": "unclassified", "service": "service", "pedestrian": "pedestrian",
    "footway": "footway", "steps": "steps", "path": "path", "track": "track",
    "cycleway": "cycleway", "bridleway": "bridleway", "unknown": "unclassified",
}
NODE_TAGS = {"traffic_signals", "crossing", "stop", "give_way"}

nodes: dict[tuple[int, int], int] = {}  # rounded (lon, lat) -> node id
node_pos: dict[int, tuple[float, float]] = {}
node_tags: dict[int, dict[str, str]] = {}


def key(lon: float, lat: float) -> tuple[int, int]:
    return round(lon * 1e7), round(lat * 1e7)


def node(lon: float, lat: float) -> int:
    k = key(lon, lat)
    nid = nodes.get(k)
    if nid is None:
        nid = nodes[k] = len(nodes) + 1
        node_pos[nid] = (lon, lat)
    return nid


def whole(rule) -> bool:
    """Rule applies to the whole segment (no partial 'between' range)."""
    b = rule.get("between")
    return not b or (b[0] <= 0.05 and b[1] >= 0.95)


def plain(when) -> bool:
    """A restriction that applies to everyone, all the time."""
    return not when or not any(when.get(k) for k in ("during", "using", "recognized", "mode", "vehicle"))


ways = []
seg_way: dict[str, int] = {}
seg_nodes: dict[str, list[int]] = {}
segs = pq.read_table(SEGMENT).to_pylist()
for s in segs:
    if s["subtype"] != "road" or s["class"] not in HIGHWAY:
        continue
    line = shapely.from_wkb(s["geometry"])
    coords = list(line.coords)
    ids = [node(x, y) for x, y in coords]
    # Collapse repeats from rounding.
    ids = [n for i, n in enumerate(ids) if i == 0 or n != ids[i - 1]]
    if len(ids) < 2:
        continue
    cls, sub = s["class"], s["subclass"]
    tags = {"highway": HIGHWAY[cls] + ("_link" if sub == "link" and cls in ("motorway", "trunk", "primary", "secondary", "tertiary") else "")}
    if cls == "footway" and sub in ("sidewalk", "crossing", "crosswalk"):
        tags["footway"] = "crossing" if sub in ("crossing", "crosswalk") else "sidewalk"
    if cls == "service" and sub in ("driveway", "parking_aisle", "alley"):
        tags["service"] = sub
    if s["names"] and s["names"].get("primary"):
        tags["name"] = s["names"]["primary"]
    for r in s["access_restrictions"] or []:
        w = r.get("when") or {}
        if r["access_type"] != "denied" or not whole(r):
            continue
        if w.get("heading") and plain({k: v for k, v in w.items() if k != "heading"}):
            tags["oneway"] = "yes" if w["heading"] == "backward" else "-1"
        elif not w.get("heading") and w.get("mode") and not any(w.get(k) for k in ("during", "using", "recognized", "vehicle")):
            for m in w["mode"]:
                if m in ("foot", "bicycle", "motor_vehicle", "car"):
                    tags["foot" if m == "foot" else "bicycle" if m == "bicycle" else "motor_vehicle"] = "no"
    for r in s["speed_limits"] or []:
        mx = r.get("max_speed")
        if not mx or not whole(r):
            continue
        w = r.get("when") or {}
        v = str(mx["value"]) + (" mph" if mx.get("unit") == "mph" else "")
        h = w.get("heading")
        tags["maxspeed" + (":forward" if h == "forward" else ":backward" if h == "backward" else "")] = v
    for rf in s["road_flags"] or []:
        if not whole(rf):
            continue
        if "is_bridge" in rf["values"]:
            tags["bridge"] = "yes"
            tags["layer"] = "1"
        if "is_tunnel" in rf["values"]:
            tags["tunnel"] = "yes"
            tags["layer"] = "-1"
    for sr in s["road_surface"] or []:
        if whole(sr) and sr.get("value"):
            tags["surface"] = sr["value"]
    wid = len(ways) + 1
    ways.append((wid, ids, tags))
    seg_way[s["id"]] = wid
    seg_nodes[s["id"]] = ids

# Connector id -> node (for turn restrictions).
conn_node: dict[str, int] = {}
for c in pq.read_table(CONNECTOR, columns=["id", "geometry"]).to_pylist():
    p = shapely.from_wkb(c["geometry"])
    k = key(p.x, p.y)
    if k in nodes:
        conn_node[c["id"]] = nodes[k]

# Road furniture onto the road nodes. Overture keeps OSM node positions, so
# most land exactly on a vertex; the rest snap to the nearest vertex within 2 m.
tree_ids = list(node_pos.keys())
tree = shapely.STRtree([shapely.Point(*node_pos[n]) for n in tree_ids])
attached = missed = 0
for r in pq.read_table(INFRA).to_pylist():
    if r["class"] not in NODE_TAGS:
        continue
    p = shapely.from_wkb(r["geometry"])
    if p.geom_type != "Point":
        continue
    tags = dict(r["source_tags"] or [])
    tags.setdefault("highway", r["class"])
    nid = nodes.get(key(p.x, p.y))
    if nid is None:
        i = tree.nearest(p)
        q = node_pos[tree_ids[i]]
        # ~2 m in degrees at Dublin's latitude.
        if abs(q[0] - p.x) < 3e-5 and abs(q[1] - p.y) < 1.8e-5:
            nid = tree_ids[i]
    if nid is None:
        missed += 1
        continue
    node_tags.setdefault(nid, {}).update(tags)
    attached += 1

# Prohibited transitions -> no_* turn restriction relations (single-step only).
relations = []
for s in segs:
    for t in s["prohibited_transitions"] or []:
        seq = t.get("sequence") or []
        if len(seq) != 1 or s["id"] not in seg_way or seq[0]["segment_id"] not in seg_way:
            continue
        via = conn_node.get(seq[0]["connector_id"])
        if via is None or not plain({k: v for k, v in (t.get("when") or {}).items() if k != "heading"}):
            continue
        relations.append((seg_way[s["id"]], via, seg_way[seq[0]["segment_id"]]))

with open(OUT, "w") as f:
    f.write('<?xml version="1.0" encoding="UTF-8"?>\n<osm version="0.6" generator="overture_to_osm">\n')
    for nid, (lon, lat) in node_pos.items():
        t = node_tags.get(nid)
        if t:
            f.write(f'  <node id="{nid}" lat="{lat:.7f}" lon="{lon:.7f}" version="1">\n')
            for k, v in t.items():
                f.write(f"    <tag k={quoteattr(k)} v={quoteattr(v)}/>\n")
            f.write("  </node>\n")
        else:
            f.write(f'  <node id="{nid}" lat="{lat:.7f}" lon="{lon:.7f}" version="1"/>\n')
    for wid, ids, tags in ways:
        f.write(f'  <way id="{wid}" version="1">\n')
        for n in ids:
            f.write(f'    <nd ref="{n}"/>\n')
        for k, v in tags.items():
            f.write(f"    <tag k={quoteattr(k)} v={quoteattr(v)}/>\n")
        f.write("  </way>\n")
    for i, (fw, via, tw) in enumerate(relations):
        f.write(f'  <relation id="{i + 1}" version="1">\n')
        f.write(f'    <member type="way" ref="{fw}" role="from"/>\n    <member type="node" ref="{via}" role="via"/>\n    <member type="way" ref="{tw}" role="to"/>\n')
        f.write('    <tag k="type" v="restriction"/>\n    <tag k="restriction" v="no_turn"/>\n  </relation>\n')
    f.write("</osm>\n")

print(f"{len(node_pos)} nodes, {len(ways)} ways, {len(relations)} turn restrictions; "
      f"road furniture attached {attached}, missed {missed}", file=sys.stderr)
