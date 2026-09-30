"""Furniture and fit-out for the bake.

Each engine furniture slot (kind, centre, footprint, the wall it backs onto)
becomes a real piece. Modern pieces are modelled here with bevelled edges and
soft cushions; accents come from the CC0 model pack. Pieces are built in a
local frame (width along X, depth along Y, back against +Y, floor at z=0),
then turned to face into the room.

Every builder may add lights (lamps, pendants, vanity bars); they are
collected in LIGHTS for lighting.py.
"""

import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

import materials as M

FT = 0.3048
COLL = None          # collection furniture goes into
LIB = None           # hidden collection holding imported models
ASSETS = None
LIGHTS = []          # (kind, world_location, energy_W, colour_hex, size_m)
_models = {}


def init(asset_dir, coll):
    global ASSETS, COLL, LIB
    ASSETS = asset_dir
    COLL = coll
    LIB = bpy.data.collections.new('ModelLibrary')
    bpy.context.scene.collection.children.link(LIB)
    LIB.hide_render = True
    LIB.hide_viewport = True
    LIGHTS.clear()
    _models.clear()


def eng(p):
    """Engine feet (x, y-up, z) -> Blender meters."""
    return Vector((p[0] * FT, -p[2] * FT, p[1] * FT))


# ---------------------------------------------------------------- primitives
class Piece:
    """A piece of furniture under construction, in its local frame."""

    def __init__(self, name):
        self.name = name
        self.parts = []
        self.lights = []  # local (kind, Vector, W, colour, size)

    def _obj(self, bm, mat, bevel, seg, smooth=True):
        me = bpy.data.meshes.new(self.name)
        bm.to_mesh(me)
        bm.free()
        me.materials.append(mat)
        ob = bpy.data.objects.new(self.name, me)
        COLL.objects.link(ob)
        if smooth:
            me.shade_smooth()
        if bevel > 0:
            mod = ob.modifiers.new('bevel', 'BEVEL')
            mod.width = bevel
            mod.segments = seg
            mod.limit_method = 'ANGLE'
            mod.angle_limit = math.radians(35)
            mod.harden_normals = seg <= 2
            mod.use_clamp_overlap = True
        self.parts.append(ob)
        return ob

    def box(self, sx, sy, sz, x, y, z, mat, bevel=0.004, seg=2, rot=0.0, tilt=0.0):
        """Box of size (sx, sy, sz) centred on (x, y) with its bottom at z."""
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        m = Matrix.Translation((x, y, z + sz / 2)) @ Matrix.Rotation(rot, 4, 'Z') @ Matrix.Rotation(tilt, 4, 'X') @ Matrix.Diagonal((sx, sy, sz, 1))
        bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
        bevel = min(bevel, min(sx, sy, sz) * 0.45)
        return self._obj(bm, M.fit(mat) if isinstance(mat, str) else mat, bevel, seg)

    def cyl(self, r, h, x, y, z, mat, r2=None, verts=32, bevel=0.002, seg=2, sy=1.0, axis='Z'):
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=verts, radius1=r, radius2=r if r2 is None else r2, depth=h)
        rot = Matrix.Identity(4) if axis == 'Z' else Matrix.Rotation(math.pi / 2, 4, 'X' if axis == 'Y' else 'Y')
        m = Matrix.Translation((x, y, z + (h / 2 if axis == 'Z' else 0))) @ rot @ Matrix.Diagonal((1, sy, 1, 1))
        bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
        return self._obj(bm, M.fit(mat) if isinstance(mat, str) else mat, min(bevel, r * 0.3, h * 0.3), seg)

    def light(self, kind, x, y, z, watts, colour='#FFD9A6', size=0.05):
        self.lights.append((kind, Vector((x, y, z)), watts, colour, size))

    def place(self, loc, angle):
        """Apply modifiers, join, UV-project, move into the world."""
        if not self.parts:
            return None
        dg = bpy.context.evaluated_depsgraph_get()
        for ob in self.parts:
            if ob.modifiers:
                ev = ob.evaluated_get(dg)
                me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
                old = ob.data
                ob.modifiers.clear()
                ob.data = me
                bpy.data.meshes.remove(old)
        root = self.parts[0]
        if len(self.parts) > 1:
            with bpy.context.temp_override(active_object=root, object=root, selected_objects=self.parts, selected_editable_objects=self.parts):
                bpy.ops.object.join()
        box_uv(root)
        _fit_print_uv(root)
        root.location = loc
        root.rotation_euler = (0, 0, angle)
        rot = Matrix.Rotation(angle, 3, 'Z')
        for kind, p, w, c, s in self.lights:
            LIGHTS.append((kind, loc + rot @ p, w, c, s))
        root['keystone_kind'] = self.name
        return root


def _fit_print_uv(ob):
    """Stretch the print image over the print's front face."""
    me = ob.data
    idx = [i for i, m in enumerate(me.materials) if m and m.name.startswith('fit/print')]
    if not idx:
        return
    bm = bmesh.new()
    bm.from_mesh(me)
    uv = bm.loops.layers.uv.verify()
    faces = [f for f in bm.faces if f.material_index in idx]
    xs = [l.vert.co.x for f in faces for l in f.loops]
    zs = [l.vert.co.z for f in faces for l in f.loops]
    x0, x1, z0, z1 = min(xs), max(xs), min(zs), max(zs)
    for f in faces:
        for l in f.loops:
            l[uv].uv = ((l.vert.co.x - x0) / max(1e-6, x1 - x0), (l.vert.co.z - z0) / max(1e-6, z1 - z0))
    bm.to_mesh(me)
    bm.free()


def box_uv(ob):
    """Box-project UVs in meters (object space) so textures keep real size."""
    me = ob.data
    if not me.uv_layers:
        me.uv_layers.new(name='UVMap')
    bm = bmesh.new()
    bm.from_mesh(me)
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        n = f.normal
        ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
        for lp in f.loops:
            c = lp.vert.co
            lp[uv].uv = (c.x, c.y) if az >= ax and az >= ay else ((c.y, c.z) if ax >= ay else (c.x, c.z))
    bm.to_mesh(me)
    bm.free()


# ------------------------------------------------------------ model library
def model(model_id):
    """Import a CC0 model once; return (objects, min, max) of its meshes."""
    if model_id in _models:
        return _models[model_id]
    path = os.path.join(ASSETS, 'models', model_id, f'{model_id}_2k.gltf')
    if not os.path.exists(path):
        _models[model_id] = None
        return None
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    for o in new:
        for c in o.users_collection:
            c.objects.unlink(o)
        LIB.objects.link(o)
    meshes = [o for o in new if o.type == 'MESH']
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in meshes:
        for v in o.bound_box:
            w = o.matrix_world @ Vector(v)
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    _models[model_id] = (meshes, lo, hi)
    return _models[model_id]


def place_model(model_id, loc, angle, fit_w=None, fit_d=None, fit_h=None, name=None, bake=True):
    """Copy a library model into the scene, scaled to fit, standing at loc."""
    m = model(model_id)
    if not m:
        return []
    meshes, lo, hi = m
    size = hi - lo
    turn = 0.0
    if name == 'art':
        turn = math.pi  # the frame model faces +Y; turn its print toward the room
        if size.x < size.y:  # modelled facing +-X
            turn += math.pi / 2
            size = Vector((size.y, size.x, size.z))
    s = []
    if fit_w:
        s.append(fit_w / max(size.x, 1e-3))
    if fit_d:
        s.append(fit_d / max(size.y, 1e-3))
    if fit_h:
        s.append(fit_h / max(size.z, 1e-3))
    k = min(s) if s else 1.0
    centre = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    xf = Matrix.Translation(loc) @ Matrix.Rotation(angle + turn, 4, 'Z') @ Matrix.Scale(k, 4) @ Matrix.Translation(-centre)
    out = []
    for o in meshes:
        c = o.copy()
        c.data = o.data.copy()
        c.parent = None
        c.matrix_world = xf @ o.matrix_world
        COLL.objects.link(c)
        c['keystone_kind'] = name or model_id
        c['keystone_bake'] = bake
        out.append(c)
    return out


# ---------------------------------------------------------------- builders
# Each builder gets a Piece and the slot size (w along local X, d along Y).

def sofa(p, w, d, fabric='linen'):
    arm, back = 0.17, 0.22
    for x in (-w / 2 + 0.09, w / 2 - 0.09):
        for y in (-d / 2 + 0.09, d / 2 - 0.09):
            p.cyl(0.022, 0.12, x, y, 0, 'walnut', r2=0.015, verts=12)
    p.box(w, d, 0.2, 0, 0, 0.12, fabric, bevel=0.02, seg=3)
    n = 2 if w < 1.9 else 3
    cw = (w - 2 * arm) / n
    for i in range(n):
        x = -w / 2 + arm + cw * (i + 0.5)
        p.box(cw - 0.01, d - back - 0.04, 0.16, x, -back / 2 + 0.0, 0.31, fabric, bevel=0.045, seg=4)
        p.box(cw - 0.02, 0.2, 0.44, x, d / 2 - back / 2 - 0.1, 0.34, fabric, bevel=0.06, seg=4, tilt=-0.18)
    for x in (-w / 2 + arm / 2, w / 2 - arm / 2):
        p.box(arm, d, 0.34, x, 0, 0.3, fabric, bevel=0.04, seg=4)
    p.box(w - 2 * arm + 0.02, back, 0.38, 0, d / 2 - back / 2, 0.3, fabric, bevel=0.04, seg=3)
    p.box(0.44, 0.13, 0.44, -w / 2 + arm + 0.3, d / 2 - back - 0.12, 0.44, 'velvet-rust', bevel=0.06, seg=5, rot=0.25, tilt=-0.35)
    p.box(0.42, 0.13, 0.42, w / 2 - arm - 0.3, d / 2 - back - 0.12, 0.44, 'velvet', bevel=0.06, seg=5, rot=-0.2, tilt=-0.35)


def bed(p, w, d):
    p.box(w, d - 0.06, 0.26, 0, -0.03, 0.06, 'linen-dark', bevel=0.02, seg=3)
    for x in (-w / 2 + 0.1, w / 2 - 0.1):
        for y in (-d / 2 + 0.12, d / 2 - 0.2):
            p.box(0.05, 0.05, 0.06, x, y, 0, 'black-steel', bevel=0.004)
    p.box(w + 0.12, 0.1, 1.15, 0, d / 2 - 0.05, 0, 'linen-dark', bevel=0.035, seg=4)
    mat_top = 0.32 + 0.24
    p.box(w - 0.08, d - 0.2, 0.24, 0, -0.08, 0.32, 'linen-white', bevel=0.05, seg=4)
    dd = (d - 0.2) * 0.74
    p.box(w + 0.02, dd, 0.3, 0, -d / 2 + dd / 2 + 0.06, mat_top - 0.26, M.pbr('fit/duvet', tex='rough_linen', tint='#ECE8E0', rough=0.95, sheen=0.6), bevel=0.07, seg=5)
    p.box(w + 0.03, 0.26, 0.34, 0, -d / 2 + dd + 0.06 - 0.1, mat_top - 0.27, M.pbr('fit/duvet', tex='rough_linen'), bevel=0.09, seg=5)
    n = 3 if w > 1.75 else 2
    pw = min(0.7, (w - 0.2) / n)
    for i in range(n):
        x = -w / 2 + 0.1 + pw * (i + 0.5)
        p.box(pw - 0.04, 0.16, 0.44, x, d / 2 - 0.26, mat_top - 0.02, 'linen-white', bevel=0.075, seg=5, tilt=0.35)
    p.box(0.42, 0.12, 0.3, 0, d / 2 - 0.42, mat_top, 'velvet', bevel=0.055, seg=5, tilt=0.3)
    p.box(w + 0.1, 0.5, 0.025, 0, -d / 2 + 0.45, mat_top + 0.05, 'velvet-rust', bevel=0.01, seg=2)
    for x in (-w / 2 - 0.04, w / 2 + 0.04):
        p.box(0.025, 0.5, 0.3, x, -d / 2 + 0.45, mat_top - 0.25, 'velvet-rust', bevel=0.01, seg=2)


def nightstand(p, w, d):
    h = 0.56
    p.box(w, d, h - 0.06, 0, 0, 0.06, 'walnut', bevel=0.01, seg=2)
    for x in (-w / 2 + 0.04, w / 2 - 0.04):
        for y in (-d / 2 + 0.04, d / 2 - 0.04):
            p.box(0.03, 0.03, 0.06, x, y, 0, 'black-steel', bevel=0.003)
    p.box(w - 0.04, 0.004, 0.004, 0, -d / 2 - 0.001, h - 0.2, 'black-steel', bevel=0)
    p.cyl(0.012, 0.02, 0, -d / 2 - 0.01, h - 0.12, 'brass', axis='Y', verts=16)
    lamp(p, 0, 0.02, h)


def lamp(p, x, y, z, scale=1.0):
    p.cyl(0.075 * scale, 0.26 * scale, x, y, z, 'porcelain', r2=0.05 * scale, verts=28, bevel=0.01)
    p.cyl(0.008, 0.08 * scale, x, y, z + 0.26 * scale, 'brass', verts=10)
    p.cyl(0.17 * scale, 0.22 * scale, x, y, z + 0.3 * scale, 'shade', r2=0.13 * scale, verts=36, bevel=0.002)
    p.light('lamp', x, y, z + 0.4 * scale, 18, '#FFCF8C', 0.05)


def dresser(p, w, d):
    h = 0.82
    p.box(w, d, h - 0.08, 0, 0, 0.08, 'walnut', bevel=0.01, seg=2)
    p.box(w - 0.1, d - 0.1, 0.08, 0, 0, 0, 'black-steel', bevel=0.004)
    rows, cols = 3, 2 if w > 1.0 else 1
    for r in range(1, rows):
        p.box(w - 0.03, 0.004, 0.004, 0, -d / 2 - 0.001, 0.08 + (h - 0.08) * r / rows, 'black-steel', bevel=0)
    for c in range(1, cols):
        p.box(0.004, 0.004, h - 0.1, -w / 2 + w * c / cols, -d / 2 - 0.001, 0.09, 'black-steel', bevel=0)
    for r in range(rows):
        for c in range(cols):
            x = -w / 2 + w * (c + 0.5) / cols
            z = 0.08 + (h - 0.08) * (r + 0.5) / rows
            p.box(0.14, 0.02, 0.012, x, -d / 2 - 0.012, z, 'brass', bevel=0.003)


def dining_table(p, w, d):
    p.box(w, d, 0.04, 0, 0, 0.72, 'oak', bevel=0.008, seg=3)
    for x in (-w / 2 + 0.1, w / 2 - 0.1):
        for y in (-d / 2 + 0.1, d / 2 - 0.1):
            p.box(0.055, 0.055, 0.72, x, y, 0, 'black-steel', bevel=0.004)
    p.box(w - 0.2, 0.04, 0.06, 0, -d / 2 + 0.1, 0.66, 'black-steel', bevel=0.003)
    p.box(w - 0.2, 0.04, 0.06, 0, d / 2 - 0.1, 0.66, 'black-steel', bevel=0.003)


def chair(p, w, d):
    s = min(w, d, 0.5)
    for x in (-s / 2 + 0.04, s / 2 - 0.04):
        for y in (-s / 2 + 0.04, s / 2 - 0.04):
            p.cyl(0.018, 0.45, x, y, 0, 'oak', r2=0.014, verts=12)
    p.box(s, s, 0.06, 0, 0, 0.44, 'linen', bevel=0.02, seg=3)
    p.box(s - 0.02, 0.035, 0.34, 0, s / 2 - 0.03, 0.52, 'oak', bevel=0.01, seg=2, tilt=-0.12)


def coffee_table(p, w, d):
    p.box(w, d, 0.045, 0, 0, 0.36, 'oak', bevel=0.012, seg=3)
    p.box(w - 0.12, d - 0.12, 0.02, 0, 0, 0.12, 'oak', bevel=0.005)
    for x in (-w / 2 + 0.06, w / 2 - 0.06):
        for y in (-d / 2 + 0.06, d / 2 - 0.06):
            p.box(0.03, 0.03, 0.36, x, y, 0, 'black-steel', bevel=0.003)
    p.box(0.28, 0.2, 0.05, w * 0.18, 0, 0.405, 'lacquer-navy', bevel=0.004)
    p.box(0.26, 0.19, 0.035, w * 0.18, 0, 0.455, 'lacquer', bevel=0.004)
    p.cyl(0.08, 0.16, -w * 0.2, 0.02, 0.405, 'porcelain', r2=0.05, verts=28)


def credenza(p, w, d, tv=False):
    h = 0.62
    p.box(w, d, h - 0.14, 0, 0, 0.14, 'walnut', bevel=0.01, seg=2)
    for x in (-w / 2 + 0.06, w / 2 - 0.06):
        for y in (-d / 2 + 0.05, d / 2 - 0.05):
            p.cyl(0.015, 0.14, x, y, 0, 'black-steel', verts=10)
    n = max(2, round(w / 0.5))
    for i in range(1, n):
        p.box(0.004, 0.004, h - 0.18, -w / 2 + w * i / n, -d / 2 - 0.001, 0.16, 'black-steel', bevel=0)
    if tv:
        tw = min(1.45, w * 0.95)
        p.box(tw, 0.035, tw * 0.5625, 0, d / 2 + 0.03, h + 0.35, 'black-glass', bevel=0.004)
    else:
        lamp(p, w / 2 - 0.25, 0.02, h, 0.9)
    p.box(0.3, 0.22, 0.06, -w / 2 + 0.3, 0, h, 'lacquer-sage', bevel=0.004)


def bench(p, w, d):
    for i in range(5):
        p.box(w, d / 5 - 0.012, 0.035, 0, -d / 2 + d / 5 * (i + 0.5), 0.42, 'oak', bevel=0.006)
    for x in (-w / 2 + 0.08, w / 2 - 0.08):
        p.box(0.05, d - 0.04, 0.42, x, 0, 0, 'black-steel', bevel=0.004)


def counter(p, w, d, cab='lacquer', sink=False, uppers=False, top='marble', h=0.9):
    body = h - 0.03
    p.box(w, d - 0.08, 0.1, 0, 0.04, 0, 'black-steel', bevel=0.002)
    p.box(w, d - 0.02, body - 0.1, 0, 0.01, 0.1, cab, bevel=0.003)
    n = max(1, round(w / 0.6))
    for i in range(n):
        x = -w / 2 + w * (i + 0.5) / n
        p.box(w / n - 0.006, 0.02, body - 0.1 - 0.006, x, -d / 2, 0.103, cab, bevel=0.003)
        p.box(0.16, 0.02, 0.012, x, -d / 2 - 0.02, body - 0.08, 'black-steel', bevel=0.003)
    p.box(w + 0.01, d + 0.02, 0.03, 0, -0.01, body, top, bevel=0.004, seg=2)
    p.box(w, 0.012, 0.5, 0, d / 2 - 0.006, h, 'tile-wall', bevel=0.0)
    if sink:
        p.box(0.72, 0.42, 0.004, 0, -0.02, h - 0.004, 'stainless', bevel=0.02, seg=3)
        faucet(p, 0, d / 2 - 0.12, h)
    if uppers:
        uh, ud = 0.78, 0.34
        p.box(w, ud, uh, 0, d / 2 - ud / 2, h + 0.55, cab, bevel=0.003)
        for i in range(n):
            x = -w / 2 + w * (i + 0.5) / n
            p.box(w / n - 0.006, 0.02, uh - 0.006, x, d / 2 - ud - 0.01, h + 0.553, cab, bevel=0.003)
            p.box(0.012, 0.02, 0.14, x + (w / n) * 0.35 * (1 if i % 2 else -1), d / 2 - ud - 0.03, h + 0.6, 'black-steel', bevel=0.003)
        p.box(w, 0.02, 0.004, 0, d / 2 - ud + 0.02, h + 0.545, 'bulb', bevel=0)
        p.light('strip', 0, d / 2 - ud + 0.1, h + 0.53, 30 * w, '#FFE3B8', 0.2)


def faucet(p, x, y, z):
    p.cyl(0.022, 0.3, x, y, z, 'chrome', verts=16)
    p.cyl(0.016, 0.22, x, y - 0.1, z + 0.29, 'chrome', axis='Y', verts=16)
    p.cyl(0.014, 0.06, x, y - 0.2, z + 0.24, 'chrome', verts=16)


def fridge(p, w, d):
    h = 1.82
    p.box(w, d, h, 0, 0, 0, 'stainless', bevel=0.012, seg=3)
    p.box(0.004, 0.02, h * 0.62, 0, -d / 2 - 0.004, h * 0.36, 'black-steel', bevel=0)
    p.box(w - 0.02, 0.02, 0.004, 0, -d / 2 - 0.004, h * 0.35, 'black-steel', bevel=0)
    for x in (-0.03, 0.03):
        p.cyl(0.012, h * 0.5, x, -d / 2 - 0.05, h * 0.42, 'stainless', verts=12)
    p.cyl(0.012, w * 0.6, 0, -d / 2 - 0.05, h * 0.3, 'stainless', axis='X', verts=12)


def stove(p, w, d):
    h = 0.9
    p.box(w, d, h - 0.02, 0, 0, 0, 'stainless', bevel=0.008)
    p.box(w, d, 0.012, 0, 0, h - 0.02, 'black-glass', bevel=0.003)
    for x in (-w / 4, w / 4):
        for y in (-d / 5, d / 5):
            p.cyl(0.085, 0.002, x, y, h - 0.008, 'black-steel', verts=32, bevel=0)
    p.box(w * 0.7, 0.01, 0.3, 0, -d / 2 - 0.004, 0.25, 'black-glass', bevel=0.004)
    p.cyl(0.012, w * 0.8, 0, -d / 2 - 0.045, 0.64, 'stainless', axis='X', verts=12)
    for i in range(5):
        p.cyl(0.018, 0.025, -w * 0.35 + w * 0.7 * i / 4, -d / 2 - 0.012, 0.76, 'black-steel', axis='Y', verts=16)
    # range hood on the wall above
    p.box(w * 1.0, 0.5, 0.12, 0, d / 2 - 0.25, 1.62, 'stainless', bevel=0.006)
    p.box(w * 0.6, 0.3, 0.6, 0, d / 2 - 0.15, 1.74, 'stainless', bevel=0.004)
    p.light('hood', 0, d / 2 - 0.25, 1.6, 12, '#FFE7C4', 0.05)


def island(p, w, d, seat_side=-1):
    """Cabinets on the working side, a waterfall stone top overhanging the seats."""
    over = 0.3
    cd = max(0.5, d - over)
    cy = -seat_side * (d - cd) / 2
    p.box(w - 0.08, cd - 0.08, 0.1, 0, cy, 0, 'black-steel', bevel=0.002)
    p.box(w - 0.06, cd, 0.77, 0, cy, 0.1, 'lacquer-navy', bevel=0.004)
    n = max(1, round(w / 0.6))
    for i in range(n):
        x = -w / 2 + 0.03 + (w - 0.06) * (i + 0.5) / n
        p.box((w - 0.06) / n - 0.006, 0.02, 0.76, x, cy - seat_side * (cd / 2 + 0.01), 0.103, 'lacquer-navy', bevel=0.003)
    p.box(w, d, 0.04, 0, 0, 0.87, 'marble', bevel=0.004)
    for x in (-w / 2 + 0.02, w / 2 - 0.02):
        p.box(0.04, d, 0.87, x, 0, 0, 'marble', bevel=0.004)
    k = max(2, min(4, int(w / 0.6)))
    for i in range(k):
        x = -w / 2 + w * (i + 0.5) / k
        stool(p, x, seat_side * (d / 2 + 0.05))
    for i in (-1, 1):
        x = i * w / 4
        p.cyl(0.004, 1.0, x, 0, 1.75, 'black-steel', verts=8)
        p.cyl(0.16, 0.22, x, 0, 1.55, 'black-steel', r2=0.05, verts=36)
        p.light('pendant', x, 0, 1.58, 45, '#FFD39A', 0.06)


def stool(p, x, y):
    for dx in (-0.14, 0.14):
        for dy in (-0.14, 0.14):
            p.cyl(0.012, 0.64, x + dx, y + dy, 0, 'black-steel', r2=0.01, verts=10)
    p.box(0.32, 0.32, 0.012, x, y, 0.28, 'black-steel', bevel=0.003)
    p.cyl(0.19, 0.06, x, y, 0.64, 'walnut', verts=32, bevel=0.015, seg=3)


def toilet(p, w, d):
    y0 = d / 2
    p.cyl(0.13, 0.4, 0, y0 - 0.42, 0, 'porcelain', r2=0.17, verts=40, bevel=0.02, sy=1.25)
    p.cyl(0.19, 0.05, 0, y0 - 0.44, 0.38, 'porcelain', verts=40, bevel=0.015, sy=1.25)
    p.cyl(0.19, 0.02, 0, y0 - 0.44, 0.43, 'lacquer', verts=40, bevel=0.008, sy=1.25)
    p.box(0.42, 0.18, 0.38, 0, y0 - 0.1, 0.38, 'porcelain', bevel=0.025, seg=3)
    p.cyl(0.02, 0.01, 0, y0 - 0.1, 0.76, 'chrome', verts=16)


def vanity(p, w, d):
    p.box(w, d, 0.5, 0, 0, 0.32, 'walnut', bevel=0.006)
    p.box(0.004, 0.02, 0.46, 0, -d / 2 - 0.002, 0.34, 'black-steel', bevel=0)
    p.box(w + 0.01, d + 0.01, 0.025, 0, 0, 0.82, 'marble', bevel=0.004)
    n = 2 if w > 1.3 else 1
    for i in range(n):
        x = -w / 2 + w * (i + 0.5) / n
        p.box(0.46, 0.34, 0.004, x, -0.02, 0.84, 'porcelain', bevel=0.03, seg=3)
        faucet(p, x, d / 2 - 0.08, 0.845)
    p.box(w * 0.9, 0.02, 0.85, 0, d / 2 + 0.01, 1.02, 'black-steel', bevel=0.003)
    p.box(w * 0.9 - 0.03, 0.022, 0.82, 0, d / 2 + 0.0, 1.035, 'mirror', bevel=0)
    p.box(w * 0.7, 0.08, 0.06, 0, d / 2 - 0.04, 1.98, 'black-steel', bevel=0.004)
    p.box(w * 0.66, 0.01, 0.03, 0, d / 2 - 0.08, 1.995, 'bulb', bevel=0)
    p.light('vanity', 0, d / 2 - 0.15, 1.95, 35, '#FFE6C7', 0.3)


def shower(p, w, d, walls):
    p.box(w, d, 0.05, 0, 0, 0, 'porcelain', bevel=0.01)
    for side in ('n', 's', 'w', 'e'):
        horiz = side in ('n', 's')
        L = w if horiz else d
        x = 0 if horiz else (-w / 2 if side == 'w' else w / 2)
        y = (d / 2 if side == 'n' else -d / 2) if horiz else 0
        sx, sy = (L, 0.012) if horiz else (0.012, L)
        if side in walls:
            p.box(sx, sy, 2.1, x, y, 0.05, 'tile-wall', bevel=0)
        else:
            p.box(sx, sy, 1.95, x, y, 0.05, 'glass-clear', bevel=0)
            p.box(sx if horiz else 0.03, sy if not horiz else 0.03, 0.03, x, y, 2.0, 'black-steel', bevel=0.003)
    p.cyl(0.1, 0.012, 0, d / 2 - 0.25, 2.05, 'chrome', verts=32)
    p.cyl(0.01, 0.25, 0, d / 2 - 0.12, 2.06, 'chrome', axis='Y', verts=10)


def tub(p, w, d, walls):
    p.box(w, d, 0.55, 0, 0, 0, 'porcelain', bevel=0.02, seg=3)
    p.box(w - 0.14, d - 0.14, 0.02, 0, 0, 0.535, M.pbr('fit/water', color='#DDE8EC', rough=0.02, alpha=0.4), bevel=0.04, seg=3)
    for side in walls:
        horiz = side in ('n', 's')
        L = w if horiz else d
        x = 0 if horiz else (-w / 2 if side == 'w' else w / 2)
        y = (d / 2 if side == 'n' else -d / 2) if horiz else 0
        p.box(L if horiz else 0.012, 0.012 if horiz else L, 1.3, x, y, 0.55, 'tile-wall', bevel=0)
    faucet(p, 0, d / 2 - 0.05, 0.55)


def washer(p, w, d, dryer=False):
    p.box(w, d, 0.86, 0, 0, 0, 'appliance-white', bevel=0.012, seg=3)
    p.cyl(0.21, 0.03, 0, -d / 2 - 0.01, 0.42, 'chrome', axis='Y', verts=40)
    p.cyl(0.17, 0.035, 0, -d / 2 - 0.015, 0.42, 'black-glass', axis='Y', verts=40)
    p.box(w - 0.04, 0.01, 0.1, 0, -d / 2 - 0.004, 0.72, 'black-glass', bevel=0.003)


def closet(p, w, d):
    # Same six-foot open storage envelope as the quick model. Local +Y is
    # the rear; no shelf, backing or rail projects into the reserved aisle.
    t = min(0.08 * FT, w / 4, d / 4)
    p.box(w, t, 6 * FT, 0, d / 2 - t / 2, 0, 'oak', bevel=0.003)
    for x in (-w / 2 + t / 2, w / 2 - t / 2):
        p.box(t, d, 6 * FT, x, 0, 0, 'oak', bevel=0.003)
    for z in (1, 3.5, 5.75):
        p.box(w, d, t, 0, 0, z * FT, 'oak', bevel=0.003)
    p.cyl(t / 2, w - 2 * t, 0, 0, 5.4 * FT + t / 2, 'chrome', axis='X', verts=12)


def desk(p, w, d):
    """Oak top on black steel legs, a drawer pedestal, a monitor and a lamp."""
    p.box(w, d, 0.035, 0, 0, 0.72, 'oak', bevel=0.006, seg=2)
    for x in (-w / 2 + 0.04, w / 2 - 0.04):
        p.box(0.035, d - 0.08, 0.035, x, 0, 0.03, 'black-steel', bevel=0.003)
        p.box(0.035, 0.035, 0.72, x, -d / 2 + 0.06, 0, 'black-steel', bevel=0.003)
        p.box(0.035, 0.035, 0.72, x, d / 2 - 0.06, 0, 'black-steel', bevel=0.003)
    p.box(0.4, d - 0.1, 0.55, w / 2 - 0.26, 0.02, 0.16, 'lacquer', bevel=0.004)
    for z in (0.34, 0.52):
        p.box(0.36, 0.004, 0.004, w / 2 - 0.26, -d / 2 + 0.07, z, 'black-steel', bevel=0)
    mw = min(0.62, w * 0.45)
    p.box(mw, 0.02, mw * 0.56, 0, d / 2 - 0.16, 0.9, 'black-glass', bevel=0.004)
    p.box(0.05, 0.05, 0.16, 0, d / 2 - 0.12, 0.755, 'black-steel', bevel=0.003)
    p.box(0.22, 0.16, 0.012, 0, d / 2 - 0.12, 0.755, 'black-steel', bevel=0.003)
    p.box(0.42, 0.14, 0.012, 0, -0.05, 0.755, 'appliance-white', bevel=0.003)
    lamp(p, -w / 2 + 0.2, d / 2 - 0.15, 0.755, 0.75)


def desk_chair(p, w, d):
    """Task chair: five-star base, gas lift, upholstered seat and mesh back."""
    for k in range(5):
        a = k * 2 * math.pi / 5
        p.box(0.03, 0.3, 0.03, math.sin(a) * 0.15, math.cos(a) * 0.15, 0.06, 'black-steel', bevel=0.004, rot=-a)
        p.cyl(0.025, 0.05, math.sin(a) * 0.3, math.cos(a) * 0.3, 0.0, 'rubber', verts=12)
    p.cyl(0.025, 0.36, 0, 0, 0.08, 'chrome', verts=12)
    p.box(0.48, 0.46, 0.08, 0, 0, 0.44, 'linen-dark', bevel=0.03, seg=3)
    p.box(0.44, 0.05, 0.5, 0, d / 2 - 0.12, 0.56, 'black-steel', bevel=0.02, seg=3, tilt=-0.15)
    for x in (-0.25, 0.25):
        p.box(0.04, 0.26, 0.03, x, 0.02, 0.62, 'black-steel', bevel=0.008)


def treadmill(p, w, d):
    long_x = w >= d
    L, W = (w, d) if long_x else (d, w)
    rot = 0 if long_x else math.pi / 2
    def b(sl, sw, sh, u, v, z, mat, **kw):
        x, y = (u, v) if long_x else (-v, u)
        p.box(sl if long_x else sw, sw if long_x else sl, sh, x, y, z, mat, **kw)
    b(L * 0.95, W * 0.8, 0.16, 0, 0, 0, 'black-steel', bevel=0.02, seg=2)
    b(L * 0.8, W * 0.55, 0.01, -L * 0.03, 0, 0.16, 'rubber', bevel=0)
    for s in (-1, 1):
        b(0.06, 0.05, 1.05, L * 0.4, s * W * 0.36, 0.1, 'black-steel', bevel=0.01)
    b(0.16, W * 0.8, 0.3, L * 0.42, 0, 1.05, 'black-steel', bevel=0.02, seg=2)
    b(0.12, W * 0.35, 0.18, L * 0.4, 0, 1.12, 'black-glass', bevel=0.01)


def exercise_mat(p, w, d):
    p.box(w, d, 0.012, 0, 0, 0, M.pbr('fit/yoga', color='#5E7F74', rough=0.9), bevel=0.004)
    for k, x in enumerate((-w * 0.3, w * 0.3)):
        p.cyl(0.04, 0.26, x, d * 0.25, 0.06, 'black-steel', axis='X', verts=16)
        p.cyl(0.07, 0.04, x - 0.11, d * 0.25, 0.06, 'rubber', axis='X', verts=20)
        p.cyl(0.07, 0.04, x + 0.11, d * 0.25, 0.06, 'rubber', axis='X', verts=20)
    p.cyl(0.1, 0.16, 0, -d * 0.25, 0.012, 'black-steel', verts=24, bevel=0.03, seg=3)


def play_mat(p, w, d):
    cols = ['#E9D8B8', '#BFD3C7', '#E7C3B0', '#C9D2E3']
    n = max(2, int(w / 0.6)), max(2, int(d / 0.6))
    for i in range(n[0]):
        for j in range(n[1]):
            c = cols[(i + j) % len(cols)]
            p.box(w / n[0] - 0.005, d / n[1] - 0.005, 0.02, -w / 2 + w / n[0] * (i + 0.5), -d / 2 + d / n[1] * (j + 0.5), 0,
                  M.pbr(f'fit/foam{c}', color=c, rough=0.95), bevel=0.004)
    for k, (x, y, c) in enumerate([(-0.2, 0.1, '#D9A441'), (0.05, -0.15, '#6F9FB8'), (0.25, 0.2, '#C8594A')]):
        p.box(0.12, 0.12, 0.12, x, y, 0.02, M.pbr(f'fit/block{c}', color=c, rough=0.6), bevel=0.012, rot=k * 0.5)


def toy_storage(p, w, d):
    h = 0.9
    cols = max(2, round(w / 0.36))
    p.box(w, d, h, 0, 0, 0, 'lacquer', bevel=0.006)
    for c in range(1, cols):
        p.box(0.018, 0.02, h - 0.04, -w / 2 + w * c / cols, -d / 2 - 0.001, 0.02, 'lacquer', bevel=0)
    p.box(w - 0.02, 0.02, 0.018, 0, -d / 2 - 0.001, h / 2, 'lacquer', bevel=0)
    for c in range(cols):
        x = -w / 2 + w * (c + 0.5) / cols
        p.box(w / cols - 0.07, d * 0.8, h / 2 - 0.1, x, -0.02, 0.05, M.pbr('fit/basket', color='#B89468', rough=0.9), bevel=0.02, seg=2)


def outdoor_chair(p, w, d):
    s = min(w, d, 0.7)
    for i in range(5):
        p.box(s, s / 5 - 0.012, 0.025, 0, -s / 2 + s / 5 * (i + 0.5), 0.4, 'oak', bevel=0.004)
    for x in (-s / 2 + 0.03, s / 2 - 0.03):
        p.box(0.045, s, 0.045, x, 0, 0.36, 'oak', bevel=0.004)
        for y in (-s / 2 + 0.04, s / 2 - 0.04):
            p.box(0.045, 0.045, 0.4, x, y, 0, 'oak', bevel=0.004)
    p.box(s, 0.03, 0.4, 0, s / 2 - 0.02, 0.44, 'oak', bevel=0.004, tilt=-0.2)
    p.box(s - 0.08, s - 0.12, 0.06, 0, -0.03, 0.43, 'linen', bevel=0.02, seg=3)


def outdoor_table(p, w, d):
    for i in range(max(3, int(d / 0.12))):
        n = max(3, int(d / 0.12))
        p.box(w, d / n - 0.01, 0.03, 0, -d / 2 + d / n * (i + 0.5), 0.71, 'oak', bevel=0.004)
    for x in (-w / 2 + 0.06, w / 2 - 0.06):
        for y in (-d / 2 + 0.06, d / 2 - 0.06):
            p.box(0.05, 0.05, 0.71, x, y, 0, 'oak', bevel=0.004)


def generic(p, w, d, h=0.75):
    p.box(w, d, h, 0, 0, 0, 'walnut', bevel=0.008)


PALETTES = [
    ('#D9C7B0', '#B7866A', '#6F7F76'),   # sand, terracotta, sage
    ('#E4E0D6', '#8FA3AD', '#2F3E4C'),   # bone, mist, ink
    ('#E8DCCB', '#C99A5B', '#7A4E3A'),   # linen, ochre, umber
]


def _print_image(seed):
    """A soft colour-field print (three bands with feathered edges), generated so
    there is no third-party artwork to license."""
    name = f'art_print_{seed % len(PALETTES)}'
    if name in bpy.data.images:
        return bpy.data.images[name]
    W, H = 256, 320
    img = bpy.data.images.new(name, W, H)
    cols = [M.srgb(c)[:3] for c in PALETTES[seed % len(PALETTES)]]
    px = [0.0] * (W * H * 4)
    edges = (0.38, 0.72)
    for y in range(H):
        t = y / H
        # feathered bands, a little uneven like brushed paint
        wob = 0.012 * math.sin(y * 0.21) + 0.008 * math.sin(y * 0.047 + seed)
        for x in range(W):
            u = x / W
            f1 = min(1, max(0, (t - edges[0] - wob * math.sin(u * 9)) / 0.05))
            f2 = min(1, max(0, (t - edges[1] + wob * math.cos(u * 7)) / 0.05))
            c = [cols[0][i] * (1 - f1) + cols[1][i] * f1 for i in range(3)]
            c = [c[i] * (1 - f2) + cols[2][i] * f2 for i in range(3)]
            grain = 0.02 * math.sin(x * 12.9898 + y * 78.233 + seed) ** 2
            k = (y * W + x) * 4
            px[k:k + 4] = [c[0] + grain, c[1] + grain, c[2] + grain, 1.0]
    img.pixels = px
    img.pack()
    return img


def artwork(p, w, seed=0):
    """Framed print: thin black frame, white mat, colour-field print; local
    frame is the wall (+Y) with the print facing -Y."""
    h = w * 1.25
    p.box(w, 0.035, h, 0, 0.0, 0, 'black-steel', bevel=0.003)
    p.box(w - 0.04, 0.01, h - 0.04, 0, -0.02, 0.02, 'lacquer', bevel=0)
    mat_name = f'fit/print{seed % len(PALETTES)}'
    if mat_name not in bpy.data.materials:
        m = bpy.data.materials.new(mat_name)
        m.use_nodes = True
        t = m.node_tree.nodes.new('ShaderNodeTexImage')
        t.image = _print_image(seed)
        m.node_tree.links.new(t.outputs['Color'], m.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
        m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.8
    ob = p.box(w * 0.7, 0.004, h * 0.7, 0, -0.026, h * 0.15, bpy.data.materials[mat_name], bevel=0)
    ob['keystone_print'] = (w * 0.7, h * 0.7)


def rug(p, w, d):
    p.box(w, d, 0.012, 0, 0, 0.001, 'rug', bevel=0.004)


# -------------------------------------------------------- slot -> placement
ANGLE = {'n': 0.0, 's': math.pi, 'w': math.pi / 2, 'e': -math.pi / 2}


def local_size(slot):
    sx, sz = slot['size'][0] * FT, slot['size'][1] * FT
    return (sx, sz) if slot.get('against') in ('n', 's') else (sz, sx)


def walls_touching(slot, room_rects):
    """Sides of the slot that sit on a room wall (engine feet), in local terms."""
    cx, _, cz = slot['center']
    hx, hz = slot['size'][0] / 2, slot['size'][1] / 2
    rr = room_rects.get(slot.get('room'))
    if not rr:
        return {'n'}
    near = set()
    if abs((cz - hz) - rr[2]) < 0.4: near.add('n')
    if abs((cz + hz) - rr[3]) < 0.4: near.add('s')
    if abs((cx - hx) - rr[0]) < 0.4: near.add('w')
    if abs((cx + hx) - rr[1]) < 0.4: near.add('e')
    # to local sides (local +Y = the 'against' wall = 'n' in local terms)
    order = {'n': ['n', 'e', 's', 'w'], 's': ['s', 'w', 'n', 'e'], 'w': ['w', 'n', 'e', 's'], 'e': ['e', 's', 'w', 'n']}[slot.get('against', 'n')]
    names = ['n', 'e', 's', 'w']
    return {names[order.index(s)] for s in near}


def wall_gap(slot, room_rects):
    """Feet between a slot's back and the room wall it faces away from."""
    rr = room_rects.get(slot.get('room'))
    if not rr:
        return None
    cx, _, cz = slot['center']
    hx, hz = slot['size'][0] / 2, slot['size'][1] / 2
    a = slot.get('against', 'n')
    return {'n': (cz - hz) - rr[2], 's': rr[3] - (cz + hz), 'w': (cx - hx) - rr[0], 'e': rr[1] - (cx + hx)}[a]


def build(meta, room_rects):
    """Place every furniture slot and the per-room extras. Returns objects."""
    placed = []
    slots = meta.get('furniture', [])
    windows = meta.get('windows', [])
    by_room = {}
    for s in slots:
        by_room.setdefault(s.get('room'), []).append(s)

    def has_window_behind(slot, span=None):
        """A window on the wall this slot backs onto, within its width (or `span` feet)."""
        cx, _, cz = slot['center']
        hx, hz = slot['size'][0] / 2, slot['size'][1] / 2
        a = slot.get('against', 'n')
        rr = room_rects.get(slot.get('room'))
        gap = wall_gap(slot, room_rects) or 0
        for win in windows:
            if win['level'] != slot['level']:
                continue
            wx, wz = win['position']
            half = (span / 2 if span else (hx if a in ('n', 's') else hz)) + win.get('width', 3) / 2
            if a in ('n', 's'):
                wall_z = (rr[2] if a == 'n' else rr[3]) if rr else (cz - hz - gap if a == 'n' else cz + hz + gap)
                if abs(wz - wall_z) < 1.2 and abs(wx - cx) < half:
                    return True
            else:
                wall_x = (rr[0] if a == 'w' else rr[1]) if rr else (cx - hx - gap if a == 'w' else cx + hx + gap)
                if abs(wx - wall_x) < 1.2 and abs(wz - cz) < half:
                    return True
        return False

    counters_with_sink = set()
    for room, items in by_room.items():
        runs = [s for s in items if s['kind'] == 'counter']
        if runs:
            best = max(runs, key=lambda s: (has_window_behind(s), s['size'][0] * s['size'][1]))
            counters_with_sink.add(id(best))

    for s in slots:
        k = s['kind']
        w, d = local_size(s)
        loc = eng(s['center'])
        angle = ANGLE.get(s.get('against', 'n'), 0.0)
        p = Piece(k)
        if k in ('sofa', 'sectional', 'loveseat'):
            sofa(p, w, d)
        elif k.startswith('bed'):
            bed(p, w, d)
        elif k == 'nightstand':
            nightstand(p, w, d)
        elif k == 'dresser':
            dresser(p, w, d)
        elif k in ('dining_table', 'table'):
            dining_table(p, w, d)
        elif k in ('chair', 'dining_chair'):
            # face the nearest table in the room
            tables = [t for t in by_room.get(s.get('room'), []) if t['kind'] in ('dining_table', 'table', 'kitchen_island', 'desk')]
            if tables:
                t = min(tables, key=lambda t: (t['center'][0] - s['center'][0]) ** 2 + (t['center'][2] - s['center'][2]) ** 2)
                v = eng(t['center']) - loc
                angle = math.atan2(v.x, -v.y)  # local -Y (the seat front) toward the table
            chair(p, min(s['size']) * FT, min(s['size']) * FT)
        elif k == 'coffee_table':
            coffee_table(p, w, d)
        elif k in ('console', 'media', 'tv_console'):
            # no TV across a window: a lamp instead
            credenza(p, w, d, tv=s.get('roomType') in ('living_room', 'family_room', 'great_room') and not has_window_behind(s))
        elif k == 'bench':
            bench(p, w, d)
        elif k in ('counter', 'laundry_counter'):
            laundry = k == 'laundry_counter' or s.get('roomType') == 'laundry'
            counter(p, w, d, cab='lacquer' if laundry else 'lacquer-sage', sink=id(s) in counters_with_sink,
                    uppers=not laundry and not has_window_behind(s), top='marble')
        elif k == 'refrigerator':
            fridge(p, w, d)
        elif k in ('stove', 'range'):
            stove(p, w, d)
        elif k in ('kitchen_island', 'island'):
            island(p, w, d)
        elif k == 'toilet':
            toilet(p, w, d)
        elif k in ('vanity', 'sink'):
            vanity(p, w, d)
        elif k == 'shower':
            shower(p, w, d, walls_touching(s, room_rects))
        elif k in ('tub', 'bathtub'):
            tub(p, w, d, walls_touching(s, room_rects))
        elif k in ('washer', 'dryer'):
            washer(p, w, d, dryer=k == 'dryer')
        elif k == 'stacked_washer_dryer':
            washer(p, w, d)
            top = Piece('dryer')
            washer(top, w, d, dryer=True)
            for part in top.parts:  # the dryer sits on the washer
                part.location.z += 0.88
                p.parts.append(part)
        elif k in ('closet_storage', 'shelving'):
            closet(p, w, d)
        elif k == 'desk':
            desk(p, w, d)
        elif k in ('desk_chair', 'office_chair'):
            desk_chair(p, w, d)
        elif k == 'treadmill':
            treadmill(p, w, d)
        elif k == 'exercise_mat':
            exercise_mat(p, w, d)
        elif k == 'play_mat':
            play_mat(p, w, d)
        elif k == 'toy_storage':
            toy_storage(p, w, d)
        elif k == 'outdoor_chair':
            outdoor_chair(p, w, d)
        elif k == 'outdoor_table':
            outdoor_table(p, w, d)
        elif k in ('armchair', 'chair_arm'):
            placed += place_model('mid_century_lounge_chair', loc, angle, fit_w=w, fit_d=d)
            continue
        elif k == 'car':
            long_x = s['size'][0] >= s['size'][1]
            placed += place_model('covered_car', loc, 0 if long_x else math.pi / 2, fit_w=max(w, d) * 0.95, fit_d=min(w, d) * 0.95, bake=False)
            continue
        elif k in ('bookcase', 'bookshelf'):
            placed += place_model('wooden_display_shelves_01', loc, angle, fit_w=w, fit_d=d)
            continue
        else:
            generic(p, w, d)
        ob = p.place(loc, angle)
        if ob:
            placed.append(ob)

    placed += extras(meta, by_room, room_rects, has_window_behind)
    return placed


def footprint_ft(model_id, fit_h):
    """Side (feet) of the square a library model covers when scaled to fit_h metres."""
    m = model(model_id)
    if not m:
        return None
    _, lo, hi = m
    size = hi - lo
    return max(size.x, size.y) * fit_h / max(size.z, 1e-3) / FT


def _clear(a, b, margin=0.0):
    """Rectangles (x0, x1, z0, z1) do not overlap, keeping `margin` feet apart."""
    return a[1] + margin <= b[0] or b[1] + margin <= a[0] or a[3] + margin <= b[2] or b[3] + margin <= a[2]


def door_zones(meta, level):
    """Each door's opening plus a 3 ft approach on both sides (engine feet)."""
    zones = []
    for d in meta.get('doors', []):
        if d['level'] != level:
            continue
        px, pz = d['position']
        h = d['width'] / 2
        zones.append((px - h, px + h, pz - 3, pz + 3) if d['alongX'] else (px - 3, px + 3, pz - h, pz + h))
    return zones


def plant_spot(meta, anchor, room_rect, loc, angle, w, d, side_ft):
    """Where a styling plant beside `anchor` may stand (Blender metres), or None.

    The plan has no plant, so it must not take anything the plan has: it tries
    the back corner beside the piece on either side, then further out, and takes
    the first spot inside the room that is clear of every plan piece and door
    approach on that level. Before C5e it always took the first spot, which in
    real houses was inside a nightstand (234 of 508) or in a doorway (114).
    """
    if side_ft is None or not room_rect:
        return None
    level = anchor['level']
    pieces = [(s['center'][0] - s['size'][0] / 2, s['center'][0] + s['size'][0] / 2,
               s['center'][2] - s['size'][1] / 2, s['center'][2] + s['size'][1] / 2)
              for s in meta.get('furniture', []) if s['level'] == level]
    zones = door_zones(meta, level)
    x0, x1, z0, z1 = room_rect
    half = side_ft / 2
    rot = Matrix.Rotation(angle, 3, 'Z')
    for extra in (0.0, 0.6, 1.2):
        for sgn in (1, -1):
            p = loc + rot @ Vector((sgn * (w / 2 + 0.45 + extra), d / 2 - 0.35, 0))
            ex, ez = p.x / FT, -p.y / FT
            box = (ex - half, ex + half, ez - half, ez + half)
            # leaves may brush a piece or the wall line by an inch; a doorway must stay clear
            if not (box[0] >= x0 + 0.1 and box[1] <= x1 - 0.1 and box[2] >= z0 + 0.1 and box[3] <= z1 - 0.1):
                continue
            if all(_clear(box, r, -0.1) for r in pieces) and all(_clear(box, z) for z in zones):
                return p
    return None


def extras(meta, by_room, room_rects, has_window_behind=lambda s: False):
    """Rugs, art, plants and pendants that make rooms feel lived in."""
    out = []
    rooms = {r['id']: r for r in meta.get('rooms', [])}
    for room_id, items in by_room.items():
        room = rooms.get(room_id, {})
        rtype = room.get('type', '')
        kinds = {s['kind']: s for s in items}
        sofa_s = kinds.get('sofa') or kinds.get('sectional')
        bed_s = next((s for s in items if s['kind'].startswith('bed')), None)
        table_s = kinds.get('dining_table')
        anchor = sofa_s or bed_s
        if anchor:
            w, d = local_size(anchor)
            angle = ANGLE.get(anchor.get('against', 'n'), 0.0)
            loc = eng(anchor['center'])
            p = Piece('rug')
            if bed_s is anchor:
                rug(p, w + 1.1, d * 0.75)
                ob = p.place(loc + Matrix.Rotation(angle, 3, 'Z') @ Vector((0, -d * 0.2, 0)), angle)
            else:
                rug(p, w + 0.4, 2.3)
                ob = p.place(loc + Matrix.Rotation(angle, 3, 'Z') @ Vector((0, -0.95, 0)), angle)
            out.append(ob)
            # art centred above the piece, on the room wall behind it
            gap = wall_gap(anchor, room_rects)
            if gap is not None and gap < 1.5 and not has_window_behind(anchor, span=min(1.2, w * 0.62) / FT):
                back = loc + Matrix.Rotation(angle, 3, 'Z') @ Vector((0, d / 2 + gap * FT - 0.02, 0))
                back.z = anchor['center'][1] * FT + (1.5 if bed_s is anchor else 1.2)
                ap = Piece('art')
                artwork(ap, min(1.2, w * 0.62), seed=len(out))
                out.append(ap.place(back, angle))
            # a plant beside it, where one fits (see plant_spot)
            plant, plant_h = ('potted_plant_02', 1.1) if sofa_s else ('potted_plant_04', 0.5)
            side = plant_spot(meta, anchor, room_rects.get(room_id), loc, angle, w, d, footprint_ft(plant, plant_h))
            if side is not None:
                side.z = anchor['center'][1] * FT
                out += place_model(plant, side, angle, fit_h=plant_h, name='plant')
        if table_s:
            loc = eng(table_s['center'])
            out += place_model('ceramic_vase_01', loc + Vector((0, 0, 0.76)), 0.3, fit_h=0.28, name='vase')
            ceil = max((l['position'][1] for l in meta.get('lights', []) if l.get('room') == room_id), default=table_s['center'][1] + 9)
            h = ceil * FT - 0.02
            out += place_model('modern_ceiling_lamp_01', Vector((loc.x, loc.y, h - 0.75)), 0, fit_h=0.75, name='pendant')
            LIGHTS.append(('pendant', Vector((loc.x, loc.y, h - 0.7)), 60, '#FFD39A', 0.08))
    return out
