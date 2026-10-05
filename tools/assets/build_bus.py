"""Build bus_dublin_dd.glb (docs/blender-assets.md, section 2) in Blender.

Headless: blender -b --factory-startup --python tools/assets/build_bus.py
A modern two-axle low-floor double-decker in the shape of Dublin's Wright
Gemini-bodied buses (looked at in CC photos on Wikimedia Commons, not stored):
big wraparound lower windscreen, destination display between the decks, tall
upper front window into a rounded roof, a continuous black window band on
each deck, entrance behind the front wheel and an exit mid-bus on the kerb
(left, +X) side. Yellow with a dark blue lower band; no logos or livery
graphics. The body is panels around real window openings, so the seats on
both decks show through the tinted glass. Metres, Blender Z up, front -Y;
origin on the ground midway between the axles; wheel pivots at their centres.
"""
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_street_furniture as sf  # noqa: E402  (shared Blender helpers)

L, W, H = 10.9, 2.55, 4.4
HW = W / 2
Y0, Y1 = -L / 2, L / 2
AXLE_F, AXLE_R = -2.95, 2.95  # wheelbase 5.9 m
WHEEL_R = 0.5  # 275/70 R22.5
ARCH = 0.66  # half-length of a wheel arch opening
T = 0.05  # panel thickness
FLOOR, DECK = 0.36, 2.36  # lower floor top, upper floor top
LOW = (1.15, 2.15)  # lower-deck window band
UP = (2.6, 3.85)  # upper-deck window band
DOOR_F = (-2.25, -1.1)  # entrance, behind the front wheel
DOOR_M = (0.15, 1.3)  # exit, mid-bus
ROOF_Z = 4.15


def bus():
    yellow = sf.painted("BusYellow", 0xF2C21A, rough=0.35)
    blue = sf.painted("BusBlue", 0x1C2654, rough=0.35)
    black = sf.painted("WindowFrame", 0x0C0D0F, rough=0.4)
    arch = sf.painted("WheelArch", 0x101112, rough=0.8)
    bumper = sf.painted("Bumper", 0x26282B, rough=0.6)
    glass = sf.material("Glass", 0x1B2329, rough=0.05, alpha=0.5)
    YELLOW, BLUE, BLACK, ARCHM, BUMPER = range(5)

    b = sf.Mesh("Body", [yellow, blue, black, arch, bumper])
    side = lambda x, y0, y1, z0, z1, m: b.box((T, y1 - y0, z1 - z0), Vector((x, (y0 + y1) / 2, (z0 + z1) / 2)), mat=m)
    for sx in (1, -1):
        x = sx * (HW - T / 2)
        kerb = sx > 0
        doors = [DOOR_F, DOOR_M] if kerb else []
        # Lower body below the windows, broken by the wheel arches and (kerb side) the doors.
        cuts = sorted([(AXLE_F - ARCH, AXLE_F + ARCH), (AXLE_R - ARCH, AXLE_R + ARCH)] + doors)
        y = Y0 + 0.4
        for c0, c1 in cuts:
            if c0 > y:
                side(x, y, c0, 0.3, LOW[0], BLUE)
            y = max(y, c1)
        side(x, y, Y1, 0.3, LOW[0], BLUE)
        # Over the arches, below the windows.
        for a in (AXLE_F, AXLE_R):
            if not any(d0 < a + ARCH and d1 > a - ARCH for d0, d1 in doors):
                side(x, a - ARCH, a + ARCH, 2 * WHEEL_R + 0.08, LOW[0], BLUE)
            b.box((T * 0.6, 2 * ARCH, 0.04), Vector((sx * (HW - T), a, 2 * WHEEL_R + 0.06)), mat=ARCHM)
        # Between the decks and above the upper windows: solid yellow, full length.
        side(x, Y0 + 0.4, Y1, LOW[1], UP[0], YELLOW)
        side(x, Y0 + 0.4, Y1, UP[1], ROOF_Z, YELLOW)
        # Window pillars (the black band look), skipping the door openings on the lower deck.
        for z0, z1, deck in ((LOW[0], LOW[1], "low"), (UP[0], UP[1], "up")):
            ys = [Y0 + 0.4 + i * 1.32 for i in range(9)] + [Y1 - 0.06]
            for py in ys:
                if deck == "low" and any(d0 - 0.06 < py < d1 + 0.06 for d0, d1 in doors):
                    continue
                side(sx * (HW - T / 2 + 0.004), py - 0.05, py + 0.05, z0, z1, BLACK)
            side(sx * (HW - T / 2 + 0.004), Y0 + 0.4, Y1, z0 - 0.04, z0, BLACK)
            side(sx * (HW - T / 2 + 0.004), Y0 + 0.4, Y1, z1, z1 + 0.04, BLACK)
        # Door frames.
        for d0, d1 in doors:
            for py in (d0, d1):
                side(x, py - 0.04, py + 0.04, 0.3, LOW[1], BLACK)
            side(x, d0, d1, LOW[1] - 0.06, LOW[1], BLACK)

    # Front: bumper and lower panel, black frames round the windscreens and the destination display.
    fy = Y0 + 0.2
    b.box((W, 0.4, 0.22), Vector((0, fy, 0.41)), mat=BUMPER)
    b.box((W, 0.4, 0.5), Vector((0, fy, 0.77)), mat=YELLOW)
    b.box((W, 0.4, 0.06), Vector((0, fy, 1.0)), mat=BLACK)
    b.box((W, 0.4, 0.42), Vector((0, fy, 2.39)), mat=BLACK)  # destination display surround
    for sx in (1, -1):
        b.box((0.08, 0.4, ROOF_Z - 1.0), Vector((sx * (HW - 0.04), fy, (ROOF_Z + 1.0) / 2)), mat=BLACK)
        b.box((T, 0.3, 1.15 - 0.3), Vector((sx * (HW - T / 2), Y0 + 0.25, 0.72)), mat=YELLOW)
    b.box((W, 0.4, 0.1), Vector((0, fy, ROOF_Z - 0.05)), mat=BLACK)
    # Rear: solid, engine grille low down, a small upper rear window.
    ry = Y1 - T / 2
    b.box((W, T, 1.15 - 0.3), Vector((0, ry, 0.72)), mat=BLUE)
    b.box((W, T, 3.0 - 1.15), Vector((0, ry, 2.075)), mat=YELLOW)
    b.box((W, T, ROOF_Z - 3.8), Vector((0, ry, (ROOF_Z + 3.8) / 2)), mat=YELLOW)
    for sx in (1, -1):
        b.box((HW - 0.8, T, 0.8), Vector((sx * (0.8 + (HW - 0.8) / 2), ry, 3.4)), mat=YELLOW)
    b.box((1.6, 0.02, 0.84), Vector((0, Y1 - 0.01, 3.4)), mat=BLACK)
    b.box((1.8, 0.03, 0.45), Vector((0, Y1 + 0.005, 0.62)), mat=ARCHM)  # engine grille
    b.box((W, 0.25, 0.22), Vector((0, Y1 - 0.12, 0.41)), mat=BUMPER)
    # Roof, rounded along its edges.
    roof = b.box((W, L - 0.02, H - ROOF_Z), Vector((0, 0.01, (ROOF_Z + H) / 2)), mat=YELLOW)
    edges = {e for f in roof for e in f.edges if all(v.co.z > H - 0.01 for v in e.verts)}
    sf.bmesh.ops.bevel(b.bm, geom=list(edges), offset=0.22, segments=4, affect="EDGES", profile=0.5, clamp_overlap=True)
    # Floors (the upper deck's also closes the gap between the decks).
    b.box((W - 2 * T, L - 0.5, 0.06), Vector((0, 0.2, FLOOR - 0.03)), mat=BUMPER)
    b.box((W - 2 * T, L - 0.5, 0.2), Vector((0, 0.2, DECK - 0.1)), mat=BUMPER)
    b.finish(sharp_deg=40)

    # Glass: both decks each side (with the door openings), the windscreens, the doors.
    g = sf.Mesh("Glass", [glass])
    for sx in (1, -1):
        x = sx * (HW - T - 0.01)
        spans = [(Y0 + 0.4, Y1 - 0.05)]
        if sx > 0:
            spans = [(Y0 + 0.4, DOOR_F[0]), (DOOR_F[1], DOOR_M[0]), (DOOR_M[1], Y1 - 0.05)]
        for y0, y1 in spans:
            g.box((0.012, y1 - y0, LOW[1] - LOW[0]), Vector((x, (y0 + y1) / 2, sum(LOW) / 2)))
        g.box((0.012, Y1 - 0.05 - Y0 - 0.4, UP[1] - UP[0]), Vector((x, (Y0 + 0.4 + Y1 - 0.05) / 2, sum(UP) / 2)))
        if sx > 0:
            for d0, d1 in (DOOR_F, DOOR_M):
                g.box((0.012, d1 - d0 - 0.08, LOW[1] - 0.4), Vector((sx * (HW - 0.06), (d0 + d1) / 2, (LOW[1] + 0.4) / 2)))
    g.box((W - 0.16, 0.012, 2.15 - 1.06), Vector((0, Y0 + 0.02, (2.15 + 1.06) / 2)))  # lower windscreen
    g.box((W - 0.16, 0.012, 4.07 - 2.62), Vector((0, Y0 + 0.02, (4.07 + 2.62) / 2)))  # upper front window
    g.finish()

    # Destination display: its own material so the game can draw route text on it.
    d = sf.Mesh("DestinationBlind", [sf.material("DestinationBlind", 0x050505, rough=0.35)])
    d.box((1.9, 0.01, 0.3), Vector((0, Y0 - 0.006, 2.39)))
    d.finish()

    # Interior: pairs of seats on both decks, the driver's seat and wheel (right-hand drive, -X).
    seat = sf.painted("SeatFabric", 0x23336B, rough=0.9)
    frame = sf.material("SeatFrame", 0x8D9196, rough=0.4, metal=0.8)
    inside = sf.Mesh("Interior", [seat, frame])

    def seats(z, y0, y1, skip=()):
        y = y0
        while y < y1:
            if not any(s0 < y < s1 for s0, s1 in skip):
                for sx in (1, -1):
                    cx = sx * (HW - 0.55)
                    inside.box((0.9, 0.44, 0.1), Vector((cx, y, z + 0.44)))
                    inside.box((0.9, 0.08, 0.55), Vector((cx, y + 0.24, z + 0.75)), rot=Matrix.Rotation(math.radians(-8), 4, "X"))
                    inside.box((0.06, 0.06, 0.4), Vector((cx, y, z + 0.2)), mat=1)
            y += 0.8

    seats(FLOOR, 1.6, Y1 - 0.6)
    seats(FLOOR, -0.9, 0.0)
    seats(DECK, Y0 + 1.0, Y1 - 0.6, skip=((-2.0, -0.9),))  # the stairs come up near the front
    inside.box((0.5, 0.5, 0.12), Vector((-HW + 0.6, Y0 + 1.1, FLOOR + 0.5)))
    inside.box((0.5, 0.1, 0.6), Vector((-HW + 0.6, Y0 + 1.38, FLOOR + 0.85)))
    inside.tube((-HW + 0.6, Y0 + 0.75, FLOOR + 1.0), (-HW + 0.6, Y0 + 0.72, FLOOR + 1.04), 0.24, seg=16, mat=1)
    inside.box((0.9, 1.1, 0.3), Vector((0.75, -1.45, (FLOOR + DECK) / 2)), rot=Matrix.Rotation(math.radians(-55), 4, "X"), mat=1)  # stairs
    inside.finish()

    # Lights, named as for the car.
    head = sf.Mesh("Headlights", [sf.material("Headlight", 0xF4F6F8, rough=0.1)])
    brake = sf.Mesh("Brakelights", [sf.material("Brakelight", 0x9A0C0C, rough=0.15)])
    rev = sf.Mesh("Reverselights", [sf.material("Reverselight", 0xF2F2F2, rough=0.15)])
    for sx in (1, -1):
        head.box((0.34, 0.03, 0.14), Vector((sx * (HW - 0.32), Y0 + 0.005, 0.66)))
        brake.box((0.12, 0.03, 0.5), Vector((sx * (HW - 0.12), Y1 + 0.01, 1.25)))
        rev.box((0.12, 0.03, 0.12), Vector((sx * (HW - 0.12), Y1 + 0.01, 0.88)))
    brake.box((0.5, 0.03, 0.05), Vector((0, Y1 + 0.01, ROOF_Z - 0.12)))  # high-level stop light
    for m in (head, brake, rev):
        m.finish()
    amber = sf.material("Signallight", 0xD8820F, rough=0.15)
    for name, sx, front in (("IndicatorFL", 1, True), ("IndicatorFR", -1, True), ("IndicatorRL", 1, False), ("IndicatorRR", -1, False)):
        ind = sf.Mesh(name, [amber])
        if front:
            ind.box((0.16, 0.03, 0.08), Vector((sx * (HW - 0.1), Y0 + 0.005, 0.86)))
            ind.box((0.03, 0.12, 0.06), Vector((sx * (HW + 0.005), Y0 + 0.8, 0.75)))  # side repeater
        else:
            ind.box((0.12, 0.03, 0.14), Vector((sx * (HW - 0.12), Y1 + 0.01, 1.62)))
        ind.finish()

    # "Ram's horn" mirrors hanging from the front roof corners (outside the 2.55 m body width).
    mir = sf.Mesh("Mirrors", [black, sf.material("MirrorGlass", 0xB8C4CC, rough=0.02, metal=1.0)])
    for sx in (1, -1):
        mir.tube((sx * (HW - 0.1), Y0 + 0.15, 3.95), (sx * (HW + 0.12), Y0 - 0.2, 3.7), 0.025, seg=8)
        mir.tube((sx * (HW + 0.12), Y0 - 0.2, 3.7), (sx * (HW + 0.18), Y0 - 0.32, 2.75), 0.025, seg=8)
        mir.box((0.22, 0.08, 0.42), Vector((sx * (HW + 0.18), Y0 - 0.32, 2.55)))
        mir.box((0.19, 0.01, 0.38), Vector((sx * (HW + 0.18), Y0 - 0.275, 2.55)), mat=1)
    mir.finish()

    # Wheels: pivot at the centre, axle along X. Front singles, rear duals.
    tyre = sf.painted("Tyre", 0x161616, rough=0.9)
    rim = sf.material("Rim", 0xA4A9AE, rough=0.35, metal=1.0)
    hub = sf.painted("Hub", 0x2A2C2F, rough=0.5)
    for name, y, x, w in (("WheelFL", AXLE_F, HW - 0.17, 0.3), ("WheelFR", AXLE_F, -(HW - 0.17), 0.3),
                          ("WheelRL", AXLE_R, HW - 0.32, 0.58), ("WheelRR", AXLE_R, -(HW - 0.32), 0.58)):
        hw = w / 2
        out = 1 if x > 0 else -1  # rim face toward the outside
        prof = [(0.0, -hw * out + 0.02 * out, 2), (0.11, -hw * out + 0.02 * out, 1), (0.3, -hw * out + 0.05 * out, 0),
                (0.33, -hw * out, 0), (0.46, -hw * out, 0), (WHEEL_R, -hw * out + 0.07 * out, 0),
                (WHEEL_R, hw * out - 0.07 * out, 0), (0.46, hw * out, 0), (0.33, hw * out, 1),
                (0.3, hw * out - 0.05 * out, 1), (0.0, hw * out - 0.05 * out, 1)]
        wm = sf.Mesh(name, [tyre, rim, hub])
        wm.lathe(prof, seg=28, xform=Matrix.Rotation(math.radians(90), 4, "Y"))
        obj = wm.finish(sharp_deg=50)
        obj.location = (x, y, WHEEL_R)
    return (W, L, H)


def build():
    sf.reset()
    want = bus()
    objs = list(bpy.context.scene.objects)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    # Scale and rotation applied everywhere; location too, except the wheels (pivot at the wheel centre).
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    for o in objs:
        o.select_set(not o.name.startswith("Wheel"))
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    body = [o for o in objs if o.name != "Mirrors"]
    lo, hi = sf.bounds(body)
    size = hi - lo
    tris = sf.triangles(objs)
    ok = all(abs(size[i] - want[i]) <= max(0.02, 0.03 * want[i]) for i in range(3))
    path = os.path.join(sf.MODELS, "bus_dublin_dd.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_yup=True, export_extras=True,
                              export_materials="EXPORT", export_image_format="AUTO",
                              export_draco_mesh_compression_enable=False, use_selection=False)
    print(f"RESULT bus_dublin_dd: body {size.x:.3f} x {size.y:.3f} x {size.z:.3f} m (spec {want}) "
          f"{'OK' if ok else 'MISMATCH'}; min z {lo.z:.3f}; tris {tris}/60000 {'OK' if tris <= 60000 else 'OVER'}; "
          f"nodes {sorted(o.name for o in objs)}")
    lo, hi = sf.bounds(objs)
    sf.preview("bus_dublin_dd", lo, hi, view=(0.75, -1.0, 0.3))


build()
