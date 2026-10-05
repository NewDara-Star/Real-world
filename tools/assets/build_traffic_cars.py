"""Build car_traffic_1..5.glb (docs/blender-assets.md, section 3) from a CC-BY base.

Headless: blender -b --factory-startup --python tools/assets/build_traffic_cars.py -- <pack scene.gltf> [n ...]
Base: "Generic passenger car pack" by Comrade1280 (Sketchfab, CC-BY-4.0): ten
unbranded cars with separate wheels. The owner downloads the glTF zip (Sketchfab
needs a login) and the script reads its scene.gltf. For each class it takes one
body and the four wheels nearest it, turns it to face -Y (glTF +Z) on the
ground at the origin midway between the axles, scales it to the real length of
its class, names the wheels WheelFL/FR/RL/RR with their pivots at the wheel
centres, and splits the pack's single "Optics" material into the game's light
materials (Headlight, Brakelight, Reverselight, Signallight on
IndicatorFL/FR/RL/RR). Small panel van: the pack has none, so the minivan's
side and rear glass behind the front doors is painted body colour.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_street_furniture as sf  # noqa: E402  (shared Blender helpers)
from paintmask import paint_mask  # noqa: E402  (pure NumPy, tested in game/tests/paintmask.test.mts)

# n: (pack body object, real length m, class)
CLASSES = {
    1: ("Hatchback Body", 4.05, "small hatchback"),
    2: ("Sedan Body", 4.63, "saloon"),
    3: ("Wagon Body", 4.69, "estate"),
    4: ("SUV Body", 4.43, "compact SUV"),
    5: ("minivan body", 4.50, "small panel van"),
}
# Classes whose body faces +Y once straightened (seen in the previews: their backs face the camera).
FLIP = {1, 2, 5}


def import_pack(path):
    sf.reset()
    bpy.ops.import_scene.gltf(filepath=path)
    for o in bpy.data.objects:
        o.select_set(False)


def world_points(objs):
    return [o.matrix_world @ v.co for o in objs for v in o.data.vertices]


def take_car(body_name):
    """The body's meshes and the four wheels nearest it; everything else deleted. Parents cleared, transforms kept."""
    body = bpy.data.objects[body_name]
    parts = [body] + [c for c in body.children_recursive]
    meshes = [o for o in parts if o.type == "MESH"]
    pts = world_points(meshes)
    centre = sum(pts, Vector()) / len(pts)
    # Each wheel is a group (the top-most object whose name starts "Wheel"), with its meshes below.
    def group(o):
        while o.parent is not None and o.parent.name.startswith("Wheel"):
            o = o.parent
        return o
    groups = {group(o) for o in bpy.data.objects if o.name.startswith("Wheel")}
    wheels = []
    for g in groups:
        ms = [m for m in [g] + list(g.children_recursive) if m.type == "MESH"]
        if not ms:
            continue
        wp = world_points(ms)
        wc = sum(wp, Vector()) / len(wp)
        wheels.append(((wc - centre).length, g, ms))
    wheels.sort(key=lambda w: w[0])
    wheel_meshes = [m for _, _, ms in wheels[:4] for m in ms]
    keep = set(meshes) | set(wheel_meshes)
    for o in list(bpy.data.objects):
        if o not in keep:
            bpy.data.objects.remove(o, do_unlink=True)
    for o in keep:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
    # One object per wheel (some carry a hub cap as a second mesh: joined in).
    joined = []
    for _, _, ms in wheels[:4]:
        for o in bpy.data.objects:
            o.select_set(False)
        for m in ms:
            m.select_set(True)
        bpy.context.view_layer.objects.active = ms[0]
        if len(ms) > 1:
            bpy.ops.object.join()
        joined.append(bpy.context.view_layer.objects.active)
    return meshes, joined


def straighten(meshes, wheels):
    """Turn the car so its length runs along Y, wheels on the ground at z=0, origin midway between the axles."""
    allobjs = meshes + wheels
    for o in allobjs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = allobjs[0]
    # The pack's four wheels share one mesh: give each object its own before editing.
    bpy.ops.object.make_single_user(object=True, obdata=True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # Length direction: the principal axis of the four wheel centres in plan (axles are the long way apart).
    wc = [sum((w.matrix_world @ v.co for v in w.data.vertices), Vector()) / len(w.data.vertices) for w in wheels]
    mx = sum(c.x for c in wc) / 4
    my = sum(c.y for c in wc) / 4
    sxx = sum((c.x - mx) ** 2 for c in wc); syy = sum((c.y - my) ** 2 for c in wc); sxy = sum((c.x - mx) * (c.y - my) for c in wc)
    ang = 0.5 * math.atan2(2 * sxy, sxx - syy)  # angle of the major axis from +X
    rot = Matrix.Rotation(math.pi / 2 - ang, 4, "Z")  # major axis -> +Y
    pts = world_points(allobjs)
    zmin = min(p.z for p in pts)
    m = rot @ Matrix.Translation((-mx, -my, -zmin))
    for o in allobjs:
        o.data.transform(m)
        o.data.update()
    bpy.context.view_layer.update()  # refresh cached bounds


def set_origin_to_centre(o):
    pts = [v.co for v in o.data.vertices]
    lo = Vector([min(p[i] for p in pts) for i in range(3)])
    hi = Vector([max(p[i] for p in pts) for i in range(3)])
    c = (lo + hi) / 2
    o.data.transform(Matrix.Translation(-c))
    o.location = c


def mean_colour(mat):
    """Linear mean of a material's base-colour texture (or its factor), for painting over glass."""
    node = next((n for n in mat.node_tree.nodes if n.type == "TEX_IMAGE"), None)
    if not node or not node.image:
        return tuple(mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value)
    import numpy as np
    px = np.empty(len(node.image.pixels), dtype=np.float32)
    node.image.pixels.foreach_get(px)
    rgb = px.reshape(-1, 4)[:, :3].mean(axis=0)
    return (*[v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in rgb], 1.0)


def neutralise_paint(mat):
    """Turn the paint in a body texture light grey (shading kept) so the game can tint each car by
    instance colour (paintmask.py finds the paint; trim, grilles, rubber and chrome are left alone).
    Returns False, leaving the material "CarBody" and untinted, when there's no image or the paint
    can't be separated."""
    import numpy as np
    node = next((n for n in mat.node_tree.nodes if n.type == "TEX_IMAGE"), None)
    if not node or not node.image:
        return False
    img = node.image
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(-1, 4)
    rgb = px[:, :3]
    paint = paint_mask(rgb)
    if paint is None:
        return False
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    ref = np.percentile(lum[paint], 90)
    grey = np.clip(lum / max(ref, 1e-3) * 0.85, 0, 1)
    rgb[paint] = grey[paint, None]
    px[:, :3] = rgb
    img.pixels.foreach_set(px.ravel())
    img.update()
    mat.name = "CarPaint"
    return True


def split_lights(optics, half_w, n):
    """The pack's one "Optics" mesh becomes the game's lights: Headlights and IndicatorFL/FR at the
    front, Brakelights, Reverselights and IndicatorRL/RR at the rear. Left = +X."""
    mats = {k: sf.material(k, c, rough=0.15) for k, c in (("Headlight", 0xF4F6F8), ("Brakelight", 0x9A0C0C),
                                                       ("Reverselight", 0xF2F2F2), ("Signallight", 0xD8820F))}
    bm = bmesh.new()
    bm.from_mesh(optics.data)
    cs = [f.calc_center_median() for f in bm.faces]
    front_x = max((abs(c.x) for c in cs if c.y < 0), default=half_w)
    rear_z = [c.z for c in cs if c.y >= 0] or [0, 1]
    zlo, zhi = min(rear_z), max(rear_z)
    parts = {k: [] for k in ("Headlights", "Brakelights", "Reverselights", "IndicatorFL", "IndicatorFR", "IndicatorRL", "IndicatorRR")}
    for f, c in zip(bm.faces, cs):
        side = "L" if c.x > 0 else "R"
        if c.y < 0:
            # Front: the outermost slice of each cluster is the indicator.
            parts[f"IndicatorF{side}" if abs(c.x) > 0.88 * front_x else "Headlights"].append(f.index)
        else:
            # Rear, by height in the cluster: indicator on top, reversing light at the bottom, brake between.
            t = (c.z - zlo) / max(1e-6, zhi - zlo)
            parts[f"IndicatorR{side}" if t > 0.7 else "Reverselights" if t < 0.25 else "Brakelights"].append(f.index)
    bm.free()
    out = []
    for name, faces in parts.items():
        if not faces:
            print(f"  car {n}: no faces for {name}")
            continue
        o = optics.copy()
        o.data = optics.data.copy()
        bpy.context.scene.collection.objects.link(o)
        keep = set(faces)
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in keep], context="FACES")
        bm.to_mesh(o.data)
        bm.free()
        mat = mats["Signallight" if name.startswith("Indicator") else name[:-1]]
        o.data.materials.clear()
        o.data.materials.append(mat)
        o.name = o.data.name = name
        out.append(o)
    bpy.data.objects.remove(optics, do_unlink=True)
    return out


def panel_van(glass, body_mat, length):
    """Paint the glass behind the front doors (sides and back) in the body's colour."""
    # Named CarPaint* so the game tints it with the rest of the paint.
    paint = sf.material("CarPaintPanel", 0xFFFFFF, rough=0.35, metal=0.1)
    paint.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = mean_colour(body_mat)
    glass.data.materials.append(paint)
    slot = len(glass.data.materials) - 1
    bm = bmesh.new()
    bm.from_mesh(glass.data)
    for f in bm.faces:
        c, nrm = f.calc_center_median(), f.normal
        if c.y > -0.12 * length and (abs(nrm.x) > 0.5 or nrm.y > 0.5):
            f.material_index = slot
    bm.to_mesh(glass.data)
    bm.free()


def build(n, pack):
    body_name, length, cls = CLASSES[n]
    import_pack(pack)
    meshes, wheels = take_car(body_name)
    straighten(meshes, wheels)
    allobjs = meshes + wheels
    lo, hi = sf.bounds(allobjs)
    k = length / (hi - lo).y
    m = Matrix.Diagonal((k, k, k, 1))
    if n in FLIP:
        m = Matrix.Rotation(math.pi, 4, "Z") @ m
    for o in allobjs:
        o.data.transform(m)
        o.data.update()
    bpy.context.view_layer.update()
    # Origin midway between the axles (on the ground already).
    wc = [sum((v.co for v in w.data.vertices), Vector()) / len(w.data.vertices) for w in wheels]
    mid = Vector(((max(c.x for c in wc) + min(c.x for c in wc)) / 2, (max(c.y for c in wc) + min(c.y for c in wc)) / 2, 0))
    for o in allobjs:
        o.data.transform(Matrix.Translation(-mid))
    bpy.context.view_layer.update()
    lo, hi = sf.bounds(allobjs)
    half_w = (hi - lo).x / 2
    # The pack names each car's materials Body*/Glass*/Optics*: pick the meshes by material.
    by_mat = {o.data.materials[0].name.split("_")[0]: o for o in meshes}
    body, glass, optics = by_mat["Body"], by_mat["Glass"], by_mat["Optics"]
    body.name, glass.name = "Body", "Glass"
    # The game tints "CarPaint" per car; a body whose paint can't be separated (black) stays "CarBody".
    body.data.materials[0].name = "CarBody"
    painted = neutralise_paint(body.data.materials[0])
    glass.data.materials[0].name = "Glass"
    if n == 5:
        panel_van(glass, body.data.materials[0], length)
    lights = split_lights(optics, half_w, n)
    for w in wheels:
        c = sum((v.co for v in w.data.vertices), Vector()) / len(w.data.vertices)
        w.name = "Wheel" + ("F" if c.y < 0 else "R") + ("L" if c.x > 0 else "R")
        set_origin_to_centre(w)
    objs = [body, glass] + lights + wheels
    tris = sf.triangles(objs)
    lo, hi = sf.bounds(objs)
    size = hi - lo
    path = os.path.join(sf.MODELS, f"car_traffic_{n}.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_yup=True, export_extras=True,
                              export_materials="EXPORT", export_image_format="JPEG", export_jpeg_quality=85,
                              export_draco_mesh_compression_enable=False, use_selection=False)
    print(f"RESULT car_traffic_{n} ({cls}): {size.x:.2f} x {size.y:.2f} x {size.z:.2f} m; tris {tris}/25000 "
          f"{'OK' if tris <= 25000 else 'OVER'}; nodes {sorted(o.name for o in objs)}; "
          f"{os.path.getsize(path) / 1024:.0f} KB; paint {'tintable' if painted else 'fixed'}")
    sf.preview(f"car_traffic_{n}", lo, hi, view=(0.9, -1.0, 0.45))


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    pack, nums = argv[0], [int(a) for a in argv[1:]] or list(CLASSES)
    for n in nums:
        build(n, pack)


if __name__ == "__main__":
    main()
