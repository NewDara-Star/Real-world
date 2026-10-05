"""Find the paint in a car's body texture (pure NumPy, so it's testable without Blender).

paint_mask(rgb) takes an (N, 3) float array of texel colours (0..1, any
colour space) and returns a boolean mask of the paint texels, or None when the
paint can't be separated: too few vivid texels (black, grey or white paint
looks like trim), or no single hue dominating the vivid ones (a bright decal
or a two-tone body). Used by build_traffic_cars.py to make the paint tintable.
"""
import numpy as np

VIVID_SAT = 0.3      # saturation above which a texel is "vivid"
MIN_VIVID = 0.05     # at least this share of texels must be vivid
MIN_DOMINANT = 0.4   # the paint hue must hold at least this share of vivid texels
HUE_WIDTH = 0.08     # texels within this hue distance (0..0.5) of the paint are paint
PAINT_SAT = 0.2      # ...and at least this saturated


def hue_sat(rgb):
    mx, mn = rgb.max(axis=1), rgb.min(axis=1)
    sat = np.where(mx > 1e-4, (mx - mn) / np.maximum(mx, 1e-4), 0)
    r, g, b = rgb[:, 0], rgb[:, 1], rgb[:, 2]
    d = np.maximum(mx - mn, 1e-6)
    hue = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) / 6
    return hue, sat


def paint_mask(rgb):
    hue, sat = hue_sat(rgb)
    vivid = sat > VIVID_SAT
    if vivid.mean() < MIN_VIVID:
        return None
    hist, edges = np.histogram(hue[vivid], bins=36, range=(0, 1))
    k = hist.argmax()
    paint_h = (edges[k] + edges[k + 1]) / 2
    dh = np.abs(((hue - paint_h + 0.5) % 1.0) - 0.5)
    near = dh < HUE_WIDTH
    if (near & vivid).sum() < MIN_DOMINANT * vivid.sum():
        return None
    return (sat > PAINT_SAT) & near
