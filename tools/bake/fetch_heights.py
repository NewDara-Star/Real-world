"""Fetch Google Open Buildings 2.5D Temporal (2023) building heights for a bbox.

Reads only the needed window from the public cloud-optimised GeoTIFFs over
HTTP range requests and writes a small 2-band raster the bake script uses:
  band 1: building height x 2 (0.5 m units, 0 = none)
  band 2: building presence in percent

Licence: CC BY 4.0 / ODbL (Google Open Buildings; contains Copernicus Sentinel-2 data).

Usage: python3 tools/bake/fetch_heights.py [--bbox W S E N] [--out path]
"""
import argparse
import json
import os
import urllib.request

import numpy as np
import rasterio
from rasterio.transform import from_origin
from rasterio.warp import transform as rio_transform
from rasterio.windows import from_bounds

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
BUCKET = "https://storage.googleapis.com/open-buildings-temporal-data"
# UTM 31N covers Lagos; Google splits it into two manifests.
MANIFESTS = ["v1/manifests/11_EPSG_32631_2023_06_30.json", "v1/manifests/13_EPSG_32631_2023_06_30.json"]
CRS = "EPSG:32631"
RES = 0.5


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--bbox", nargs=4, type=float, default=[3.362, 6.494, 3.384, 6.520], metavar=("W", "S", "E", "N"))
    p.add_argument("--out", default=os.path.join(ROOT, "research", "data", "yaba_google_temporal_2023.tif"))
    a = p.parse_args()
    w, s, e, n = a.bbox
    xs, ys = rio_transform("EPSG:4326", CRS, [w, e, w, e], [s, s, n, n])
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    cols, rows = int(np.ceil((x1 - x0) / RES)), int(np.ceil((y1 - y0) / RES))
    height = np.zeros((rows, cols), dtype=np.uint8)
    presence = np.zeros((rows, cols), dtype=np.uint8)

    # GDAL's curl reads the proxy CA from this variable inside the sandbox; harmless elsewhere.
    if os.path.exists("/root/.ccr/ca-bundle.crt"):
        os.environ.setdefault("CURL_CA_BUNDLE", "/root/.ccr/ca-bundle.crt")

    tiles = []
    for m in MANIFESTS:
        man = json.load(urllib.request.urlopen(f"{BUCKET}/{m}"))
        prefix = man["uriPrefix"].replace("gs://open-buildings-temporal-data", BUCKET)
        for ts in man["tilesets"]:
            for src in ts["sources"]:
                t = src["affineTransform"]
                tw, th = src["dimensions"]["width"] * t["scaleX"], src["dimensions"]["height"] * -t["scaleY"]
                tx, ty = t["translateX"], t["translateY"]
                if tx < x1 and tx + tw > x0 and ty - th < y1 and ty > y0:
                    tiles.append(f"{prefix}{src['uris'][0]}")
    print(f"{len(tiles)} tile(s) cover the bbox")

    for url in tiles:
        with rasterio.open(f"/vsicurl/{url}") as src:
            bands = {d: i + 1 for i, d in enumerate(src.descriptions)} if any(src.descriptions) else {}
            hb = bands.get("building_height", 2)
            pb = bands.get("building_presence", 3)
            l, b, r, t = src.bounds
            ix0, ix1, iy0, iy1 = max(x0, l), min(x1, r), max(y0, b), min(y1, t)
            if ix0 >= ix1 or iy0 >= iy1:
                continue
            win = from_bounds(ix0, iy0, ix1, iy1, src.transform).round_offsets().round_lengths()
            h = src.read(hb, window=win).astype(np.float32)
            pr = src.read(pb, window=win).astype(np.float32)
            # Destination offsets in the output grid (row 0 = north edge).
            ox, oy = int(round((ix0 - x0) / RES)), int(round((y1 - iy1) / RES))
            hh, ww = min(h.shape[0], rows - oy), min(h.shape[1], cols - ox)
            height[oy:oy + hh, ox:ox + ww] = np.clip(np.nan_to_num(h[:hh, :ww]) * 2, 0, 254).astype(np.uint8)
            pscale = 100.0 if pr.max() <= 1.0 else 1.0
            presence[oy:oy + hh, ox:ox + ww] = np.clip(np.nan_to_num(pr[:hh, :ww]) * pscale, 0, 100).astype(np.uint8)
            print(f"read {ww}x{hh} px from {url.rsplit('/', 1)[-1]}")

    with rasterio.open(
        a.out, "w", driver="GTiff", width=cols, height=rows, count=2, dtype="uint8", crs=CRS,
        transform=from_origin(x0, y1, RES, RES), compress="deflate", predictor=2, tiled=True,
    ) as dst:
        dst.write(height, 1)
        dst.write(presence, 2)
        dst.set_band_description(1, "building_height_x2 (0.5m units)")
        dst.set_band_description(2, "building_presence_pct")
    built = height[presence > 30]
    print(f"wrote {a.out} ({os.path.getsize(a.out) // 1024} KB); built px {built.size}, "
          f"median height {np.median(built) / 2 if built.size else 0:.1f} m")


if __name__ == "__main__":
    main()
