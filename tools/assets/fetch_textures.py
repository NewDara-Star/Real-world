"""Download the CC0 texture sets the city shader uses into game/public/tex/.

Each surface role gets albedo.jpg, normal.jpg (OpenGL convention) and
rough.jpg, resized for the GPU budget, plus manifest.json recording how many
metres one tile covers so the shader can sample in real-world units.

Sources: Poly Haven (polyhaven.com, CC0) and ambientCG (ambientcg.com, CC0).
usage: python3 tools/assets/fetch_textures.py
"""
import io
import time
import json
import os
import urllib.request
import zipfile

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "game", "public", "tex")
UA = {"User-Agent": "RealWorld-drivingsim/0.1"}

# role: (source, asset id, output size px)
SETS = {
    "asphalt": ("polyhaven", "asphalt_02", 1024),
    "footpath": ("polyhaven", "concrete_pavement", 1024),
    "brick": ("polyhaven", "red_brick_03", 1024),
    "render": ("polyhaven", "white_plaster_rough_02", 1024),
    "plaster": ("polyhaven", "painted_plaster_wall", 1024),
    "rooftile": ("polyhaven", "grey_roof_tiles_02", 1024),
    "zinc": ("polyhaven", "corrugated_iron", 1024),
    "laterite": ("polyhaven", "red_laterite_soil_stones", 1024),
    "concrete": ("polyhaven", "concrete", 1024),
    "grass": ("ambientcg", "Grass004", 1024),
}


def get(url: str) -> bytes:
    for attempt in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
                return r.read()
        except OSError:
            if attempt == 4:
                raise
            time.sleep(2 ** attempt)
    raise RuntimeError(url)


def save(img: Image.Image, path: str, size: int, mode: str):
    img = img.convert(mode).resize((size, size), Image.LANCZOS)
    img.save(path, quality=88, optimize=True)


def polyhaven(aid: str):
    files = json.loads(get(f"https://api.polyhaven.com/files/{aid}"))
    info = json.loads(get(f"https://api.polyhaven.com/info/{aid}"))
    pick = lambda key: files[key]["2k"]["jpg"]["url"]
    maps = {"albedo": pick("Diffuse"), "normal": pick("nor_gl"), "rough": pick("Rough")}
    w, h = info.get("dimensions", [2000, 2000])
    return {k: Image.open(io.BytesIO(get(u))) for k, u in maps.items()}, (w / 1000, h / 1000), ", ".join(info.get("authors", {}).keys())


def ambientcg(aid: str):
    meta = json.loads(get(f"https://ambientcg.com/api/v2/full_json?id={aid}&include=dimensionsData"))["foundAssets"][0]
    z = zipfile.ZipFile(io.BytesIO(get(f"https://ambientcg.com/get?file={aid}_2K-JPG.zip")))
    names = z.namelist()
    find = lambda tag: next(n for n in names if tag in n and n.endswith(".jpg"))
    maps = {"albedo": find("_Color"), "normal": find("_NormalGL"), "rough": find("_Roughness")}
    w = (meta.get("dimensionX") or 200) / 100
    h = (meta.get("dimensionY") or 200) / 100
    return {k: Image.open(io.BytesIO(z.read(n))) for k, n in maps.items()}, (w, h), "ambientCG"


def main():
    os.makedirs(OUT, exist_ok=True)
    mpath = os.path.join(OUT, "manifest.json")
    manifest = json.load(open(mpath)) if os.path.exists(mpath) else {}
    for role, (src, aid, size) in SETS.items():
        if manifest.get(role, {}).get("id") == aid and os.path.exists(os.path.join(OUT, role, "rough.jpg")):
            continue
        maps, (w, h), author = (polyhaven if src == "polyhaven" else ambientcg)(aid)
        d = os.path.join(OUT, role)
        os.makedirs(d, exist_ok=True)
        save(maps["albedo"], os.path.join(d, "albedo.jpg"), size, "RGB")
        save(maps["normal"], os.path.join(d, "normal.jpg"), size, "RGB")
        save(maps["rough"], os.path.join(d, "rough.jpg"), size, "L")
        manifest[role] = {"metres": [round(w, 3), round(h, 3)], "source": src, "id": aid, "author": author}
        print(role, aid, f"{w:.2f}x{h:.2f} m")
        json.dump(manifest, open(mpath, "w"), indent=1)
    credits = ["CC0 textures used in the city:"] + [
        f"- {r}: {m['id']} ({'Poly Haven' if m['source'] == 'polyhaven' else 'ambientCG'}, {m.get('author', '')}, CC0)" for r, m in manifest.items()
    ]
    open(os.path.join(OUT, "CREDITS.md"), "w").write("\n".join(credits) + "\n")


if __name__ == "__main__":
    main()
