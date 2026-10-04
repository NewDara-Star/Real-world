"""Bake a real place into the game in one command, and list it on the world map.

  python3 tools/bake/add_place.py finglas            # rebuild a place already in places.json
  python3 tools/bake/add_place.py finglas --net-only # just the road network
  python3 tools/bake/add_place.py --register         # only refresh the world map list
  python3 tools/bake/add_place.py ballymun --label Ballymun --country Ireland \
      --bbox -6.285 53.388 -6.250 53.410 --style dublin --drive left \
      --tz Europe/Dublin --spawn "Ballymun"           # add a new place

Steps: Overture extracts for the bbox -> bake_world (buildings, roads, areas)
-> real OSM roads (osm_fetch: lanes, turn lanes, roundabouts, limits), or if
no OSM source answers, an OSM rebuild from Overture (no lanes or roundabouts)
-> SUMO netconvert + mini-roundabout pass + bake_net (lanes, junction rules,
signals) -> game/public/world/places.json, which the world map reads.

Place definitions live in tools/bake/places.json so every place can be rebuilt.
"""

import argparse
import json
import os
import struct
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA = os.path.join(ROOT, "research", "data")
WORLD = os.path.join(ROOT, "game", "public", "world")
CONFIG = os.path.join(ROOT, "tools", "bake", "places.json")
BAKE = os.path.join(ROOT, "tools", "bake")

LAYERS = [  # (theme, type, file suffix)
    ("buildings", "building", "overture_buildings"),
    ("transportation", "segment", "overture_segment"),
    ("base", "water", "overture_water"),
    ("base", "land_use", "overture_land_use"),
    ("places", "place", "overture_place"),
    ("base", "infrastructure", "ov_infrastructure"),
    ("transportation", "connector", "ov_connector"),
]


def run(*cmd):
    print("+", " ".join(cmd), file=sys.stderr)
    subprocess.run(cmd, check=True, cwd=ROOT)


def load_config():
    return json.load(open(CONFIG)) if os.path.exists(CONFIG) else {}


def bake(name, p, net_only=False, refetch=False):
    d = os.path.join(DATA, name)
    os.makedirs(d, exist_ok=True)
    bbox = ",".join(str(v) for v in p["bbox"])
    for theme, typ, suffix in LAYERS:
        out = os.path.join(d, f"{name}_{suffix}.parquet" if suffix.startswith("overture") else f"{suffix}.parquet")
        if refetch or not os.path.exists(out):
            run("python3", os.path.join(BAKE, "overture_fetch.py"), theme, typ, bbox, out)
    if not net_only:
        run("python3", os.path.join(BAKE, "bake_world.py"), "--name", name, "--style", p["style"],
            "--prefix", f"{name}/{name}_overture", "--bbox", *[str(v) for v in p["bbox"]], "--spawn-place", p.get("spawn", ""))
    osm = os.path.join(d, f"{name}.osm")
    netxml = os.path.join(d, f"{name}.net.xml")
    # Real OSM first: it has lanes, turn lanes and roundabouts; Overture doesn't.
    code = subprocess.run(["python3", os.path.join(BAKE, "osm_fetch.py"), *[str(v) for v in p["bbox"]], osm], cwd=ROOT).returncode
    if code not in (0, 3):  # 3 means no source answered; anything else is a bug to fix, not a reason to quietly downgrade
        sys.exit(f"osm_fetch.py failed (exit {code}); fix it rather than baking from Overture")
    if code == 3:
        print("! no OSM source answered: rebuilding roads from Overture (no lane counts, turn lanes or roundabouts)", file=sys.stderr)
        run("python3", os.path.join(BAKE, "overture_to_osm.py"), os.path.join(d, "ov_segment.parquet") if os.path.exists(os.path.join(d, "ov_segment.parquet")) else os.path.join(d, f"{name}_overture_segment.parquet"),
            os.path.join(d, "ov_infrastructure.parquet"), os.path.join(d, "ov_connector.parquet"), osm)
    run("sh", os.path.join(BAKE, "build_net.sh"), osm, netxml, p.get("drive", "right"))
    run("python3", os.path.join(BAKE, "bake_net.py"), netxml, osm, os.path.join(WORLD, f"{name}.json"), os.path.join(WORLD, f"{name}.net.bin"))


def register():
    """Write game/public/world/places.json: everything the world map shows."""
    cfg = load_config()
    out = []
    for name, p in cfg.items():
        meta_path = os.path.join(WORLD, f"{name}.json")
        if not os.path.exists(meta_path):
            continue
        meta = json.load(open(meta_path))
        with open(os.path.join(WORLD, f"{name}.bin"), "rb") as f:
            head = f.read(8)
        buildings = struct.unpack("<I", head[4:8])[0]
        stats = {"buildings": buildings, "streets": len(meta.get("names", [])), "places": len(meta.get("places", []))}
        netbin = os.path.join(WORLD, f"{name}.net.bin")
        stats["roadRules"] = os.path.exists(netbin)
        w, s, e, n = p["bbox"]
        out.append({
            "zone": name, "label": p["label"], "country": p.get("country", ""), "style": p["style"],
            "drive": p.get("drive", "right"), "tz": p.get("tz", "UTC"),
            "lon": meta["origin"]["lon"], "lat": meta["origin"]["lat"], "bbox": [w, s, e, n],
            "blurb": p.get("blurb", ""), "stats": stats,
        })
    json.dump(out, open(os.path.join(WORLD, "places.json"), "w"), indent=1, ensure_ascii=False)
    print(f"{len(out)} places on the world map", file=sys.stderr)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("name", nargs="?")
    ap.add_argument("--label")
    ap.add_argument("--country")
    ap.add_argument("--bbox", nargs=4, type=float, metavar=("W", "S", "E", "N"))
    ap.add_argument("--style", choices=["lagos", "dublin"])
    ap.add_argument("--drive", choices=["left", "right"])
    ap.add_argument("--tz")
    ap.add_argument("--spawn")
    ap.add_argument("--blurb")
    ap.add_argument("--net-only", action="store_true")
    ap.add_argument("--refetch", action="store_true")
    ap.add_argument("--register", action="store_true", help="only rewrite the world map list")
    a = ap.parse_args()
    cfg = load_config()
    if a.name:
        p = cfg.get(a.name, {})
        for k in ("label", "country", "bbox", "style", "drive", "tz", "spawn", "blurb"):
            v = getattr(a, k)
            if v is not None:
                p[k] = v
        missing = [k for k in ("label", "bbox", "style") if k not in p]
        if missing:
            sys.exit(f"new place needs: {', '.join('--' + m for m in missing)}")
        cfg[a.name] = p
        json.dump(cfg, open(CONFIG, "w"), indent=1, ensure_ascii=False)
        if not a.register:
            bake(a.name, p, net_only=a.net_only, refetch=a.refetch)
    register()


if __name__ == "__main__":
    main()
