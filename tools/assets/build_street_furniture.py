"""Build the Finglas street furniture (docs/blender-assets.md, section 4) in Blender.

Headless: blender -b --factory-startup --python tools/assets/build_street_furniture.py -- [name ...]
With no names it builds every asset, but Blender 5.1 can segfault after several
factory resets and renders in one process, so prefer one asset per run:
  for a in lamp_post_led wheelie_bin ...; do blender -b ... -- $a; done
Each one is modelled in metres (Blender Z up,
front facing -Y), exported to game/public/models/<name>.glb and rendered to
reference/<name>/preview.png. Textured surfaces name a CC0 set already in
game/public/tex/ (material extras.surface) instead of embedding it.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MODELS = os.path.join(ROOT, "game", "public", "models")
TEX = os.path.join(ROOT, "game", "public", "tex")
REF = os.path.join(ROOT, "reference")


def srgb(c):
    """sRGB 0-255 hex to linear floats."""
    def lin(v):
        v /= 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return (lin(c >> 16 & 255), lin(c >> 8 & 255), lin(c & 255), 1.0)


# ---------------------------------------------------------------- materials

def material(name, color=0x808080, rough=0.5, metal=0.0, alpha=1.0, surface=None):
    """Principled BSDF. surface = a texture role in public/tex (brick, render, concrete...).
    Those textures are not embedded: the material gets extras.surface = <role> and the
    game draws it from its own atlas. As in glTF, the base colour multiplies that
    texture, so it stays white: the texture alone sets the colour (a plain glTF viewer,
    with no atlas, shows these surfaces white)."""
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (1.0, 1.0, 1.0, 1.0) if surface else srgb(color)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
        m.surface_render_method = "BLENDED"
    if surface:
        m["surface"] = surface
    return m


def variants(obj, slot, options):
    """KHR_materials_variants: options = [(variant name, material)], first is the default."""
    bpy.context.preferences.addons["io_scene_gltf2"].preferences.KHR_materials_variants_ui = True
    scene_vars = bpy.data.scenes[0].gltf2_KHR_materials_variants_variants
    for vname, mat in options:
        idx = next((v.variant_idx for v in scene_vars if v.name == vname), None)
        if idx is None:
            v = scene_vars.add()
            v.variant_idx = len(scene_vars) - 1  # before the name: its update hook reads the index
            v.name = vname
            idx = v.variant_idx
        d = obj.data.gltf2_variant_mesh_data.add()
        d.material_slot_index, d.material = slot, mat
        d.variants.add().variant.variant_idx = idx
    obj.material_slots[slot].material = options[0][1]


# ---------------------------------------------------------------- geometry
# Each builder appends to a bmesh and tags its new faces with a material index.

class Mesh:
    def __init__(self, name, mats):
        self.name, self.mats, self.bm = name, mats, bmesh.new()

    def _tag(self, before, mat):
        new = [f for f in self.bm.faces if f not in before]
        for f in new:
            f.material_index = mat
        return new

    def box(self, size, at, mat=0, rot=None):
        before = set(self.bm.faces)
        m = Matrix.Translation(at) @ (rot or Matrix()) @ Matrix.Diagonal((*size, 1))
        bmesh.ops.create_cube(self.bm, size=1, matrix=m)
        return self._tag(before, mat)

    def tube(self, a, b, r1, r2=None, seg=16, mat=0, caps=True):
        """Cylinder or cone from point a to point b."""
        a, b = Vector(a), Vector(b)
        d = b - a
        rot = d.to_track_quat("Z", "Y").to_matrix().to_4x4()
        before = set(self.bm.faces)
        bmesh.ops.create_cone(self.bm, cap_ends=caps, segments=seg, radius1=r1,
                              radius2=r1 if r2 is None else r2, depth=d.length,
                              matrix=Matrix.Translation((a + b) / 2) @ rot)
        return self._tag(before, mat)

    def lathe(self, profile, seg=24, xform=None):
        """Surface of revolution about Z. profile = [(r, z, mat)], mat applies to the
        band from that point to the next; r == 0 closes to a pole."""
        xform = xform or Matrix()
        rings = []
        for r, z, _ in profile:
            if r == 0:
                rings.append([self.bm.verts.new(xform @ Vector((0, 0, z)))])
            else:
                rings.append([self.bm.verts.new(xform @ Vector((r * math.cos(2 * math.pi * i / seg),
                                                                 r * math.sin(2 * math.pi * i / seg), z)))
                              for i in range(seg)])
        for k in range(len(rings) - 1):
            lo, hi, mat = rings[k], rings[k + 1], profile[k][2]
            for i in range(seg):
                j = (i + 1) % seg
                if len(lo) == 1:
                    vs = (lo[0], hi[j], hi[i])
                elif len(hi) == 1:
                    vs = (lo[i], lo[j], hi[0])
                else:
                    vs = (lo[i], lo[j], hi[j], hi[i])
                self.bm.faces.new(vs).material_index = mat
        if len(rings[0]) > 1:  # flat bottom cap
            self.bm.faces.new(list(reversed(rings[0]))).material_index = profile[0][2]

    def arc_shell(self, r_in, r_out, length, a0, a1, seg, at, mat=0):
        """Part-cylinder shell along -Y (a signal hood). Angles in degrees, 90 = up."""
        before = set(self.bm.faces)
        at = Vector(at)
        def ring(r, y):
            return [self.bm.verts.new(at + Vector((r * math.cos(math.radians(a)), y, r * math.sin(math.radians(a)))))
                    for a in [a0 + (a1 - a0) * i / seg for i in range(seg + 1)]]
        oi, oo = ring(r_in, 0), ring(r_out, 0)
        ei, eo = ring(r_in, -length), ring(r_out, -length)
        for i in range(seg):
            self.bm.faces.new((oo[i], oo[i + 1], eo[i + 1], eo[i]))
            self.bm.faces.new((ei[i], ei[i + 1], oi[i + 1], oi[i]))
            self.bm.faces.new((eo[i], eo[i + 1], ei[i + 1], ei[i]))
            self.bm.faces.new((oi[i], oi[i + 1], oo[i + 1], oo[i]))
        for e in (0, seg):
            self.bm.faces.new((oi[e], oo[e], eo[e], ei[e]) if e == 0 else (oo[e], oi[e], ei[e], eo[e]))
        return self._tag(before, mat)

    def bevel_vertical(self, faces, offset, segs=2):
        edges = {e for f in faces for e in f.edges
                 if abs((e.verts[0].co - e.verts[1].co).normalized().z) > 0.7}
        bmesh.ops.bevel(self.bm, geom=list(edges), offset=offset, segments=segs, affect="EDGES",
                        profile=0.5, clamp_overlap=True)

    def finish(self, uv_tile=1.0, sharp_deg=35):
        bm = self.bm
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        # World-space box UVs, uv_tile metres per texture repeat, so wall sections tile.
        uv = bm.loops.layers.uv.verify()
        for f in bm.faces:
            n = f.normal
            ax = max(range(3), key=lambda i: abs(n[i]))
            for l in f.loops:
                c = l.vert.co
                u, v = {0: (c.y, c.z), 1: (c.x, c.z), 2: (c.x, c.y)}[ax]
                if (ax == 0 and n.x < 0) or (ax == 1 and n.y > 0):
                    u = -u
                l[uv].uv = (u / uv_tile, v / uv_tile)
        for f in bm.faces:
            f.smooth = True
        for e in bm.edges:
            if len(e.link_faces) == 2 and e.calc_face_angle(0) > math.radians(sharp_deg):
                e.smooth = False
        me = bpy.data.meshes.new(self.name)
        bm.to_mesh(me)
        bm.free()
        for m in self.mats:
            me.materials.append(m)
        obj = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(obj)
        return obj


def empty(name, at):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.1
    e.location = at
    bpy.context.scene.collection.objects.link(e)
    return e


# ---------------------------------------------------------------- shared materials

def galvanised():
    return material("Galvanised", 0x8E9193, rough=0.45, metal=1.0)


def painted(name, color, rough=0.4):
    return material(name, color, rough=rough, metal=0.0)


# ---------------------------------------------------------------- assets
# Each returns the expected (width X, depth Y, height Z) in metres for the check.

def lamp_post_led():
    """Modern Dublin LED street lamp: 8 m galvanised taper pole, single upswept arm, flat LED lantern."""
    pole = Mesh("Pole", [galvanised()])
    pole.lathe([(0.084, 0.0, 0), (0.084, 0.9, 0), (0.076, 0.92, 0), (0.042, 7.9, 0),
                (0.042, 7.95, 0), (0.0, 7.97, 0)], seg=20)
    # Arm: short riser off the top then 1.1 m outreach toward the road, rising 5 degrees.
    pole.tube((0, 0, 7.7), (0, -0.25, 7.98), 0.03, seg=12)
    pole.tube((0, -0.25, 7.98), (0, -1.15, 8.06), 0.03, seg=12)
    pole.finish()
    body = Mesh("Lantern", [material("LampBody", 0x3B3E42, rough=0.5, metal=0.6)])
    tilt = Matrix.Rotation(math.radians(5), 4, "X")
    body.tube((0, -1.1, 8.055), (0, -1.25, 8.068), 0.038, seg=12)  # spigot sleeve
    f = body.box((0.30, 0.58, 0.07), Vector((0, -1.52, 8.08)), rot=tilt)
    body.bevel_vertical(f, 0.06, 3)
    body.finish()
    lens = Mesh("LampLens", [material("LampLens", 0xE8ECEF, rough=0.15)])
    lens.box((0.22, 0.42, 0.012), Vector((0, -1.54, 8.04)), rot=tilt)
    lens.finish()
    empty("LampHead", (0, -1.54, 8.025))
    return (0.30, 1.85, 8.13)


SIGNAL_MOUNT_Z = 2.5  # underside of the backboard above the footway


def traffic_signal_head():
    """Irish three-aspect head, 200 mm aspects, black body, black backboard with white border.
    Origin: the pole axis at the bottom of the backboard (mount it at the pole's HeadMount)."""
    black = painted("SignalBody", 0x15161A, rough=0.55)
    white = painted("BackboardBorder", 0xF2F2F0, rough=0.35)
    head = Mesh("SignalHead", [black, white, galvanised()])
    head.box((0.08, 0.07, 0.10), Vector((0, -0.09, 0.3)), mat=2)      # clamp brackets
    head.box((0.08, 0.07, 0.10), Vector((0, -0.09, 0.7)), mat=2)
    head.box((0.50, 0.012, 1.0), Vector((0, -0.131, 0.5)))           # backboard
    for sx, sz, x, z in ((0.5, 0.05, 0, 0.025), (0.5, 0.05, 0, 0.975),
                         (0.05, 0.9, -0.225, 0.5), (0.05, 0.9, 0.225, 0.5)):
        head.box((sx, 0.003, sz), Vector((x, -0.1385, z)), mat=1)
    f = head.box((0.27, 0.20, 0.80), Vector((0, -0.237, 0.5)))      # body
    head.bevel_vertical(f, 0.025, 2)
    for z in (0.24, 0.5, 0.76):
        head.lathe([(0.112, 0, 0), (0.112, 0.006, 0), (0.0, 0.006, 0)], seg=20,
                   xform=Matrix.Translation((0, -0.337, z)) @ Matrix.Rotation(math.radians(90), 4, "X"))
        head.arc_shell(0.112, 0.118, 0.19, -30, 210, 14, (0, -0.343, z))  # hood
    head.finish(sharp_deg=30)
    for name, color, z in (("LensRed", 0x7A0A08, 0.76), ("LensAmber", 0x8A5200, 0.5), ("LensGreen", 0x06603F, 0.24)):
        lens = Mesh(name, [material(name, color, rough=0.12)])
        lens.lathe([(0.1, 0, 0), (0.095, 0.012, 0), (0.06, 0.022, 0), (0.0, 0.026, 0)], seg=20,
                   xform=Matrix.Translation((0, -0.341, z)) @ Matrix.Rotation(math.radians(90), 4, "X"))
        lens.finish(sharp_deg=60)
    return (0.50, 0.49, 1.0)


def traffic_signal_pole():
    """114 mm galvanised signal pole, planted. HeadMount empty is where the head's origin goes."""
    pole = Mesh("SignalPole", [galvanised()])
    pole.lathe([(0.057, 0.0, 0), (0.057, 3.55, 0), (0.062, 3.56, 0), (0.062, 3.6, 0), (0.0, 3.63, 0)], seg=20)
    pole.finish()
    empty("HeadMount", (0, 0, SIGNAL_MOUNT_Z))
    return (0.124, 0.124, 3.63)


def post_box_pillar():
    """Irish pillar box, An Post green, no crest or lettering."""
    green = painted("PostBoxGreen", 0x0E5A32, rough=0.35)
    dark = painted("SlotDark", 0x0A0B0A, rough=0.8)
    plate = painted("CollectionPlate", 0xE6E6E0, rough=0.3)
    box = Mesh("PostBox", [green, dark, plate])
    box.lathe([(0.30, 0.0, 0), (0.30, 0.07, 0), (0.275, 0.09, 0), (0.262, 0.11, 0),
               (0.262, 1.24, 0), (0.275, 1.25, 0), (0.275, 1.29, 0), (0.262, 1.30, 0),
               (0.262, 1.32, 0), (0.305, 1.34, 0), (0.305, 1.37, 0), (0.285, 1.39, 0),
               (0.24, 1.45, 0), (0.17, 1.50, 0), (0.08, 1.53, 0), (0.04, 1.535, 0),
               (0.035, 1.56, 0), (0.0, 1.565, 0)], seg=32)
    box.box((0.25, 0.05, 0.04), Vector((0, -0.24, 1.15)), mat=1)          # aperture
    box.box((0.29, 0.06, 0.018), Vector((0, -0.25, 1.183)))              # aperture hood
    box.box((0.13, 0.04, 0.09), Vector((0, -0.245, 0.98)), mat=2)         # collection plate
    box.box((0.07, 0.03, 0.02), Vector((0.18, -0.19, 0.72)), mat=1)       # door lock
    box.finish(sharp_deg=40)
    return (0.61, 0.61, 1.565)


def bus_stop_pole():
    """Galvanised stop pole with a blank flag (StopFlag material) and a timetable case."""
    pole = Mesh("StopPole", [galvanised()])
    pole.lathe([(0.038, 0.0, 0), (0.038, 2.98, 0), (0.0, 3.0, 0)], seg=16)
    for z in (2.42, 2.88):
        pole.tube((0, 0.04, z), (0, -0.07, z), 0.012, seg=8)              # flag clamps
    pole.box((0.07, 0.03, 0.4), Vector((0, 0.05, 1.45)))                  # case bracket
    pole.finish()
    frame = painted("FlagFrame", 0x2A2D30, rough=0.5)
    flag = Mesh("StopFlag", [material("StopFlag", 0xF4F4F0, rough=0.4), frame])
    flag.box((0.012, 0.44, 0.56), Vector((0, -0.29, 2.65)))
    flag.box((0.016, 0.45, 0.012), Vector((0, -0.29, 2.94)), mat=1)
    flag.box((0.016, 0.45, 0.012), Vector((0, -0.29, 2.36)), mat=1)
    flag.finish()
    case = Mesh("Timetable", [material("Timetable", 0xF0F0EC, rough=0.2), frame])
    case.box((0.32, 0.045, 0.46), Vector((0, 0.088, 1.45)), mat=1)
    case.box((0.28, 0.002, 0.42), Vector((0, 0.1115, 1.45)))
    case.finish()
    return (0.32, 0.62, 3.0)


def bus_shelter():
    """Glass bus shelter, 4 m: glass back and one end, advertising lightbox at the other end
    (AdPanel material, blank), flat roof, perch seat. Open side faces the road (-Y)."""
    frame = material("ShelterFrame", 0x5C6166, rough=0.4, metal=0.8)
    glass = material("Glass", 0xDDE6E8, rough=0.05, alpha=0.18)
    roof = painted("ShelterRoof", 0x3A3E42, rough=0.5)
    fr = Mesh("ShelterFrame", [frame, roof])
    for x, y in ((-1.96, 0.62), (0, 0.62), (1.96, 0.62), (-1.96, -0.25)):
        fr.box((0.08, 0.08, 2.4), Vector((x, y, 1.2)))
    fr.box((3.92, 0.06, 0.08), Vector((0, 0.62, 2.36)))                   # head rail
    fr.box((3.92, 0.06, 0.06), Vector((0, 0.62, 0.17)))                   # bottom rail
    fr.box((0.06, 0.87, 0.06), Vector((-1.96, 0.185, 0.17)))
    fr.box((0.06, 0.87, 0.08), Vector((-1.96, 0.185, 2.36)))
    f = fr.box((4.1, 1.5, 0.08), Vector((0, 0.0, 2.44)), mat=1)          # roof
    fr.bevel_vertical(f, 0.05, 2)
    fr.box((1.6, 0.22, 0.04), Vector((-0.9, 0.48, 0.66)))                  # perch seat
    for x in (-1.5, -0.3):
        fr.box((0.04, 0.2, 0.04), Vector((x, 0.53, 0.62)))
    fr.finish()
    gl = Mesh("ShelterGlass", [glass])
    for x in (-0.98, 0.98):
        gl.box((1.86, 0.01, 2.1), Vector((x, 0.62, 1.27)))
    gl.box((0.01, 0.81, 2.1), Vector((-1.96, 0.185, 1.27)))
    gl.finish()
    ad = Mesh("AdPanel", [material("AdPanel", 0xF5F5F2, rough=0.25), frame])
    ad.box((0.14, 1.28, 1.95), Vector((1.96, 0.0, 1.27)), mat=1)          # lightbox case
    ad.box((0.002, 1.18, 1.8), Vector((1.888, 0.0, 1.27)))               # poster faces
    ad.box((0.002, 1.18, 1.8), Vector((2.032, 0.0, 1.27)))
    ad.box((0.1, 0.06, 0.3), Vector((1.96, 0.0, 0.15)), mat=1)            # foot
    ad.finish()
    return (4.1, 1.5, 2.48)


def wheelie_bin():
    """240 L two-wheeled bin. Body colour is a material variant: Green (default), Brown, Black."""
    green = painted("BinGreen", 0x2E6B34, rough=0.6)
    brown = painted("BinBrown", 0x5A3A22, rough=0.6)
    black = painted("BinBlack", 0x1C1D1E, rough=0.6)
    rubber = painted("Rubber", 0x111111, rough=0.9)
    steel = material("Axle", 0x8A8C8E, rough=0.4, metal=1.0)
    b = Mesh("Bin", [green, rubber, steel])
    f = b.box((0.50, 0.56, 0.93), Vector((0, -0.02, 0.535)))
    for v in {v for face in f for v in face.verts}:                       # taper: wider at the top
        if v.co.z > 0.5:
            v.co.x *= 1.1
            v.co.y = (v.co.y + 0.02) * 1.1 - 0.02
    b.bevel_vertical(f, 0.05, 2)
    lid = b.box((0.58, 0.70, 0.04), Vector((0, -0.01, 1.02)))
    b.bevel_vertical(lid, 0.04, 2)
    b.box((0.58, 0.03, 0.06), Vector((0, -0.355, 0.99)))                   # lid front lip
    b.tube((-0.27, 0.345, 1.048), (0.27, 0.345, 1.048), 0.022, seg=10)      # handle bar
    b.box((0.40, 0.08, 0.05), Vector((0, 0.32, 0.085)))                   # axle housing
    b.box((0.40, 0.06, 0.06), Vector((0, -0.22, 0.04)))                   # front foot
    b.tube((-0.27, 0.27, 0.1), (0.27, 0.27, 0.1), 0.012, seg=8, mat=2)    # axle
    for x in (-0.25, 0.25):
        b.tube((x - 0.025, 0.27, 0.1), (x + 0.025, 0.27, 0.1), 0.1, seg=18, mat=1)
    obj = b.finish(sharp_deg=40)
    variants(obj, 0, [("Green", green), ("Brown", brown), ("Black", black)])
    return (0.58, 0.74, 1.07)


def bollard_steel():
    """Brushed stainless bollard, 114 mm, 1 m above ground, white reflective band."""
    steel = material("StainlessSteel", 0xB8BBBE, rough=0.3, metal=1.0)
    band = painted("Reflector", 0xF2F2F2, rough=0.25)
    b = Mesh("Bollard", [steel, band])
    b.lathe([(0.057, 0.0, 0), (0.057, 0.80, 1), (0.057, 0.85, 0), (0.057, 0.96, 0),
             (0.05, 0.985, 0), (0.03, 0.998, 0), (0.0, 1.0, 0)], seg=24)
    b.finish(sharp_deg=50)
    return (0.114, 0.114, 1.0)


def telecom_cabinet():
    """Green roadside telecom cabinet (RAL 6009 style) on a concrete plinth, no markings."""
    green = painted("CabinetGreen", 0x27352A, rough=0.45)
    seam = painted("CabinetSeam", 0x0E120F, rough=0.8)
    steel = material("Lock", 0x9A9C9E, rough=0.35, metal=1.0)
    conc = material("Concrete", rough=0.9, surface="concrete")
    c = Mesh("Cabinet", [green, seam, steel, conc])
    c.box((1.08, 0.48, 0.10), Vector((0, 0, 0.05)), mat=3)                 # plinth
    f = c.box((1.0, 0.42, 1.08), Vector((0, 0, 0.64)))
    c.bevel_vertical(f, 0.015, 1)
    c.box((1.05, 0.47, 0.04), Vector((0, 0, 1.2)))                        # roof cap
    c.box((0.006, 0.004, 0.98), Vector((0, -0.211, 0.64)), mat=1)          # door seam
    for x in (-0.06, 0.06):
        c.tube((x, -0.21, 0.82), (x, -0.222, 0.82), 0.014, seg=10, mat=2)  # locks
    for z in (0.22, 0.25, 0.28):                                            # vents
        for x in (-0.3, 0.3):
            c.box((0.22, 0.008, 0.008), Vector((x, -0.212, z)), mat=1)
    c.finish(uv_tile=4.0)
    return (1.08, 0.48, 1.22)


def wall_mats():
    render = material("WallRender", rough=0.9, surface="render")
    brick = material("WallBrick", rough=0.9, surface="brick")
    coping = material("Coping", rough=0.9, surface="concrete")
    return render, brick, coping


def garden_wall_pier():
    """Front-garden pier with a concrete cap. Finish is a variant: Render (default) or Brick."""
    render, brick, coping = wall_mats()
    p = Mesh("Pier", [render, coping])
    p.box((0.45, 0.45, 0.98), Vector((0, 0, 0.49)))
    p.box((0.53, 0.53, 0.05), Vector((0, 0, 1.005)), mat=1)
    p.box((0.47, 0.47, 0.025), Vector((0, 0, 1.0425)), mat=1)
    obj = p.finish()
    variants(obj, 0, [("Render", render), ("Brick", brick)])
    return (0.53, 0.53, 1.055)


def garden_wall_section_1m():
    """1 m of low front-garden wall (tiles end to end along X), one brick thick with coping.
    Finish is a variant: Render (default) or Brick."""
    render, brick, coping = wall_mats()
    w = Mesh("Wall", [render, coping])
    w.box((1.0, 0.215, 0.84), Vector((0, 0, 0.42)))
    w.box((1.0, 0.30, 0.06), Vector((0, 0, 0.87)), mat=1)
    obj = w.finish()
    variants(obj, 0, [("Render", render), ("Brick", brick)])
    return (1.0, 0.30, 0.90)


ASSETS = [lamp_post_led, traffic_signal_head, traffic_signal_pole, post_box_pillar, bus_stop_pole,
          bus_shelter, wheelie_bin, bollard_steel, telecom_cabinet, garden_wall_pier,
          garden_wall_section_1m]
BUDGET = {"traffic_signal_head": 8000}


# ---------------------------------------------------------------- pipeline

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def bounds(objs):
    pts = [o.matrix_world @ Vector(c) for o in objs if o.type == "MESH" for c in o.bound_box]
    lo = Vector([min(p[i] for p in pts) for i in range(3)])
    hi = Vector([max(p[i] for p in pts) for i in range(3)])
    return lo, hi


def triangles(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    n = 0
    for o in objs:
        if o.type == "MESH":
            me = o.evaluated_get(dg).to_mesh()
            me.calc_loop_triangles()
            n += len(me.loop_triangles)
            o.evaluated_get(dg).to_mesh_clear()
    return n


def preview(name, lo, hi):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = scene.render.resolution_y = 768
    scene.render.film_transparent = False
    world = bpy.data.worlds.new("Sky")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.62, 0.72, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.8
    scene.world = world
    bpy.ops.mesh.primitive_plane_add(size=60)
    bpy.context.object.data.materials.append(material("PreviewGround", 0x6E6E6A, rough=0.95))
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(-35))
    scene.collection.objects.link(sun)
    centre = (lo + hi) / 2
    radius = (hi - lo).length / 2
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    cam.data.lens = 50
    fov = cam.data.angle
    view = Vector((-0.55, -1.0, 0.35)).normalized()
    cam.location = centre + view * (radius / math.sin(fov / 2) * 1.05)
    cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(cam)
    scene.camera = cam
    os.makedirs(os.path.join(REF, name), exist_ok=True)
    scene.render.filepath = os.path.join(REF, name, "preview.png")
    bpy.ops.render.render(write_still=True)


def build(fn):
    name = fn.__name__
    reset()
    want = fn()
    objs = list(bpy.context.scene.objects)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = next(o for o in objs if o.type == "MESH")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    lo, hi = bounds(objs)
    size = hi - lo
    tris = triangles(objs)
    budget = BUDGET.get(name, 5000)
    ok = all(abs(size[i] - want[i]) <= max(0.02, 0.03 * want[i]) for i in range(3))
    path = os.path.join(MODELS, name + ".glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_yup=True, export_extras=True,
                              export_materials="EXPORT", export_image_format="AUTO",
                              export_draco_mesh_compression_enable=False, export_apply=True,
                              use_selection=False)
    print(f"RESULT {name}: size {size.x:.3f} x {size.y:.3f} x {size.z:.3f} m "
          f"(spec {want[0]} x {want[1]} x {want[2]}) {'OK' if ok else 'MISMATCH'}; "
          f"min z {lo.z:.3f}; tris {tris}/{budget} {'OK' if tris <= budget else 'OVER'}; "
          f"nodes {sorted(o.name for o in objs)}")
    preview(name, lo, hi)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    for fn in ASSETS:
        if not argv or fn.__name__ in argv:
            build(fn)


main()
