"""Mark mini-roundabouts in a SUMO network so everyone gives way to traffic on them.

OSM tags a mini-roundabout as one node (highway=mini_roundabout). netconvert
turns it into an ordinary junction where the bigger road has priority. At a
mini-roundabout everyone gives way to traffic already going round, whatever
road they're on: from the right where traffic keeps left (Ireland, UK), from
the left where it keeps right.

SUMO's left_before_right type says "yield to the left", and netconvert
mirrors it in a left-hand network (--lefthand) into "yield to the right". So
the same type is right on both sides of the road. (right_before_left, the
obvious-looking choice, is mirrored too: it gave Finglas yield-to-the-LEFT.
Measured for Finglas by tests/network.test.mts; no right-hand place with
mini-roundabouts has been checked yet.)

usage: mini_roundabouts.py <osm> <net.xml> <out.nod.xml>
Prints how many were matched. Writes an empty patch if none.
"""

import math
import sys
import xml.etree.ElementTree as ET

from pyproj import Transformer

OSM, NET, OUT = sys.argv[1:4]

net = ET.parse(NET).getroot()
loc = net.find("location").attrib
offx, offy = (float(v) for v in loc["netOffset"].split(","))
to_xy = Transformer.from_crs("EPSG:4326", loc["projParameter"], always_xy=True)
junctions = [(j.get("id"), float(j.get("x")), float(j.get("y")), j.get("type")) for j in net.iter("junction") if j.get("type") not in ("internal", "dead_end")]

minis = []
for n in ET.parse(OSM).getroot().iter("node"):
    if any(t.get("k") == "highway" and t.get("v") == "mini_roundabout" for t in n.findall("tag")):
        x, y = to_xy.transform(float(n.get("lon")), float(n.get("lat")))
        minis.append((x + offx, y + offy))

root = ET.Element("nodes")
matched = set()
for mx, my in minis:
    best, bd = None, 15.0  # metres: the junction centre is usually within a few
    for jid, x, y, _ in junctions:
        d = math.hypot(x - mx, y - my)
        if d < bd:
            best, bd = (jid, x, y), d
    if best and best[0] not in matched:
        matched.add(best[0])
        ET.SubElement(root, "node", id=best[0], x=f"{best[1]:.2f}", y=f"{best[2]:.2f}", type="left_before_right")
ET.ElementTree(root).write(OUT, encoding="utf-8", xml_declaration=True)
print(f"{len(matched)} of {len(minis)} mini-roundabouts matched to junctions", file=sys.stderr)
