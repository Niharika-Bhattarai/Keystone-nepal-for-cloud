"""Production Blender fixture geometry and ceiling grouping contract.
Run: blender -b --factory-startup --python this.py -- backend metadata assets out
"""
import json
import os
import sys
import bpy

backend, metadata, assets, out = sys.argv[sys.argv.index('--') + 1:]
sys.path.insert(0, os.path.join(backend, 'bake', 'blender'))
import furniture as F
import materials as M
import lightmaps as L

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
M.init(assets)
coll = bpy.data.collections.new('Furniture')
bpy.context.scene.collection.children.link(coll)
F.init(assets, coll)
with open(metadata, encoding='utf-8') as f:
    meta = json.load(f)['meta']
placed = F.build(meta, {r['id']: r['rect'] for r in meta['rooms']})
bpy.context.view_layer.update()
results = []
for slot in meta['furniture']:
    center = F.eng(slot['center'])
    candidates = [o for o in placed if o.get('keystone_kind') == slot['kind']]
    obj = min(candidates, key=lambda o: (o.location - center).length)
    assert (obj.location - center).length < 1e-5
    verts = [obj.matrix_world @ v.co for v in obj.data.vertices]
    sx, sz = [n * F.FT for n in slot['size']]
    assert all(abs(v.x - center.x) <= sx / 2 + 1e-5 and abs(v.y - center.y) <= sz / 2 + 1e-5 for v in verts), slot
    if slot['kind'] == 'toilet':
        tall = [v for v in verts if v.z - center.z > 0.6]
        dx = sum(v.x - center.x for v in tall) / len(tall)
        dy = sum(v.y - center.y for v in tall) / len(tall)
        assert (-dx if slot['against'] == 'w' else dy) > 0.2, (slot, dx, dy)
    else:
        assert abs(max(v.z for v in verts) - center.z - 6 * F.FT) < 1e-5
        # At half height, backing and side panels exist but the front-middle is
        # empty. Ray cast from the aisle side towards the rear must hit the back.
        from mathutils import Vector
        origin = obj.matrix_world @ Vector((0, -sz, 2 * F.FT))
        direction = obj.matrix_world.to_3x3() @ Vector((0, 1, 0))
        inverse = obj.matrix_world.inverted()
        hit, point, normal, face = obj.ray_cast(inverse @ origin, inverse.to_3x3() @ direction)
        assert hit and point.y > 0, (slot, point[:])
    results.append({'room': slot['room'], 'kind': slot['kind'], 'against': slot['against'], 'vertices': len(verts), 'boundsPass': True})

# Visual evidence of the real fit-out; upper-floor duplicates are hidden only
# in this diagnostic image, not in the geometry assertions above.
from mathutils import Vector
for obj in placed:
    obj.hide_render = obj.location.z > 2
scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'STUDIO'
scene.display.shading.color_type = 'MATERIAL'
scene.display.shading.show_shadows = True
scene.display.shading.show_cavity = True
bpy.ops.object.camera_add(location=(8, -13, 12))
scene.camera = bpy.context.object
scene.camera.rotation_euler = (Vector((0, 0, 0.6)) - scene.camera.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera.data.type = 'ORTHO'
scene.camera.data.ortho_scale = 14
scene.render.resolution_x, scene.render.resolution_y = 1600, 1100
scene.render.resolution_percentage = 100
scene.render.filepath = os.path.join(out, 'blender-fixtures.png')
bpy.ops.render.render(write_still=True)

# The production grouping step must preserve ceiling objects independently.
arch = bpy.data.collections.new('Architecture')
bpy.context.scene.collection.children.link(arch)
for name in ['Level 1', 'Level 2', 'Ceiling 1', 'Ceiling 2', 'Site']:
    bpy.ops.mesh.primitive_cube_add()
    obj = bpy.context.object
    obj.name = name
    for c in list(obj.users_collection): c.objects.unlink(obj)
    arch.objects.link(obj)
L.merge_small(meta)
assert bpy.data.objects.get('Ceiling 1') and bpy.data.objects.get('Ceiling 2')
assert bpy.data.objects.get('Level 1') and bpy.data.objects.get('Level 2')
with open(os.path.join(out, 'blender-fixture-results.json'), 'w') as f:
    json.dump({'fixtures': results, 'separateCeilings': True}, f, indent=2)
print('FIXTURE_GEOMETRY_AND_CEILING_GROUPING_PASS')
