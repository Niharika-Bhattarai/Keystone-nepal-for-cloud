"""Real Blender bed geometry check. Inputs: backend path, model metadata, assets,
output directory. Run with blender -b --factory-startup --python this.py -- ...
No substitute furniture or materials: uses the production furnishing builder.
"""
import json
import math
import os
import sys
import bpy
from mathutils import Vector

backend, metadata, assets, out = sys.argv[sys.argv.index('--') + 1:]
sys.path.insert(0, os.path.join(backend, 'bake', 'blender'))
import furniture as F
import materials as M

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
M.init(assets)
collection = bpy.data.collections.new('Furniture')
bpy.context.scene.collection.children.link(collection)
F.init(assets, collection)
with open(metadata, encoding='utf-8') as f:
    meta = json.load(f)['meta']
placed = F.build(meta, {r['id']: r['rect'] for r in meta['rooms']})
bpy.context.view_layer.update()
beds = [o for o in placed if o.get('keystone_kind') == 'bed_queen']
assert len(beds) == 4
report = []
for rotation, side in [(0, 'n'), (90, 'e'), (180, 's'), (270, 'w')]:
    slot = next(s for s in meta['furniture'] if s['room'] == f'room-{rotation}')
    center = F.eng(slot['center'])
    bed = min(beds, key=lambda ob: (ob.location - center).length)
    assert (bed.location - center).length < 0.00001
    vertices = [bed.matrix_world @ v.co for v in bed.data.vertices]
    # Above 3 feet only the headboard remains. Inspect transformed vertices;
    # checking Euler angles alone could pass with an incorrectly built asset.
    tall = [v for v in vertices if v.z - center.z > 3 * F.FT]
    assert tall, 'Missing headboard vertices'
    dx = sum(v.x - center.x for v in tall) / len(tall)
    dy = sum(v.y - center.y for v in tall) / len(tall)
    projected = {'n': dy, 's': -dy, 'e': dx, 'w': -dx}[side]
    cross = dx if side in ('n', 's') else dy
    assert projected > 0.8 and abs(cross) < 0.03, (rotation, dx, dy)
    report.append({'rotation': rotation, 'side': side, 'headboardOffsetMeters': [dx, dy], 'vertices': len(vertices)})

scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'STUDIO'
scene.display.shading.color_type = 'MATERIAL'
scene.display.shading.show_shadows = True
scene.display.shading.show_cavity = True
scene.display.shading.background_type = 'WORLD'
scene.world.color = (0.14, 0.14, 0.14)
bpy.ops.object.camera_add(location=(-0.4, 0.4, 14))
scene.camera = bpy.context.object
scene.camera.rotation_euler = (0, 0, 0)
scene.camera.data.type = 'ORTHO'
scene.camera.data.ortho_scale = 10
scene.render.resolution_x = scene.render.resolution_y = 1400
scene.render.resolution_percentage = 100
scene.render.filepath = os.path.join(out, 'blender-bed-orientations.png')
bpy.ops.render.render(write_still=True)
with open(os.path.join(out, 'blender-geometry.json'), 'w') as f:
    json.dump(report, f, indent=2)
print('BED_ORIENTATION_GEOMETRY_PASS')
