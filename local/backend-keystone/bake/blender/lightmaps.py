"""Lightmap bake and web export.

Every static object gets a second UV map ("Lightmap") and a baked diffuse
lighting texture: sun, sky and every interior light, with bounced light,
denoised. The browser multiplies it with the material's albedo, so the
walkthrough shows real global illumination at full frame rate.

Output (in --out):
  house.glb       - geometry + PBR materials; each material's extras carry
                    {"lightmap": "lm_<object>.jpg", "lightmapScale": 4}
  lm_*.jpg        - lightmaps, stored as sRGB of (irradiance / 4)
  bake.json       - timings and sizes
"""

import json
import math
import os
import time

import bpy

LM_SCALE = 4.0  # stored = srgb(irradiance / LM_SCALE); the viewer multiplies back


def _objects_for_bake():
    out = []
    for coll_name in ('Architecture', 'Furniture', 'Landscape'):
        coll = bpy.data.collections.get(coll_name)
        if not coll:
            continue
        for ob in coll.objects:
            if ob.type == 'MESH' and ob.get('keystone_bake', True) and len(ob.data.polygons):
                out.append(ob)
    return out


def _join(objs, name):
    if not objs:
        return None
    root = objs[0]
    for o in objs:
        for s in o.material_slots:
            pass
        if not o.data.uv_layers:
            o.data.uv_layers.new(name='UVMap')
        o.data.uv_layers[0].name = 'UVMap'
    with bpy.context.temp_override(active_object=root, object=root, selected_objects=objs, selected_editable_objects=objs):
        bpy.ops.object.join()
    root.name = name
    return root


def group_furniture(meta):
    """Join furniture into one object per storey (one lightmap each)."""
    coll = bpy.data.collections['Furniture']
    levels = sorted(meta['levels'], key=lambda l: l['floorY'])
    floors = [l['floorY'] * 0.3048 for l in levels]
    groups = {i: [] for i in range(len(levels))}
    for ob in list(coll.objects):
        if ob.type != 'MESH' or not ob.get('keystone_bake', True):
            continue
        z = min((ob.matrix_world @ v.co).z for v in ob.data.vertices[:64]) if len(ob.data.vertices) else 0
        i = max([k for k, f in enumerate(floors) if z >= f - 0.3] or [0])
        groups[i].append(ob)
    out = []
    for i, objs in groups.items():
        j = _join(objs, f'Furniture {levels[i]["level"]}')
        if j:
            out.append(j)
    return out


def _area(ob):
    m = ob.matrix_world
    s = sum(p.area for p in ob.data.polygons)
    scale = (m.to_scale().x * m.to_scale().y + m.to_scale().y * m.to_scale().z + m.to_scale().x * m.to_scale().z) / 3
    return s * scale


def dissolve_coplanar(ob):
    """Merge coplanar neighbours into single faces so each wall panel or floor
    becomes one lightmap island (no seams across a flat surface)."""
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    # join slabs and wall pieces that merely touch, so a whole ceiling or floor
    # across rooms becomes one surface
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(0.5), use_dissolve_boundaries=False,
                             verts=bm.verts, edges=bm.edges, delimit={'MATERIAL'})
    bm.to_mesh(ob.data)
    bm.free()


def lightmap_uv(ob, margin):
    bpy.context.view_layer.objects.active = ob
    for o in bpy.context.view_layer.objects:
        o.select_set(o == ob)
    me = ob.data
    if 'UVMap' not in me.uv_layers:
        me.uv_layers.new(name='UVMap')
    lm = me.uv_layers.get('Lightmap') or me.uv_layers.new(name='Lightmap')
    me.uv_layers.active = lm
    me.uv_layers['UVMap'].active_render = True
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    # Every face gets texture space in proportion to its area, packed tight;
    # the margin keeps bilinear filtering from bleeding between faces.
    bpy.ops.uv.lightmap_pack(PREF_CONTEXT='ALL_FACES', PREF_PACK_IN_ONE=True, PREF_NEW_UVLAYER=False,
                             PREF_BOX_DIV=12, PREF_MARGIN_DIV=margin)
    bpy.ops.object.mode_set(mode='OBJECT')


def unique_materials(ob):
    for slot in ob.material_slots:
        if slot.material and '@' not in slot.material.name:
            m = slot.material.copy()
            m.name = f'{slot.material.name}@{ob.name}'
            slot.material = m


def _coverage(img):
    """Share of lightmap pixels that received light (a packing sanity check)."""
    px = img.pixels[:]
    n = len(px) // 4
    step = max(1, n // 20000)
    lit = sum(1 for i in range(0, n, step) if px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2] > 1e-4)
    return round(lit / len(range(0, n, step)), 3)


def bake_vertex_light(ob):
    """Furniture: bake lighting into a per-corner colour attribute ('Light'),
    stored as irradiance / LM_SCALE."""
    me = ob.data
    ca = me.color_attributes.get('Light') or me.color_attributes.new('Light', 'FLOAT_COLOR', 'CORNER')
    me.color_attributes.active_color = ca
    bpy.context.view_layer.objects.active = ob
    for o in bpy.context.view_layer.objects:
        o.select_set(o == ob)
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, use_clear=True, target='VERTEX_COLORS')
    k = 1.0 / LM_SCALE
    vals = [0.0] * (len(ca.data) * 4)
    ca.data.foreach_get('color', vals)
    for i in range(0, len(vals), 4):
        vals[i] *= k
        vals[i + 1] *= k
        vals[i + 2] *= k
        vals[i + 3] = 1.0
    ca.data.foreach_set('color', vals)
    for slot in ob.material_slots:
        if slot.material:
            slot.material['vertexLight'] = True
            slot.material['lightmapScale'] = LM_SCALE


def bake_object(ob, img):
    for slot in ob.material_slots:
        m = slot.material
        if not m or not m.use_nodes:
            continue
        nt = m.node_tree
        n = nt.nodes.get('LM') or nt.nodes.new('ShaderNodeTexImage')
        n.name = 'LM'
        n.image = img
        for other in nt.nodes:
            other.select = False
        n.select = True
        nt.nodes.active = n
    bpy.context.view_layer.objects.active = ob
    for o in bpy.context.view_layer.objects:
        o.select_set(o == ob)
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, margin=8, margin_type='EXTEND', use_clear=True, target='IMAGE_TEXTURES')
    for slot in ob.material_slots:
        m = slot.material
        if m and m.use_nodes and 'LM' in m.node_tree.nodes:
            m.node_tree.nodes.remove(m.node_tree.nodes['LM'])


def encode(img, path):
    """Denoise the float lightmap and write srgb(irradiance / LM_SCALE) as JPEG."""
    sc = bpy.context.scene
    engine = sc.render.engine
    res = (sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage)
    vt, look, exp = sc.view_settings.view_transform, sc.view_settings.look, sc.view_settings.exposure
    sc.use_nodes = True
    tree = sc.node_tree
    tree.nodes.clear()
    src = tree.nodes.new('CompositorNodeImage')
    src.image = img
    dn = tree.nodes.new('CompositorNodeDenoise')
    dn.use_hdr = True
    dn.prefilter = 'ACCURATE'
    scale = tree.nodes.new('CompositorNodeMixRGB')
    scale.blend_type = 'MULTIPLY'
    scale.inputs[2].default_value = (1 / LM_SCALE, 1 / LM_SCALE, 1 / LM_SCALE, 1)
    comp = tree.nodes.new('CompositorNodeComposite')
    tree.links.new(src.outputs['Image'], dn.inputs['Image'])
    tree.links.new(dn.outputs['Image'], scale.inputs[1])
    tree.links.new(scale.outputs['Image'], comp.inputs['Image'])
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.render.resolution_x, sc.render.resolution_y = img.size
    sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.view_settings.exposure = 0.0
    hidden = []
    for o in bpy.context.view_layer.objects:
        if not o.hide_render:
            o.hide_render = True
            hidden.append(o)
    bpy.ops.render.render()
    rr = bpy.data.images['Render Result']
    sc.render.image_settings.file_format = 'JPEG'
    sc.render.image_settings.quality = 90
    sc.render.image_settings.color_mode = 'RGB'
    rr.save_render(path)
    for o in hidden:
        o.hide_render = False
    sc.use_nodes = False
    sc.render.engine = engine
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = res
    sc.view_settings.view_transform, sc.view_settings.look, sc.view_settings.exposure = vt, look, exp


def shrink_textures(max_color=1024, max_data=512):
    """Web budget: colour maps to 1k, packed data and normal maps to 512."""
    for img in bpy.data.images:
        if img.name.startswith(('LM_', 'Render Result')) or img.source != 'FILE' or not img.has_data and not img.filepath:
            continue
        try:
            w, h = img.size
        except Exception:
            continue
        if not w:
            continue
        limit = max_data if img.colorspace_settings.name == 'Non-Color' else max_color
        if max(w, h) > limit:
            k = limit / max(w, h)
            img.scale(max(1, int(w * k)), max(1, int(h * k)))


def decimate_heavy(limit_tris=10000):
    """Trees and imported plants are film-quality meshes; thin them for the web."""
    for ob in bpy.data.objects:
        if ob.type != 'MESH':
            continue
        tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
        if tris > limit_tris and not ob.name.startswith(('Level', 'Roof', 'Furniture', 'Ceiling')):
            mod = ob.modifiers.new('web', 'DECIMATE')
            mod.ratio = max(0.005, limit_tris / tris)


def drop_library():
    lib = bpy.data.collections.get('ModelLibrary')
    if lib:
        for ob in list(lib.objects):
            bpy.data.objects.remove(ob)
        bpy.data.collections.remove(lib)


def merge_small(meta):
    """Fold the site into its storey; keep ceilings separately toggleable.

    Joining Ceiling into Level destroys the boundary the quick/HQ viewers need
    for floor cutaways. Bake it independently and preserve its name on export.
    """
    arch = bpy.data.collections['Architecture']
    for lv in meta['levels']:
        n = lv['level']
        parts = [bpy.data.objects.get(f'Level {n}')]
        if n == meta['levels'][0]['level']:
            parts.append(bpy.data.objects.get('Site'))
        parts = [p for p in parts if p and p.name in arch.objects]
        if len(parts) > 1:
            _join(parts, f'Level {n}')


class MatteForBake:
    """While baking, every surface is matte: metals, coats and sheen would
    otherwise hide their diffuse light from the DIFFUSE pass."""

    KEYS = ('Metallic', 'Coat Weight', 'Sheen Weight', 'Specular IOR Level')

    def __enter__(self):
        self.saved = []
        for m in bpy.data.materials:
            if not m.use_nodes:
                continue
            for n in m.node_tree.nodes:
                if n.type != 'BSDF_PRINCIPLED':
                    continue
                for k in self.KEYS:
                    sock = n.inputs.get(k)
                    if sock is None:
                        continue
                    links = [l for l in m.node_tree.links if l.to_socket == sock]
                    self.saved.append((m, sock, sock.default_value, [(l.from_socket, l.to_socket) for l in links]))
                    for l in links:
                        m.node_tree.links.remove(l)
                    sock.default_value = 0.5 if k == 'Specular IOR Level' else 0.0
        return self

    def __exit__(self, *exc):
        for m, sock, val, links in self.saved:
            sock.default_value = val
            for a, b in links:
                m.node_tree.links.new(a, b)


class TreesOutOfBake:
    """The real-time viewer hides the film-quality trees (their leaf cards thin
    out), so they must not shade what is baked for it either. Otherwise the lawn
    lightmap keeps leafy shadows and near-black trunk footprints with nothing
    casting them. The photographs are rendered before the bake and keep them."""

    def __enter__(self):
        self.hidden = [o for o in bpy.data.objects if o.get('keystone_kind') == 'tree' and not o.hide_render]
        for o in self.hidden:
            o.hide_render = True
        return self

    def __exit__(self, *exc):
        for o in self.hidden:
            o.hide_render = False


def flatten_procedural():
    """glTF only carries image textures: give procedurally coloured materials
    their representative colour (material['exportColor']) before export."""
    import materials as M
    for m in bpy.data.materials:
        col = m.get('exportColor')
        if not col or not m.use_nodes:
            continue
        for n in m.node_tree.nodes:
            if n.type == 'BSDF_PRINCIPLED':
                sock = n.inputs['Base Color']
                for l in list(sock.links):
                    m.node_tree.links.remove(l)
                sock.default_value = M.srgb(col)


def bake_and_export(a, meta, log):
    sc = bpy.context.scene
    t0 = time.time()
    preview = a.quality == 'preview'
    texels_per_m = 48 if preview else 96
    sc.cycles.samples = 128 if preview else 512
    sc.cycles.use_denoising = False  # lightmaps are denoised in encode()
    sc.render.bake.margin = 8

    log('lightmaps: grouping furniture')
    furniture = group_furniture(meta)
    if getattr(a, 'cutaway', False):
        # Seen whole from a distance: lighter furniture, decimated before its light is
        # baked (baked per corner, it cannot be simplified afterwards).
        for ob in furniture:
            before = len(ob.data.polygons)
            mod = ob.modifiers.new('decimate', 'DECIMATE')
            mod.ratio = 0.3
            bpy.context.view_layer.objects.active = ob
            bpy.ops.object.modifier_apply(modifier=mod.name)
            log(f'  {ob.name}: {before} -> {len(ob.data.polygons)} faces (cutaway)')
    merge_small(meta)
    report = {'objects': [], 'quality': a.quality}
    targets = _objects_for_bake()
    matte = MatteForBake().__enter__()
    trees = TreesOutOfBake().__enter__()
    log(f'  {len(trees.hidden)} tree meshes kept out of the lightmaps')
    for ob in targets:
        if ob.name.startswith('Furniture'):
            t = time.time()
            unique_materials(ob)
            bake_vertex_light(ob)
            report['objects'].append({'name': ob.name, 'vertexLight': True, 'corners': len(ob.data.loops), 'seconds': round(time.time() - t, 1)})
            log(f'  {ob.name}: vertex light on {len(ob.data.loops)} corners, {time.time() - t:.0f}s')
            continue
        dissolve_coplanar(ob)
        area = _area(ob)
        cap = 2048 if ob.name == 'Lawn' else 4096
        size = int(min(cap, max(256, 2 ** math.ceil(math.log2(max(1.0, math.sqrt(area) * texels_per_m))))))
        t = time.time()
        unique_materials(ob)
        lightmap_uv(ob, margin=0.15 if size <= 1024 else 0.1)
        img = bpy.data.images.new(f'LM_{ob.name}', size, size, float_buffer=True, alpha=False)
        bake_object(ob, img)
        fname = 'lm_' + ''.join(ch if ch.isalnum() else '_' for ch in ob.name.lower()) + '.jpg'
        encode(img, os.path.join(a.out, fname))
        for slot in ob.material_slots:
            if slot.material:
                slot.material['lightmap'] = fname
                slot.material['lightmapScale'] = LM_SCALE
        used = _coverage(img)
        report['objects'].append({'name': ob.name, 'area_m2': round(area, 1), 'size': size, 'coverage': used, 'seconds': round(time.time() - t, 1)})
        log(f'  {ob.name}: {size}px, {area:.0f} m2, {used:.0%} of the map used, {time.time() - t:.0f}s')

    trees.__exit__(None, None, None)
    matte.__exit__(None, None, None)
    flatten_procedural()
    log('export GLB')
    drop_library()
    shrink_textures()
    decimate_heavy()
    path = os.path.join(a.out, 'house.glb')
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=False, export_extras=True,
        export_texcoords=True, export_normals=True, export_materials='EXPORT',
        export_image_format='JPEG', export_jpeg_quality=85, export_apply=True,
        export_vertex_color='NAME', export_vertex_color_name='Light',
        export_lights=False, export_cameras=False, export_yup=True)
    report['glb_bytes'] = os.path.getsize(path)
    report['seconds'] = round(time.time() - t0, 1)
    with open(os.path.join(a.out, 'bake.json'), 'w') as f:
        json.dump(report, f, indent=1)
    log(f'  house.glb {report["glb_bytes"] / 1e6:.1f} MB, bake {report["seconds"]}s')
