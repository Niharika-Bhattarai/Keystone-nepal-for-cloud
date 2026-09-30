"""Verify actual imported/beveled architecture, then save diagnostic views.
blender -b --factory-startup --python this.py -- backend fixture-directory
Inputs are produced by test/helpers/export-openings-stairs.cjs.
"""
import json
import os
import sys
import bpy
from mathutils import Vector

backend, root = sys.argv[sys.argv.index('--') + 1:]
sys.path.insert(0, os.path.join(backend, 'bake', 'blender'))
from bake_house import weld_and_bevel
FT = 0.3048
results = []

def material_points(objects, material):
    result = []
    for ob in objects:
        for face in ob.data.polygons:
            mat = ob.data.materials[face.material_index]
            if mat and mat.name.split('.')[0] == material:
                result.extend(ob.matrix_world @ ob.data.vertices[i].co for i in face.vertices)
    return result

for case in json.load(open(os.path.join(root, 'fixtures.json'))):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(root, case['name'] + '.glb'))
    objects = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    for ob in objects:
        weld_and_bevel(ob, 0.004 if ob.name.startswith(('Level', 'Roof')) else 0.003)
    bpy.context.view_layer.update()
    level1 = [o for o in objects if o.name.startswith('Level 1')]
    if case['kind'] == 'openings':
        points = material_points(level1, 'glass')
        assert points
        # The slider is on the min-Y-plan wall; engine Z is Blender -Y.
        fixed = 0 if case['vertical'] else 1
        wall = -10 * FT if case['vertical'] else 10 * FT
        slider = [p for p in points if abs(p[fixed] - wall) < 0.3 * FT]
        assert slider and max(p.z for p in slider) > 7.5 * FT
        assert not material_points(level1, 'door-exterior'), 'no giant hinged slider'
        assert all(abs(p[fixed] - wall) <= 0.3 * FT for p in slider)
        window_wall = -wall
        frame = [p for p in material_points(level1, 'window-frame') if abs(p[fixed] - window_wall) < 0.3 * FT]
        assert abs(min(p.z for p in frame) - 2.25 * FT) < 0.005
        assert abs(max(p.z for p in frame) - 8.25 * FT) < 0.005
    else:
        points = material_points(level1, 'stair')
        assert points
        for flight in case['flights']:
            for step in range(1, flight['risers']):
                top = flight['fromZFt'] + step * (flight['toZFt'] - flight['fromZFt']) / flight['risers']
                assert any(abs(p.z - top * FT) < 0.005 for p in points), (case['name'], top)
        floor = material_points(level1, 'floor-public')
        assert abs(max(p.z for p in floor)) < 0.005, 'finished floor and stairs share datum'
        # A downward ray inside the upper floor hole must reach the stair/ground,
        # never a Level 2 slab. Restrict to Level 2 to exclude ceilings/landscape.
        hole = case['hole']
        origin = Vector(((hole['x'] + hole['w']/2 - 16)*FT, -(hole['y'] + hole['h']/2 - 16)*FT, 11*FT))
        for ob in [o for o in objects if o.name.startswith('Level 2')]:
            inverse = ob.matrix_world.inverted()
            hit, point, normal, face = ob.ray_cast(inverse @ origin, inverse.to_3x3() @ Vector((0,0,-1)), distance=2*FT)
            assert not hit, 'upper-floor geometry blocks the reserved stair opening'
    results.append({'name':case['name'], 'productionWeldAndBevel':True, 'geometryPass':True})
    for ob in objects:
        ob.hide_render = ob.name.startswith(('Ceiling', 'Roof', 'Level 2'))
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'MATERIAL'
    scene.display.shading.show_cavity = True
    target = Vector((0,0,0)) if case['kind']=='openings' else Vector((-1,-.5,.8))
    bpy.ops.object.camera_add(location=target+Vector((5,-7,17)))
    scene.camera = bpy.context.object
    scene.camera.rotation_euler = (target-scene.camera.location).to_track_quat('-Z','Y').to_euler()
    scene.camera.data.type='ORTHO'
    scene.camera.data.ortho_scale=11
    scene.render.resolution_x=1200
    scene.render.resolution_y=900
    scene.render.resolution_percentage=100
    scene.render.filepath=os.path.join(root,case['name']+'.png')
    bpy.ops.render.render(write_still=True)

with open(os.path.join(root,'blender-results.json'),'w') as f:
    json.dump(results,f,indent=2)
print('OPENINGS_STAIRS_BLENDER_PASS')
