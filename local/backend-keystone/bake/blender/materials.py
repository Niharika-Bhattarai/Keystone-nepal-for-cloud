"""PBR materials for the bake.

Every material is built the way the glTF exporter understands: an image
texture (optionally multiplied by a tint colour) into Base Color, the packed
AO/rough/metal map split into Roughness and Metallic, and a normal map. UVs
from the engine are in meters, so each texture is scaled by its real-world
size from Poly Haven's metadata.
"""

import json
import os

import bpy

ROOT = None
_cache = {}


def init(asset_dir):
    global ROOT
    ROOT = asset_dir
    _cache.clear()


def srgb(hex_color, alpha=1.0):
    h = hex_color.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return (*lin, alpha)


def tex_size(tex_id):
    try:
        with open(os.path.join(ROOT, 'textures', tex_id, 'info.json')) as f:
            mm = json.load(f).get('dimensionsMm')
        if mm:
            return (mm[0] / 1000.0, mm[1] / 1000.0)
    except OSError:
        pass
    return (2.0, 2.0)


def _img(path, non_color=False):
    img = bpy.data.images.load(path, check_existing=True)
    if non_color:
        img.colorspace_settings.name = 'Non-Color'
    return img


def pbr(name, color='#CCCCCC', rough=0.6, metal=0.0, tex=None, tint=None, size=None,
        emission=None, emission_strength=0.0, alpha=None, normal_strength=1.0,
        use_color_map=True, sheen=0.0, coat=0.0):
    """Create (or reuse) a material. `tex` is a Poly Haven texture id."""
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nodes, links = nt.nodes, nt.links
    bsdf = nodes['Principled BSDF']
    out = nodes['Material Output']
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Base Color'].default_value = srgb(color)
    if sheen:
        bsdf.inputs['Sheen Weight'].default_value = sheen
    if coat:
        bsdf.inputs['Coat Weight'].default_value = coat
        bsdf.inputs['Coat Roughness'].default_value = 0.05

    if tex:
        base = os.path.join(ROOT, 'textures', tex, f'{tex}_')
        w, h = size or tex_size(tex)
        uv = nodes.new('ShaderNodeUVMap')
        uv.uv_map = 'UVMap'
        mp = nodes.new('ShaderNodeMapping')
        mp.inputs['Scale'].default_value = (1.0 / w, 1.0 / h, 1.0)
        links.new(uv.outputs['UV'], mp.inputs['Vector'])

        if use_color_map and os.path.exists(base + 'diff_2k.jpg'):
            diff = nodes.new('ShaderNodeTexImage')
            diff.image = _img(base + 'diff_2k.jpg')
            links.new(mp.outputs['Vector'], diff.inputs['Vector'])
            if tint:
                mix = nodes.new('ShaderNodeMix')
                mix.data_type = 'RGBA'
                mix.blend_type = 'MULTIPLY'
                mix.inputs[0].default_value = 1.0
                links.new(diff.outputs['Color'], mix.inputs[6])
                mix.inputs[7].default_value = srgb(tint)
                links.new(mix.outputs[2], bsdf.inputs['Base Color'])
            else:
                links.new(diff.outputs['Color'], bsdf.inputs['Base Color'])

        if os.path.exists(base + 'arm_2k.jpg'):
            arm = nodes.new('ShaderNodeTexImage')
            arm.image = _img(base + 'arm_2k.jpg', non_color=True)
            links.new(mp.outputs['Vector'], arm.inputs['Vector'])
            sep = nodes.new('ShaderNodeSeparateColor')
            links.new(arm.outputs['Color'], sep.inputs['Color'])
            links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
            if metal > 0:
                links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])

        if os.path.exists(base + 'nor_gl_2k.jpg'):
            nor = nodes.new('ShaderNodeTexImage')
            nor.image = _img(base + 'nor_gl_2k.jpg', non_color=True)
            links.new(mp.outputs['Vector'], nor.inputs['Vector'])
            nm = nodes.new('ShaderNodeNormalMap')
            nm.inputs['Strength'].default_value = normal_strength
            links.new(nor.outputs['Color'], nm.inputs['Color'])
            links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])

    if emission:
        bsdf.inputs['Emission Color'].default_value = srgb(emission)
        bsdf.inputs['Emission Strength'].default_value = emission_strength
    if alpha is not None:
        bsdf.inputs['Alpha'].default_value = alpha
        for attr, val in (('blend_method', 'BLEND'), ('surface_render_method', 'BLENDED')):
            try:
                setattr(m, attr, val)
            except (AttributeError, TypeError):
                pass
    return m


# Finish keys (from the plan's finishSpec) -> texture choices.
CLADDING = [
    (('brick',), dict(tex='brick_wall_001', rough=0.85)),
    (('stucco',), dict(tex='white_stucco', rough=0.9)),
    (('stone',), dict(tex='stacked_stone_wall', rough=0.85)),
    (('concrete',), dict(tex='concrete_floor_01', use_color_map=False, color='#CFCCC6', rough=0.75, normal_strength=0.35, size=(3.0, 3.0))),
    (('board', 'batten'), dict(tex='white_planks_clean', use_color_map=False, rough=0.6, normal_strength=1.2)),
    (('cedar', 'lap', 'wood', 'fiber', 'vinyl', 'siding'), dict(tex='weathered_plank_siding', use_color_map=False, rough=0.65, normal_strength=1.4, size=(2.4, 2.4))),
]
ROOFING = [
    (('clay', 'tile'), dict(tex='clay_roof_tiles_02', rough=0.7)),
    (('slate',), dict(tex='roof_slates_02', rough=0.6)),
    (('metal', 'seam'), dict(color='#3A3F46', rough=0.35, metal=0.8)),
    (('membrane', 'flat'), dict(color='#7E8185', rough=0.85)),
    ((), dict(tex='grey_roof_01', rough=0.9)),  # asphalt, the default
]
FLOORS = [
    (('tile', 'porcelain', 'ceramic'), dict(tex='large_floor_tiles_02', rough=0.25, coat=0.2)),
    (('marble',), dict(tex='marble_01', rough=0.15)),
    (('carpet', 'wool'), dict(tex='wool_boucle', use_color_map=False, color='#CFC6B8', size=(0.5, 0.5), rough=1.0, sheen=0.4)),
    (('concrete',), dict(tex='garage_floor', rough=0.6)),
    (('herringbone', 'parquet'), dict(tex='herringbone_parquet', rough=0.35)),
    ((), dict(tex='wood_floor', rough=0.35)),
]


def pick(table, key):
    k = (key or '').lower()
    for words, spec in table:
        if not words or any(w in k for w in words):
            return dict(spec)
    return dict(table[-1][1])


def architectural(name, palette, finish):
    """Material for an engine material slot name."""
    col = (palette.get(name) or {}).get('color', '#CCCCCC')
    f = finish or {}
    n = name
    if n == 'cladding':
        spec = pick(CLADDING, f.get('primaryCladding') or 'cedar_lap')
        spec.setdefault('color', col)
        if spec.get('tex') == 'white_stucco':
            spec['tint'] = col
        return pbr('arch/cladding', **spec)
    if n == 'cladding-accent':
        spec = pick(CLADDING, f.get('accentCladding') or f.get('primaryCladding') or 'stone')
        spec.setdefault('color', col)
        return pbr('arch/cladding-accent', **spec)
    if n in ('roof', 'ridge'):
        spec = pick(ROOFING, f.get('roofing'))
        spec.setdefault('color', col)
        return pbr('arch/roof', **spec)
    if n == 'floor-public':
        return pbr('arch/floor-public', **pick(FLOORS, f.get('floorPublic') or 'hardwood'))
    if n == 'floor-wet':
        return pbr('arch/floor-wet', **pick(FLOORS, f.get('floorWet') or 'porcelain'))
    if n == 'floor-bedroom':
        spec = pick(FLOORS, f.get('floorBedroom') or 'carpet')
        return pbr('arch/floor-bedroom', **spec)
    fixed = {
        'floor-garage': dict(tex='garage_floor', rough=0.6),
        'slab': dict(tex='brushed_concrete_03', tint='#E4E1DB', rough=0.8),
        'foundation': dict(tex='brushed_concrete_03', tint='#D9D6CF', rough=0.85),
        'driveway': dict(tex='concrete_floor_01', tint='#F2F0EC', rough=0.85),
        'walkway': dict(tex='concrete_pavers_02', rough=0.8),
        'wall-paint': dict(color='#F4F2EE', rough=0.88),
        'ceiling': dict(color='#F6F5F1', rough=0.95),
        'soffit': dict(color='#F1EFE9', rough=0.7),
        'trim': dict(color='#F5F3EE', rough=0.35),
        'baseboard': dict(color='#F5F3EE', rough=0.35),
        'window-frame': dict(color='#23272D', rough=0.4, metal=0.2),
        'glass': dict(color='#C9DCE6', rough=0.0, alpha=0.14),
        'door': dict(color='#F4F1EA', rough=0.35),
        'door-exterior': dict(color=col, rough=0.3, coat=0.3),
        'garage-door': dict(color='#ECEAE4', rough=0.4),
        'stair': dict(tex='oak_veneer_01', rough=0.35, coat=0.2),
        'stair-riser': dict(color='#F5F3EE', rough=0.35),
        'handrail': dict(tex='walnut_veneer', rough=0.3, coat=0.3),
        'metal': dict(color='#B8B6B0', rough=0.3, metal=1.0),
        'gutter': dict(color='#EDEDE9', rough=0.3, metal=0.2),
        'fixture': dict(color='#FFF6E8', rough=0.3, emission='#FFE2B0', emission_strength=6.0),
    }
    if n in fixed:
        return pbr('arch/' + n, **fixed[n])
    return pbr('arch/' + n, color=col, rough=(palette.get(n) or {}).get('roughness', 0.7))


# Furniture and fit-out materials.
def fit(name):
    specs = {
        'oak': dict(tex='oak_veneer_01', rough=0.35, coat=0.15),
        'walnut': dict(tex='walnut_veneer', rough=0.3, coat=0.2),
        'linen': dict(tex='rough_linen', tint='#C9C2B6', rough=0.95, sheen=0.6),
        'linen-dark': dict(tex='rough_linen', tint='#5B5F63', rough=0.95, sheen=0.6),
        'linen-white': dict(tex='rough_linen', tint='#F3F1EC', rough=0.95, sheen=0.5),
        'velvet': dict(tex='velour_velvet', tint='#6E7F73', rough=0.8, sheen=1.0),
        'velvet-rust': dict(tex='velour_velvet', tint='#B0693F', rough=0.8, sheen=1.0),
        'rug': dict(tex='wool_boucle', use_color_map=False, color='#BDB2A2', size=(0.4, 0.4), rough=1.0, sheen=0.6),
        'marble': dict(tex='concrete_floor_01', use_color_map=False, color='#EEEDEA', rough=0.18, coat=0.5, normal_strength=0.15),
        'tile-wall': dict(tex='long_white_tiles', rough=0.15),
        'lacquer': dict(color='#F2F0EB', rough=0.25),
        'lacquer-sage': dict(color='#8E9A87', rough=0.3),
        'lacquer-navy': dict(color='#2E3A4B', rough=0.3),
        'stainless': dict(color='#C7C8C9', rough=0.22, metal=1.0),
        'black-steel': dict(color='#1E2024', rough=0.35, metal=0.9),
        'brass': dict(color='#C8A064', rough=0.25, metal=1.0),
        'chrome': dict(color='#EDEDED', rough=0.05, metal=1.0),
        'porcelain': dict(color='#F7F7F5', rough=0.08, coat=0.6),
        'black-glass': dict(color='#0C0D0F', rough=0.05, coat=1.0),
        'mirror': dict(color='#F0F0F0', rough=0.0, metal=1.0),
        'glass-clear': dict(color='#D8E6EC', rough=0.0, alpha=0.12),
        'shade': dict(color='#F4EBDD', rough=0.9, emission='#FFD9A0', emission_strength=1.5),
        'bulb': dict(color='#FFF3DC', rough=0.2, emission='#FFE0AA', emission_strength=20.0),
        'plant-pot': dict(color='#D8D2C8', rough=0.8),
        'rubber': dict(color='#141414', rough=0.8),
        'appliance-white': dict(color='#F1F1EF', rough=0.3),
    }
    return pbr('fit/' + name, **specs[name])
