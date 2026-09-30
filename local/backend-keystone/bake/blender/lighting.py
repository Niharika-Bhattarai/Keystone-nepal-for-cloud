"""Sky, sun and interior lights.

Every room's ceiling fixture is on (the engine exports one light slot per
room), porch sconces glow, and lamps, pendants and under-cabinet strips
come from furniture.LIGHTS. The sky is a Poly Haven HDRI; daytime scenes
add a matching sun for crisp shadows.
"""

import math
import os

import bpy
from mathutils import Vector

import materials as M

FT = 0.3048
SKIES = {
    'day': ('kloofendal_48d_partly_cloudy_puresky', 1.0, dict(elev=42, energy=4.2, color='#FFF3E2')),
    'golden': ('belfast_sunset_puresky', 1.2, dict(elev=9, energy=3.0, color='#FFC98E')),
    'dusk': ('qwantani_dusk_2_puresky', 0.9, None),
}
WARM = '#FFEBD6'   # ~3600 K: warm-white, keeps white walls white


def eng(p):
    return Vector((p[0] * FT, -p[2] * FT, p[1] * FT))


def world(sky, assets, front_dir):
    """HDRI sky plus sun. front_dir: Blender XY unit vector the house faces."""
    hdri, strength, sun = SKIES.get(sky, SKIES['day'])
    w = bpy.data.worlds.new('Sky')
    bpy.context.scene.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping')
    env = nt.nodes.new('ShaderNodeTexEnvironment')
    bg = nt.nodes.new('ShaderNodeBackground')
    out = nt.nodes.new('ShaderNodeOutputWorld')
    env.image = bpy.data.images.load(os.path.join(assets, 'hdris', f'{hdri}_4k.hdr'), check_existing=True)
    bg.inputs['Strength'].default_value = strength
    nt.links.new(tc.outputs['Generated'], mp.inputs['Vector'])
    nt.links.new(mp.outputs['Vector'], env.inputs['Vector'])
    nt.links.new(env.outputs['Color'], bg.inputs['Color'])
    nt.links.new(bg.outputs['Background'], out.inputs['Surface'])
    # light from the front-left, 40 degrees off the facade
    az = math.atan2(front_dir.y, front_dir.x) + math.radians(40)
    mp.inputs['Rotation'].default_value[2] = az
    if sun:
        d = bpy.data.lights.new('Sun', 'SUN')
        d.energy = sun['energy']
        d.angle = math.radians(0.8)
        d.color = M.srgb(sun['color'])[:3]
        ob = bpy.data.objects.new('Sun', d)
        bpy.context.scene.collection.objects.link(ob)
        el = math.radians(sun['elev'])
        to_sun = Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el)))
        ob.rotation_euler = (-to_sun).to_track_quat('-Z', 'Y').to_euler()
    return w


def _light(name, kind, loc, watts, colour, size=0.05, coll=None):
    l = bpy.data.lights.new(name, kind)
    l.energy = watts
    l.color = M.srgb(colour)[:3]
    if kind == 'AREA':
        l.shape = 'DISK'
        l.size = size
    elif kind == 'POINT':
        l.shadow_soft_size = size
    ob = bpy.data.objects.new(name, l)
    (coll or bpy.context.scene.collection).objects.link(ob)
    ob.location = loc
    return ob


def interior(meta, extra, coll, dusk=False):
    """Ceiling fixtures in every room, porch lights, lamps and pendants."""
    n = 0
    for l in meta.get('lights', []):
        loc = eng(l['position'])
        kind = l.get('kind')
        if kind == 'sconce':
            _light(f'Sconce{n}', 'POINT', loc, 25 if dusk else 12, '#FFC98A', 0.04, coll)
        else:
            area_m2 = l.get('area', 100) * FT * FT
            watts = max(20.0, min(150.0, area_m2 * 5.0))
            if kind == 'closet':
                watts = 12
            elif kind == 'bath':
                watts *= 1.2
            ob = _light(f'Ceiling{n}', 'AREA', loc - Vector((0, 0, 0.21)), watts, WARM, 0.3, coll)
            ob.data.spread = math.radians(150)
        n += 1
    for kind, loc, watts, colour, size in extra:
        if kind in ('strip', 'vanity'):
            ob = _light(f'{kind}{n}', 'AREA', loc, watts, colour, size, coll)
            ob.data.shape = 'RECTANGLE'
            ob.data.size, ob.data.size_y = size * 3, 0.05
        else:
            _light(f'{kind}{n}', 'POINT', loc, watts, colour, size, coll)
        n += 1
    return n
