"""Keystone AI high-end house bake.

Run inside Blender 4.5 LTS:
  blender -b --factory-startup --python bake/blender/bake_house.py -- \
      --in house.glb --meta house.json --assets <asset-pack> --out <dir> \
      [--sky day|golden|dusk] [--quality preview|final] [--stills] [--bake] [--device auto|cpu|gpu]

Input is the engine's bake output (scripts/build-model.js --bake): a GLB whose
vertices carry a _SOLID id, and a JSON with the metadata (lights, furniture
slots, windows, finishes). The script builds a finished scene: welded and
bevelled architecture, PBR materials, furniture, landscaping and lights.
With --stills it renders hero images; with --bake it bakes lightmaps and
exports a GLB for the browser (see lightmaps.py).
"""

import argparse
import json
import math
import os
import sys
import time

import bmesh
import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import furniture as F  # noqa: E402
import lighting as L  # noqa: E402
import materials as M  # noqa: E402

FT = 0.3048
T0 = time.time()


def log(msg):
    print(f'[bake {time.time() - T0:6.1f}s] {msg}', flush=True)


def args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--in', dest='glb', required=True)
    ap.add_argument('--meta', required=True)
    ap.add_argument('--assets', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--sky', default='day', choices=['day', 'golden', 'dusk'])
    ap.add_argument('--quality', default='preview', choices=['preview', 'final'])
    ap.add_argument('--device', default='auto', choices=['auto', 'cpu', 'gpu'])
    ap.add_argument('--stills', action='store_true')
    ap.add_argument('--bake', action='store_true')
    ap.add_argument('--blend', action='store_true', help='also save the .blend for inspection')
    ap.add_argument('--cutaway', action='store_true',
                    help='no roof, ceilings or site: open to the sky while baking and left out of the model '
                         '(the landing-page model, seen from above with the upper floor lifted)')
    ap.add_argument('--cutaway-lift', type=float, default=3.0,
                    help='metres the upper storeys are raised in a cutaway bake, so the floor below is lit as it is shown')
    return ap.parse_args(argv)


def eng(p):
    return Vector((p[0] * FT, -p[2] * FT, p[1] * FT))


# ------------------------------------------------------------------ geometry
# Joinery gets rounded edges; walls, floors and ceilings stay crisp so the
# joints between the engine's wall and floor pieces never show as grooves.
BEVEL_MATS = {'trim', 'baseboard', 'window-frame', 'stair', 'stair-riser', 'handrail', 'door', 'door-exterior',
              'garage-door', 'gutter', 'ridge', 'metal', 'walkway', 'foundation', 'cladding-accent'}


def weld_and_bevel(ob, width):
    """Weld each engine solid closed, then bevel the joinery."""
    me = ob.data
    mats = [(m.name if m else '').split('.')[0] for m in me.materials]
    bm = bmesh.new()
    bm.from_mesh(me)
    lay = bm.verts.layers.float.get('_SOLID')
    if lay is not None:
        groups = {}
        for v in bm.verts:
            groups.setdefault(int(round(v[lay])), []).append(v)
        for vs in groups.values():
            if len(vs) > 1:
                bmesh.ops.remove_doubles(bm, verts=vs, dist=1e-4)
    bw = bm.edges.layers.float.get('bevel_weight_edge') or bm.edges.layers.float.new('bevel_weight_edge')
    sharp = math.radians(35)
    for e in bm.edges:
        if len(e.link_faces) != 2 or e.calc_face_angle(0) <= sharp:
            continue
        if all(f.material_index < len(mats) and mats[f.material_index] in BEVEL_MATS for f in e.link_faces):
            e[bw] = 1.0
    bm.to_mesh(me)
    bm.free()
    if 'custom_normal' in me.attributes:
        me.attributes.remove(me.attributes['custom_normal'])
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(30))
    if width > 0:
        mod = ob.modifiers.new('bevel', 'BEVEL')
        mod.width = width
        mod.segments = 2
        mod.limit_method = 'WEIGHT'
        mod.harden_normals = True
        mod.use_clamp_overlap = True
    apply_modifiers(ob)


def apply_modifiers(ob):
    if not ob.modifiers:
        return
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    bpy.data.meshes.remove(old)


def split_materials(ob, names, suffix):
    """Move faces using any of `names` into a new object (not lightmapped)."""
    idx = [i for i, m in enumerate(ob.data.materials) if m and any(m.name.endswith('/' + n) for n in names)]
    if not idx:
        return None
    me = ob.data
    new_me = me.copy()
    for mesh, keep in ((me, False), (new_me, True)):
        bm = bmesh.new()
        bm.from_mesh(mesh)
        kill = [f for f in bm.faces if (f.material_index in idx) != keep]
        bmesh.ops.delete(bm, geom=kill, context='FACES')
        bm.to_mesh(mesh)
        bm.free()
    new = bpy.data.objects.new(f'{ob.name} {suffix}', new_me)
    for c in ob.users_collection:
        c.objects.link(new)
    new.matrix_world = ob.matrix_world
    return new


# ------------------------------------------------------------------- scene
def build_scene(a):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    with open(a.meta) as f:
        side = json.load(f)
    meta, palette = side['meta'], side.get('palette', {})
    M.init(a.assets)

    arch = bpy.data.collections.new('Architecture')
    fit = bpy.data.collections.new('Furniture')
    site = bpy.data.collections.new('Landscape')
    lights = bpy.data.collections.new('Lights')
    for c in (arch, fit, site, lights):
        bpy.context.scene.collection.children.link(c)

    log('import engine model')
    bpy.ops.import_scene.gltf(filepath=a.glb)
    imported = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    for o in list(imported):
        for c in o.users_collection:
            c.objects.unlink(o)
        if o.name.startswith('Furniture'):
            bpy.data.objects.remove(o)  # stand-ins; real furniture replaces them
            imported.remove(o)
            continue
        arch.objects.link(o)
    for o in [o for o in bpy.data.objects if o.type == 'EMPTY']:
        bpy.data.objects.remove(o)

    log('weld, bevel and dress the architecture')
    for o in imported:
        # The cutaway model is seen whole from a distance: its joinery bevels would
        # add thousands of faces nobody can see.
        weld_and_bevel(o, 0 if a.cutaway else 0.004 if o.name.startswith(('Level', 'Roof')) else 0.003)
        for i, m in enumerate(o.data.materials):
            base = (m.name if m else 'wall-paint').split('.')[0]
            o.data.materials[i] = M.architectural(base, palette, meta.get('finish'))
    for o in list(imported):
        g = split_materials(o, ('glass', 'fixture'), 'Glass')
        if g:
            g['keystone_bake'] = False

    log('lawn and planting')
    grade = meta.get('grade', -0.5) * FT
    bpy.ops.mesh.primitive_plane_add(size=90, location=(0, 0, grade))
    lawn = bpy.context.active_object
    lawn.name = 'Lawn'
    for c in lawn.users_collection:
        c.objects.unlink(lawn)
    site.objects.link(lawn)
    lawn.data.materials.append(M.pbr('site/lawn', tex='grass_ground', tint='#9FC27A', rough=0.95, size=(3.0, 3.0)))
    F.box_uv(lawn)
    F.init(a.assets, fit)
    landscape(meta, site)

    log('furniture')
    rects = {r['id']: r.get('rect') for r in meta.get('rooms', []) if r.get('rect')}
    placed = F.build(meta, rects)
    log(f'  {len(placed)} pieces')

    log('lights')
    ent = meta.get('entry') or {'inward': [0, -1]}
    front = Vector((-ent['inward'][0], ent['inward'][1], 0)).normalized()
    L.world(a.sky, a.assets, front)
    n = L.interior(meta, F.LIGHTS, lights, dusk=a.sky == 'dusk')
    log(f'  {n} interior lights')
    return meta, front


def _move(ob, coll):
    for c in ob.users_collection:
        c.objects.unlink(ob)
    coll.objects.link(ob)


def shrub(loc, r, coll, seed=0):
    """A clipped boxwood: a lumpy sphere with a leafy procedural surface."""
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=4, radius=r, location=(loc.x, loc.y, loc.z + r * 0.8))
    ob = bpy.context.active_object
    ob.scale = (1.15, 1.15, 0.9)
    tex = bpy.data.textures.new(f'shrub{seed}', 'CLOUDS')
    tex.noise_scale = 0.18
    d = ob.modifiers.new('lumps', 'DISPLACE')
    d.texture = tex
    d.strength = r * 0.25
    d.mid_level = 0.5
    ob.data.shade_smooth()
    if 'site/boxwood' not in bpy.data.materials:
        m = bpy.data.materials.new('site/boxwood')
        m.use_nodes = True
        nt = m.node_tree
        bsdf = nt.nodes['Principled BSDF']
        n = nt.nodes.new('ShaderNodeTexVoronoi')
        n.inputs['Scale'].default_value = 90
        ramp = nt.nodes.new('ShaderNodeValToRGB')
        ramp.color_ramp.elements[0].color = M.srgb('#1F3A18')
        ramp.color_ramp.elements[1].color = M.srgb('#5E8A3A')
        nt.links.new(n.outputs['Distance'], ramp.inputs['Fac'])
        nt.links.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])
        bump = nt.nodes.new('ShaderNodeBump')
        bump.inputs['Strength'].default_value = 0.8
        nt.links.new(n.outputs['Distance'], bump.inputs['Height'])
        nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
        bsdf.inputs['Roughness'].default_value = 0.7
        bsdf.inputs['Subsurface Weight'].default_value = 0.15
        m['exportColor'] = '#3F6428'  # the glTF export cannot carry the procedural leaves
    ob.data.materials.append(bpy.data.materials['site/boxwood'])
    ob['keystone_bake'] = False
    _move(ob, coll)
    return ob


def landscape(meta, coll):
    """Shrubs along the entry facade, a few trees in the yard."""
    fp = meta['footprint']
    W, D = fp['width'], fp['depth']
    ent = meta.get('entry')
    if not ent:
        return
    ox, oz = -ent['inward'][0], -ent['inward'][1]   # outward, engine XZ
    grade = meta.get('grade', -0.5)
    doors = [d for d in meta.get('exteriorDoors', []) if d['level'] == ent['level']]
    along = (1, 0) if abs(oz) > abs(ox) else (0, 1)
    half_len = (W if along[0] else D) / 2
    face = (D / 2 if along[0] else W / 2) + 0.3
    # mulch bed along the facade, boxwood shrubs in it, gaps at the doors and
    # clear of the paving the model drew (meta.site.paving, engine feet): the
    # door gaps alone let beds and shrubs spill onto the stoop and driveway.
    bed_d = 3.2
    mulch = M.pbr('site/mulch', color='#3B2A20', rough=1.0)
    paving = [p['rect'] for p in (meta.get('site') or {}).get('paving', [])]

    def footprint(t0, t1, o0, o1):
        """Engine-feet rectangle of an along-facade span t0..t1 and outward span o0..o1."""
        a = sorted((along[0] * t0 + ox * o0, along[0] * t1 + ox * o1))
        b = sorted((along[1] * t0 + oz * o0, along[1] * t1 + oz * o1))
        return (a[0], a[1], b[0], b[1])

    def on_paving(r):
        return any(r[0] < p[1] + 0.25 and p[0] - 0.25 < r[1] and r[2] < p[3] + 0.25 and p[2] - 0.25 < r[3] for p in paving)

    t = -half_len + 1.5
    i = 0
    while t < half_len - 1.5:
        blocked = any(abs((d['position'][0] if along[0] else d['position'][1]) - t) < d['width'] / 2 + (4 if d['kind'] != 'garage' else 1.5) for d in doors)
        # a shrub of radius r reaches about 1.3 r (scale and leafy lumps)
        reach = 1.3 * (0.42 + 0.08 * (i % 3)) / FT
        mid = face + bed_d / 2
        blocked = blocked or on_paving(footprint(t - 1.3, t + 1.3, face, face + bed_d)) or \
            on_paving(footprint(t - reach, t + reach, mid - reach, mid + reach))
        if not blocked:
            px = along[0] * t + ox * (face + bed_d / 2)
            pz = along[1] * t + oz * (face + bed_d / 2)
            c = eng((px, grade, pz))
            bpy.ops.mesh.primitive_cube_add(size=1, location=(c.x, c.y, c.z + 0.02))
            m = bpy.context.active_object
            m.scale = (2.6 * FT if along[0] else bed_d * FT, bed_d * FT if along[0] else 2.6 * FT, 0.08)
            m.data.materials.append(mulch)
            m['keystone_bake'] = False
            _move(m, coll)
            shrub(c + Vector((0, 0, 0.05)), 0.42 + 0.08 * (i % 3), coll, seed=i)
            i += 1
        t += 2.5
    for k, (u, v, mid, h) in enumerate([(-1, 1, 'tree_small_02', 5.5), (1, 1, 'island_tree_01', 7.0), (-1, -1, 'tree_small_02', 6.0)]):
        px = along[0] * u * (half_len + 10) + ox * v * (face + 14)
        pz = along[1] * u * (half_len + 10) + oz * v * (face + 14)
        F.place_model(mid, eng((px, grade, pz)), k * 2.1, fit_h=h, name='tree', bake=False)


# ------------------------------------------------------------------ render
def setup_render(a):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    cy = sc.cycles
    use_gpu = False
    if a.device in ('auto', 'gpu'):
        prefs = bpy.context.preferences.addons['cycles'].preferences
        for backend in ('OPTIX', 'CUDA', 'HIP', 'METAL', 'ONEAPI'):
            try:
                prefs.compute_device_type = backend
                prefs.get_devices()
                devs = [d for d in prefs.devices if d.type == backend]
                if devs:
                    for d in prefs.devices:
                        d.use = d.type == backend
                    use_gpu = True
                    break
            except TypeError:
                continue
    cy.device = 'GPU' if use_gpu else 'CPU'
    cy.samples = 96 if a.quality == 'preview' else 512
    cy.use_adaptive_sampling = True
    cy.use_denoising = True
    cy.denoiser = 'OPENIMAGEDENOISE'
    cy.max_bounces = 8
    cy.diffuse_bounces = 4
    cy.glossy_bounces = 4
    cy.transparent_max_bounces = 12
    cy.caustics_reflective = False
    cy.caustics_refractive = False
    cy.blur_glossy = 1.0
    cy.light_sampling_threshold = 0.01
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'AgX - Medium High Contrast'
    sc.render.image_settings.file_format = 'JPEG'
    sc.render.image_settings.quality = 92
    log(f'render device: {cy.device}')


def camera(name, loc, target, lens=24):
    cam = bpy.data.cameras.new(name)
    cam.lens = lens
    cam.clip_start = 0.05
    cam.clip_end = 400
    ob = bpy.data.objects.new(name, cam)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    return ob


def still(a, cam, path, w, h, exposure=0.0):
    sc = bpy.context.scene
    sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.view_settings.exposure = exposure
    sc.render.filepath = path
    t = time.time()
    bpy.ops.render.render(write_still=True)
    log(f'  {os.path.basename(path)} in {time.time() - t:.0f}s')


def stills(a, meta, front):
    fp = meta['footprint']
    span = max(fp['width'], fp['depth']) * FT
    top = max(l['ceilingY'] for l in meta['levels']) * FT
    w, h = (1600, 900) if a.quality == 'preview' else (2560, 1440)
    side = Vector((-front.y, front.x, 0))
    eye = front * span * 1.55 + side * span * 0.95
    eye.z = 3.4
    ext = camera('Exterior', eye, (side.x * span * 0.05, side.y * span * 0.05, top * 0.45), lens=24)
    still(a, ext, os.path.join(a.out, f'exterior_{a.sky}.jpg'), w, h)

    rooms = {r['type']: r for r in meta['rooms']}
    for rtype, lens in (('living_room', 16), ('kitchen', 18), ('primary_bedroom', 16)):
        r = rooms.get(rtype)
        if not r or not r.get('rect'):
            continue
        x0, x1, z0, z1 = r['rect']
        c = eng((r['center'][0], r['floorY'], r['center'][1]))
        # stand in the corner farthest from the room's biggest piece of furniture
        inset = min(2.4, (x1 - x0) / 4, (z1 - z0) / 4)
        corners = [(x0 + inset, z0 + inset), (x1 - inset, z0 + inset), (x0 + inset, z1 - inset), (x1 - inset, z1 - inset)]
        items = [s for s in meta['furniture'] if s.get('room') == r['id']]
        anchor = max(items, key=lambda s: s['size'][0] * s['size'][1]) if items else None
        if anchor:
            corners.sort(key=lambda q: -((q[0] - anchor['center'][0]) ** 2 + (q[1] - anchor['center'][2]) ** 2))
        cx, cz = corners[0]
        loc = eng((cx, r['floorY'] + 4.9, cz))
        tgt = eng((anchor['center'][0], r['floorY'] + 3.2, anchor['center'][2])) if anchor else c + Vector((0, 0, 1.2))
        cam = camera(f'Interior {rtype}', loc, tgt, lens=lens)
        still(a, cam, os.path.join(a.out, f'interior_{rtype}_{a.sky}.jpg'), w, h, exposure=0.6 if a.sky != 'dusk' else 0.2)


def remove_roof_and_ceilings():
    """Cutaway model: the roof and every ceiling (with their glass) go before any
    light is baked, so sunlight reaches the rooms the way a viewer looking down
    into them expects, and nothing of them is exported. The site goes too (paving,
    lawn, planting): the landing page shows the house alone, floating."""
    landscape = bpy.data.collections.get('Landscape')
    gone = [o for o in bpy.data.objects
            if o.name.startswith(('Roof', 'Ceiling', 'Site'))
            or (landscape and o.name in landscape.all_objects)]
    for o in gone:
        bpy.data.objects.remove(o, do_unlink=True)
    log(f'cutaway: removed {len(gone)} roof, ceiling and site objects')


def lift_upper_storeys(meta, lift):
    """Cutaway model: raise everything above the ground floor (its walls, furniture,
    glass and lights) before the light is baked. Baked stacked, the ground floor's
    rooms sat in the upper floor's shadow; baked apart, each floor is lit the way the
    page shows it. The page brings the floors together and eases them apart again."""
    levels = sorted(meta['levels'], key=lambda l: l['floorY'])
    if len(levels) < 2 or lift <= 0:
        return
    for n, lv in enumerate(levels[1:], start=1):
        floor = lv['floorY'] * FT - 0.35  # just under the storey's floor slab
        moved = []
        for o in bpy.data.objects:
            if o.parent is not None:
                continue  # children move with their root
            parts = [o, *o.children_recursive]
            zs = [(m.matrix_world @ v.co).z for m in parts if m.type == 'MESH' for v in m.data.vertices[:4000]]
            low = min(zs) if zs else o.matrix_world.translation.z
            if low >= floor:
                o.location.z += lift * n
                moved.append(o.name)
        log(f'cutaway: level {lv["level"]} raised {lift * n:.2f} m ({len(moved)} objects: {", ".join(sorted(moved)[:6])}{"..." if len(moved) > 6 else ""})')


def main():
    a = args()
    a.out = os.path.abspath(a.out)  # Blender resolves relative render paths against the drive root
    os.makedirs(a.out, exist_ok=True)
    meta, front = build_scene(a)
    if a.cutaway:
        remove_roof_and_ceilings()
        lift_upper_storeys(meta, a.cutaway_lift)
    setup_render(a)
    if a.blend:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(a.out, 'house.blend'))
    if a.stills:
        log('stills')
        stills(a, meta, front)
    if a.bake:
        import lightmaps
        lightmaps.bake_and_export(a, meta, log)
    log('done')


if __name__ == '__main__':
    main()
