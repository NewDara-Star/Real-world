"""Build the service vehicles (bin lorry, postal van, service truck, tow truck, taxi) from a CC-BY base.

Headless: blender -b --factory-startup --python tools/assets/build_service_vehicles.py -- <pack scene.gltf> [name ...]
Base: "Generic civil service vehicles pack" by Comrade1280 (Sketchfab, CC-BY-4.0),
the same author and style as the traffic cars. Its wheels are part of each
body mesh, so they're found by shape (a tyre: a loose part as tall as it is
long, standing on the ground; every loose part centred on it is that wheel's
rim and hub), cut out, and named WheelFL/FR/RL/RR (rear duals and further
axles join the nearest rear wheel). Decals (lettering) are removed. Then as
for the cars: facing -Y on the ground midway between the axles, real length,
lights split into the game's materials, paint made tintable where it can be.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_street_furniture as sf  # noqa: E402  (shared Blender helpers)
from build_traffic_cars import neutralise_paint, set_origin_to_centre, split_lights  # noqa: E402

# file: (pack object, real length m, what it is). Flip: faces +Y once straightened (from the previews).
VEHICLES = {
    "car_service_van": ("postvan", 5.3, "postal / panel van"),
    "car_service_bin_lorry": ("garbage_truck", 9.4, "bin lorry"),
    "car_service_truck": ("rdservtruck", 6.6, "service truck"),
    "car_service_tow": ("towtruck", 7.2, "tow truck"),
    "car_service_taxi": ("taxi", 4.7, "taxi"),
}
FLIP = {"car_service_van", "car_service_bin_lorry", "car_service_truck", "car_service_taxi"}


def loose_parts(bm):
    """Connected vertex sets of a bmesh, each as (verts, bounding min, max)."""
    seen, parts = set(), []
    for v in bm.verts:
        if v.index in seen:
            continue
        stack, comp = [v], []
        seen.add(v.index)
        while stack:
            a = stack.pop()
            comp.append(a)
            for e in a.link_edges:
                b = e.other_vert(a)
                if b.index not in seen:
                    seen.add(b.index)
                    stack.append(b)
        lo = Vector([min(c.co[i] for c in comp) for i in range(3)])
        hi = Vector([max(c.co[i] for c in comp) for i in range(3)])
        parts.append((comp, lo, hi))
    return parts


def cut_wheels(body):
    """Cut the wheels out of the body mesh: returns one new object per tyre (rims and hubs joined in)."""
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.verts.ensure_lookup_table()
    parts = loose_parts(bm)
    zmin = min(v.co.z for v in bm.verts)
    tyres = []
    for comp, lo, hi in parts:
        s = hi - lo
        horiz = max(s.x, s.y)
        # As tall as it is long in side view, on the ground, wheel-sized.
        if lo.z - zmin < 0.05 and 0.5 < s.z < 1.4 and abs(horiz - s.z) < 0.25 * s.z:
            c, r = (lo + hi) / 2, s.z / 2
            # A wheel's tyre and its rim rings can all pass: one tyre per centre, the largest.
            same = next((i for i, (tc, tr) in enumerate(tyres) if (c - tc).length < max(r, tr) * 0.9), None)
            if same is None:
                tyres.append((c, r))
            elif r > tyres[same][1]:
                tyres[same] = (c, r)
    groups = {i: [] for i in range(len(tyres))}
    for comp, lo, hi in parts:
        c = (lo + hi) / 2
        for i, (tc, r) in enumerate(tyres):
            if (Vector((c.x, c.y)) - Vector((tc.x, tc.y))).length < r * 0.9 and abs(c.z - tc.z) < r * 0.4 and (hi - lo).z <= 2 * r + 0.05:
                groups[i].append(comp)
                break
    wheels = []
    for i, comps in groups.items():
        if not comps:
            continue
        keep = {v.index for comp in comps for v in comp}
        w = body.copy()
        w.data = body.data.copy()
        bpy.context.scene.collection.objects.link(w)
        wb = bmesh.new()
        wb.from_mesh(w.data)
        wb.verts.ensure_lookup_table()
        bmesh.ops.delete(wb, geom=[v for v in wb.verts if v.index not in keep], context="VERTS")
        wb.to_mesh(w.data)
        wb.free()
        w.name = f"wheel_{i}"
        wheels.append(w)
    cut = {v.index for comps in groups.values() for comp in comps for v in comp}
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.index in cut], context="VERTS")
    bm.to_mesh(body.data)
    bm.free()
    return wheels


def centre(o):
    return sum((o.matrix_world @ v.co for v in o.data.vertices), Vector()) / len(o.data.vertices)


def build(name, pack):
    obj_name, length, what = VEHICLES[name]
    sf.reset()
    bpy.ops.import_scene.gltf(filepath=pack)
    root = bpy.data.objects[obj_name]
    meshes = [o for o in [root] + list(root.children_recursive) if o.type == "MESH"]
    for o in list(bpy.data.objects):
        if o not in meshes:
            bpy.data.objects.remove(o, do_unlink=True)
    for o in meshes:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.make_single_user(object=True, obdata=True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    by_mat = {}
    for o in meshes:
        n = o.data.materials[0].name.lower()
        kind = "decal" if "decal" in n else "glass" if "glass" in n else "optics" if "optics" in n else "body"
        by_mat.setdefault(kind, []).append(o)
    for o in by_mat.pop("decal", []):  # lettering: unbranded vehicles carry none
        bpy.data.objects.remove(o, do_unlink=True)
    body = max(by_mat["body"], key=lambda o: len(o.data.polygons))
    wheels = cut_wheels(body)
    objs = by_mat["body"] + by_mat.get("glass", []) + by_mat.get("optics", []) + wheels
    # Straighten on the tyre centres (principal axis in plan), ground at z=0, origin midway between the axles.
    wc = [centre(w) for w in wheels]
    mx, my = sum(c.x for c in wc) / len(wc), sum(c.y for c in wc) / len(wc)
    sxx = sum((c.x - mx) ** 2 for c in wc); syy = sum((c.y - my) ** 2 for c in wc); sxy = sum((c.x - mx) * (c.y - my) for c in wc)
    ang = 0.5 * math.atan2(2 * sxy, sxx - syy)
    zmin = min((o.matrix_world @ v.co).z for o in objs for v in o.data.vertices)
    m = Matrix.Rotation(math.pi / 2 - ang, 4, "Z") @ Matrix.Translation((-mx, -my, -zmin))
    for o in objs:
        o.data.transform(m)
    bpy.context.view_layer.update()
    lo, hi = sf.bounds(objs)
    k = length / (hi - lo).y
    m = Matrix.Diagonal((k, k, k, 1))
    if name in FLIP:
        m = Matrix.Rotation(math.pi, 4, "Z") @ m
    for o in objs:
        o.data.transform(m)
    bpy.context.view_layer.update()
    wc = [centre(w) for w in wheels]
    ys = sorted(c.y for c in wc)
    mid = Vector((0, (ys[0] + ys[-1]) / 2, 0))
    for o in objs:
        o.data.transform(Matrix.Translation(-mid))
    bpy.context.view_layer.update()
    # Name the wheels by corner; the front axle is the most forward (-Y); everything behind it is rear.
    wc = [centre(w) for w in wheels]
    front_y = min(c.y for c in wc)
    named = {}
    for w, c in zip(wheels, wc):
        key = ("F" if c.y < front_y + 0.5 else "R") + ("L" if c.x > 0 else "R")
        named.setdefault(key, []).append(w)
    out_wheels = []
    for key, ws in named.items():
        for o in bpy.data.objects:
            o.select_set(False)
        for w in ws:
            w.select_set(True)
        bpy.context.view_layer.objects.active = ws[0]
        if len(ws) > 1:
            bpy.ops.object.join()
        w = bpy.context.view_layer.objects.active
        w.name = "Wheel" + key
        set_origin_to_centre(w)
        out_wheels.append(w)
    # Joining removed the extra wheel objects; count what's left.
    objs = by_mat["body"] + by_mat.get("glass", []) + by_mat.get("optics", []) + out_wheels
    lo, hi = sf.bounds(objs)
    half_w = (hi - lo).x / 2
    body.name = "Body"
    body.data.materials[0].name = "CarBody"
    painted = neutralise_paint(body.data.materials[0])
    for i, o in enumerate(by_mat.get("glass", [])):
        o.name = "Glass" if i == 0 else f"Glass{i}"
        o.data.materials[0].name = "Glass"
    for o in by_mat.get("optics", []):
        split_lights(o, half_w, name)
    final = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    tris = sf.triangles(final)
    lo, hi = sf.bounds(final)
    size = hi - lo
    path = os.path.join(sf.MODELS, f"{name}.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_yup=True, export_extras=True,
                              export_materials="EXPORT", export_image_format="JPEG", export_jpeg_quality=85,
                              export_draco_mesh_compression_enable=False, use_selection=False)
    print(f"RESULT {name} ({what}): {size.x:.2f} x {size.y:.2f} x {size.z:.2f} m; tris {tris}; wheels {sorted(named)} "
          f"from {len(wheels)} tyres; {os.path.getsize(path) / 1024:.0f} KB; paint {'tintable' if painted else 'fixed'}")
    sf.preview(name, lo, hi, view=(0.9, -1.0, 0.45))


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    pack, names = argv[0], argv[1:] or list(VEHICLES)
    for n in names:
        build(n, pack)


if __name__ == "__main__":
    main()
