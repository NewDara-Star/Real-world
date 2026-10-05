"""Download CC0 Poly Haven models (glTF, 1k textures) into assets-src/polyhaven/<id>/.

Raw sources stay out of git (assets-src/ is ignored); finished, reworked models
go to game/public/models/ with a credit. usage: python3 tools/assets/fetch_polyhaven_models.py [id ...]
"""
import json
import os
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "assets-src", "polyhaven")
UA = {"User-Agent": "WorldDrive-assets/0.1"}

# Street-level props for Dublin estates and shop parades.
MODELS = [
    "rollershutter_door", "rollershutter_window_01", "rollershutter_window_02", "rollershutter_window_03",
    "utility_box_01", "utility_box_02", "water_manhole_cover", "concrete_road_barrier", "concrete_road_barrier_02",
    "modular_chainlink_fence", "modular_electricity_poles", "modular_electric_cables", "modular_street_seating",
    "metal_trash_can", "trashbag", "exterior_aircon_unit", "security_light", "security_camera_01",
    "modular_metal_gutter", "shrub_01", "shrub_02", "shrub_03", "shrub_04", "planter_box_01", "planter_box_02",
    "planter_box_03", "street_lamp_01", "street_lamp_02",
]


def get(url):
    for attempt in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
                return r.read()
        except OSError:
            if attempt == 4:
                raise
            time.sleep(2 ** attempt)


def fetch(aid):
    dest = os.path.join(OUT, aid)
    if os.path.exists(os.path.join(dest, f"{aid}.gltf")):
        return "cached"
    files = json.loads(get(f"https://api.polyhaven.com/files/{aid}"))
    g = files["gltf"]["1k"]["gltf"]
    os.makedirs(dest, exist_ok=True)
    for rel, inc in g.get("include", {}).items():
        path = os.path.join(dest, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        open(path, "wb").write(get(inc["url"]))
    open(os.path.join(dest, f"{aid}.gltf"), "wb").write(get(g["url"]))
    info = json.loads(get(f"https://api.polyhaven.com/info/{aid}"))
    json.dump({"id": aid, "name": info.get("name"), "authors": list(info.get("authors", {})), "licence": "CC0"},
              open(os.path.join(dest, "source.json"), "w"), indent=1)
    return "ok"


if __name__ == "__main__":
    for aid in sys.argv[1:] or MODELS:
        print(aid, fetch(aid), flush=True)
