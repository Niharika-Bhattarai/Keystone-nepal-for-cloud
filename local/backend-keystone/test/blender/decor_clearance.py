"""Styling stays clear of the plan (C5e), with the production bake code.

The plan has no plants, mulch beds or shrubs; the bake adds them. They must not
take what the plan has: a plant must not stand in a nightstand, a doorway or
outside its room, and planting must not spill onto the paving the model drew.
Input from test/helpers/export-decor-clearance.cjs.
Run: blender -b --factory-startup --python-exit-code 1 --python this.py -- backend metadata assets out
(without --python-exit-code Blender exits 0 even when an assertion fails)
"""
import json
import os
import sys
import bpy
from mathutils import Vector

backend, metadata, assets, out = sys.argv[sys.argv.index('--') + 1:]
sys.path.insert(0, os.path.join(backend, 'bake', 'blender'))
import furniture as F  # noqa: E402
import materials as M  # noqa: E402
import bake_house as BH  # noqa: E402

FT = F.FT
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
M.init(assets)
furn = bpy.data.collections.new('Furniture')
site = bpy.data.collections.new('Site')
for c in (furn, site):
    bpy.context.scene.collection.children.link(c)
F.init(assets, furn)
with open(metadata, encoding='utf-8') as f:
    meta = json.load(f)['meta']
rects = {r['id']: r['rect'] for r in meta['rooms']}
placed = F.build(meta, rects)
before = set(site.objects) | set(furn.objects)
BH.landscape(meta, site)
land = [o for o in list(site.objects) + list(furn.objects) if o not in before]
bpy.context.view_layer.update()


def footprint(obs):
    dg = bpy.context.evaluated_depsgraph_get()
    pts = [o.evaluated_get(dg).matrix_world @ Vector(c) for o in obs for c in o.evaluated_get(dg).bound_box]
    return (min(p.x for p in pts) / FT, max(p.x for p in pts) / FT, min(-p.y for p in pts) / FT, max(-p.y for p in pts) / FT)


def overlap(a, b, tol):
    return a[0] < b[1] - tol and b[0] < a[1] - tol and a[2] < b[3] - tol and b[2] < a[3] - tol


def slot_rect(s):
    return (s['center'][0] - s['size'][0] / 2, s['center'][0] + s['size'][0] / 2, s['center'][2] - s['size'][1] / 2, s['center'][2] + s['size'][1] / 2)


# plant meshes (pot, soil, leaves) grouped by the anchor they stand beside
plants = [o for o in placed if o.get('keystone_kind') == 'plant']
groups = []
for o in plants:
    fp = footprint([o])
    for g in groups:
        if overlap(g['fp'], fp, -0.01):
            g['obs'].append(o)
            g['fp'] = footprint(g['obs'])
            break
    else:
        groups.append({'obs': [o], 'fp': fp})
results = {'plants': []}
problems = []
# each door's opening plus a 3 ft approach on both sides (computed here, not by
# the code under test, so the same check runs against older bake code)
zones = []
for d in meta['doors']:
    (px, pz), h = d['position'], d['width'] / 2
    zones.append((px - h, px + h, pz - 3, pz + 3) if d['alongX'] else (px - 3, px + 3, pz - h, pz + h))
pieces = [(s['kind'], slot_rect(s)) for s in meta['furniture']]
for g in groups:
    fp = g['fp']
    c = ((fp[0] + fp[1]) / 2, (fp[2] + fp[3]) / 2)
    room = next(r for r in meta['rooms'] if r['rect'][0] <= c[0] <= r['rect'][1] and r['rect'][2] <= c[1] <= r['rect'][3])
    hits = [k for k, r in pieces if overlap(fp, r, 0.1)]
    doorway = [z for z in zones if overlap(fp, z, 0.0)]
    r = room['rect']
    results['plants'].append({'room': room['id'], 'at': [round(v, 2) for v in fp], 'pieces': hits, 'doorway': bool(doorway)})
    if hits:
        problems.append(f'plant in {room["id"]} overlaps {hits}: {fp}')
    if doorway:
        problems.append(f'plant in {room["id"]} stands in a doorway: {fp}')
    if not (fp[0] >= r[0] - 0.05 and fp[1] <= r[1] + 0.05 and fp[2] >= r[2] - 0.05 and fp[3] <= r[3] + 0.05):
        problems.append(f'plant leaves {room["id"]}: {fp}')
# one plant beside the bed (clear of both nightstands) and one beside the sofa
if sorted(p['room'] for p in results['plants']) != ['bed', 'living']:
    problems.append(f'expected one plant in bed and one in living: {results["plants"]}')

paving = [(p['kind'], tuple(p['rect'])) for p in meta['site']['paving']]
results['planting'] = []
for o in land:
    if o.get('keystone_kind') == 'tree':
        continue
    fp = footprint([o])
    kind = 'shrub' if o.name.startswith('Icosphere') else 'mulch'
    on = [k for k, r in paving if overlap(fp, r, 0.0)]
    results['planting'].append({'kind': kind, 'at': [round(v, 2) for v in fp], 'paving': on})
    if on:
        problems.append(f'{kind} on {on}: {fp}')
if len(results['planting']) < 4:
    problems.append('the facade lost its planting')
results['problems'] = problems
results['pass'] = not problems
os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
with open(out, 'w', encoding='utf-8') as f:
    json.dump(results, f, indent=2)
print(json.dumps({'plants': results['plants'], 'planting': len(results['planting']), 'problems': problems}, indent=1))
assert not problems, f'{len(problems)} clearance problems'
print('DECOR CLEARANCE PASS')
