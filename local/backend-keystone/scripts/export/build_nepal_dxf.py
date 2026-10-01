"""Layered DXF (R2010, millimetres) for a Nepal review hypothesis.

Reads the JSON payload prepared by lib/nepal/dxfExport.js on stdin and writes
DXF text to stdout. Drawings are laid out left to right in model space:
site drainage, each floor plan, roof plan and structural layout. Payload text
is written only as TEXT content, never as executable formatting.
"""
import io
import json
import sys

import ezdxf
from ezdxf.enums import TextEntityAlignment

LAYERS = [  # name, ACI colour, lineweight (1/100 mm)
    ('A-WALL', 7, 50), ('A-WALL-PATT', 8, 0), ('A-DOOR', 1, 25), ('A-DOOR-SWNG', 1, 13),
    ('A-GLAZ', 5, 13), ('A-FURN', 8, 13), ('A-AREA-IDEN', 7, 18), ('A-ANNO-TEXT', 7, 18),
    ('A-ANNO-TAGS', 2, 18), ('A-ANNO-DIMS', 4, 13), ('A-STAIR', 7, 18), ('A-ROOF', 7, 35),
    ('A-ROOF-OTLN', 7, 18), ('A-PRKG', 8, 13), ('P-FIXT', 6, 13), ('P-SANR-PIPE', 30, 25),
    ('P-SANR-DRAN', 30, 35), ('P-SANR-EQPM', 30, 25), ('S-GRID', 8, 13), ('S-COLS', 7, 35),
    ('S-BEAM', 1, 25), ('C-PROP', 3, 35), ('C-BLDG', 7, 25), ('P-WATR', 5, 25),
]
GAP = 9000  # mm between drawings in model space


def clean(value):
    return str(value).replace('\n', ' ').replace('\r', ' ')[:200]


def build(data):
    doc = ezdxf.new('R2010', setup=True)
    doc.units = ezdxf.units.MM
    doc.header['$INSUNITS'] = 4
    doc.header['$MEASUREMENT'] = 1
    doc.header['$LWDISPLAY'] = 1
    for name, color, weight in LAYERS:
        doc.layers.new(name, dxfattribs={'color': color, 'lineweight': weight})
    doc.layers.get('S-GRID').dxf.linetype = 'CENTER'
    doc.layers.get('S-BEAM').dxf.linetype = 'DASHED'
    doc.layers.get('P-SANR-DRAN').dxf.linetype = 'DASHED'
    style = doc.dimstyles.new('KEYSTONE_MM')
    for key, value in dict(dimtxt=150, dimasz=120, dimexe=100, dimexo=80, dimgap=40, dimdec=0,
                           dimtsz=60, dimlunit=2, dimclrd=4, dimclre=4, dimclrt=7).items():
        style.dxf.set(key, value)
    msp = doc.modelspace()

    site = data['site']
    span = site['x2'] - site['x1'] + GAP

    def text(value, p, height=180, layer='A-ANNO-TEXT', center=True):
        entity = msp.add_text(clean(value), dxfattribs={'height': height, 'layer': layer})
        entity.set_placement(p, align=TextEntityAlignment.MIDDLE_CENTER if center else TextEntityAlignment.LEFT)

    def rect(b, layer, dx, closed=True):
        pts = [(b['x1'] + dx, b['y1']), (b['x2'] + dx, b['y1']), (b['x2'] + dx, b['y2']), (b['x1'] + dx, b['y2'])]
        msp.add_lwpolyline(pts, close=closed, dxfattribs={'layer': layer})
        return pts

    def solid(b, layer, dx):
        hatch = msp.add_hatch(dxfattribs={'layer': layer})
        hatch.set_solid_fill(color=256)
        hatch.paths.add_polyline_path([(b['x1'] + dx, b['y1']), (b['x2'] + dx, b['y1']),
                                       (b['x2'] + dx, b['y2']), (b['x1'] + dx, b['y2'])], is_closed=True)

    def dim(p1, p2, base, dx, vertical=False):
        msp.add_linear_dim(base=(base[0] + dx, base[1]), p1=(p1[0] + dx, p1[1]), p2=(p2[0] + dx, p2[1]),
                           angle=90 if vertical else 0, dimstyle='KEYSTONE_MM',
                           dxfattribs={'layer': 'A-ANNO-DIMS'}).render()

    def bounds(boxes):
        return (min(b['x1'] for b in boxes), min(b['y1'] for b in boxes),
                max(b['x2'] for b in boxes), max(b['y2'] for b in boxes))

    def grid(dx, boxes, numbers=True):
        x1, y1, x2, y2 = bounds(boxes)
        letters = 'ABCDEFGHJKLMN'
        for i, x in enumerate(data['grid']['xAxesMm']):
            msp.add_line((x + dx, y1 - 1800), (x + dx, y2 + 1800), dxfattribs={'layer': 'S-GRID'})
            for y in (y1 - 2150, y2 + 2150):
                msp.add_circle((x + dx, y), 300, dxfattribs={'layer': 'S-GRID'})
                text(letters[i], (x + dx, y), 250, 'S-GRID')
        for i, y in enumerate(data['grid']['yAxesMm']):
            msp.add_line((x1 - 1800 + dx, y), (x2 + 1800 + dx, y), dxfattribs={'layer': 'S-GRID'})
            for x in (x1 - 2150, x2 + 2150):
                msp.add_circle((x + dx, y), 300, dxfattribs={'layer': 'S-GRID'})
                text(str(i + 1), (x + dx, y), 250, 'S-GRID')
        # grid chain and overall dimensions, top and left
        xs = [x1] + [x for x in data['grid']['xAxesMm'] if x1 < x < x2] + [x2]
        for a, b in zip(xs, xs[1:]):
            dim((a, y2), (b, y2), (a, y2 + 900), dx)
        dim((x1, y2), (x2, y2), (x1, y2 + 1400), dx)
        ys = [y1] + [y for y in data['grid']['yAxesMm'] if y1 < y < y2] + [y2]
        for a, b in zip(ys, ys[1:]):
            dim((x1, a), (x1, b), (x1 - 900, a), dx, vertical=True)
        dim((x1, y1), (x1, y2), (x1 - 1400, y1), dx, vertical=True)

    def title(label, dx, boxes):
        x1, y1, x2, _ = bounds(boxes)
        text(label, ((x1 + x2) / 2 + dx, y1 - 3300), 350, 'A-ANNO-TEXT')

    # 1. Site and ground drainage
    dx = 0
    rect(site, 'C-PROP', dx)
    for slab in data['levels'][0]['slabs']:
        rect(slab, 'C-BLDG', dx)
    dr = data['drainage']
    if dr.get('reservoir'):
        rect(dr['reservoir'], 'P-WATR', dx)
        r = dr['reservoir']
        text('UG WATER RESERVOIR', ((r['x1'] + r['x2']) / 2 + dx, (r['y1'] + r['y2']) / 2), 160, 'P-WATR')
    for run in dr['runs']:
        msp.add_lwpolyline([(p['x'] + dx, p['y']) for p in run], dxfattribs={'layer': 'P-SANR-DRAN'})
    for ch in dr['chambers']:
        rect(ch['box'], 'P-SANR-EQPM', dx)
        text(ch['id'], (ch['box']['x2'] + 250 + dx, ch['box']['y2']), 150, 'P-SANR-EQPM', center=False)
    rect(dr['tank'], 'P-SANR-EQPM', dx)
    t = dr['tank']
    text('SEPTIC TANK (indicative)', ((t['x1'] + t['x2']) / 2 + dx, (t['y1'] + t['y2']) / 2), 150, 'P-SANR-EQPM')
    pit = dr['pit']
    msp.add_circle((pit['centre']['x'] + dx, pit['centre']['y']), pit['diameterMm'] / 2, dxfattribs={'layer': 'P-SANR-EQPM'})
    text('SOAK PIT', (pit['centre']['x'] + dx, pit['centre']['y']), 150, 'P-SANR-EQPM')
    text('SITE AND GROUND DRAINAGE', ((site['x1'] + site['x2']) / 2 + dx, site['y1'] - 1800), 350)

    # 2. Floor plans
    for index, level in enumerate(data['levels']):
        dx = span * (index + 1)
        for slab in level['slabs']:
            rect(slab, 'C-BLDG', dx)
        grid(dx, level['slabs'])
        for wall in level['walls']:
            for b in wall['solidBoxes']:
                rect(b, 'A-WALL', dx)
                solid(b, 'A-WALL-PATT', dx)
            for o in wall['openings']:
                b, vertical = o['box'], wall['axis'] == 'vertical'
                if o['kind'] == 'window':
                    rect(b, 'A-GLAZ', dx)
                    if vertical:
                        mid = (b['x1'] + b['x2']) / 2
                        msp.add_line((mid + dx, b['y1']), (mid + dx, b['y2']), dxfattribs={'layer': 'A-GLAZ'})
                    else:
                        mid = (b['y1'] + b['y2']) / 2
                        msp.add_line((b['x1'] + dx, mid), (b['x2'] + dx, mid), dxfattribs={'layer': 'A-GLAZ'})
                elif o['kind'] == 'door':
                    width = o['end'] - o['start']
                    hinge = (wall['line'] + dx, o['start']) if vertical else (o['start'] + dx, wall['line'])
                    leaf = (hinge[0] + width, hinge[1]) if vertical else (hinge[0], hinge[1] + width)
                    msp.add_line(hinge, leaf, dxfattribs={'layer': 'A-DOOR'})
                    # Swing direction is indicative only (unverified in the engine).
                    msp.add_arc(hinge, width, 0, 90, dxfattribs={'layer': 'A-DOOR-SWNG'})
                if o.get('tag'):
                    c = ((b['x1'] + b['x2']) / 2 + dx, (b['y1'] + b['y2']) / 2)
                    # Tags sit inside the room: away from the exterior face (interior walls: +450).
                    face = wall.get('face')
                    off = (-450 if face == 'east' else 450, 0) if vertical else (0, -450 if face == 'north' else 450)
                    msp.add_ellipse((c[0] + off[0], c[1] + off[1]), major_axis=(260, 0), ratio=0.62, dxfattribs={'layer': 'A-ANNO-TAGS'})
                    text(o['tag'], (c[0] + off[0], c[1] + off[1]), 130, 'A-ANNO-TAGS')
        for col in level['columns']:
            h = col['widthMm'] / 2
            b = {'x1': col['xMm'] - h, 'y1': col['yMm'] - h, 'x2': col['xMm'] + h, 'y2': col['yMm'] + h}
            rect(b, 'S-COLS', dx)
            solid(b, 'S-COLS', dx)
        for flight in level['stair']:
            b = flight['box']
            rect(b, 'A-STAIR', dx)
            for k in range(1, flight['riserCount']):
                y = b['y1'] + (b['y2'] - b['y1']) * k / flight['riserCount']
                msp.add_line((b['x1'] + dx, y), (b['x2'] + dx, y), dxfattribs={'layer': 'A-STAIR'})
        if level.get('parking'):
            rect(level['parking'], 'A-PRKG', dx)
            p = level['parking']
            text('OPEN BIKE PARKING', ((p['x1'] + p['x2']) / 2 + dx, (p['y1'] + p['y2']) / 2), 180, 'A-PRKG')
        for item in level['furniture']:
            b = item['box']
            layer = 'P-FIXT' if item['kind'] in ('wc', 'basin', 'shower', 'sink', 'washer') else 'A-FURN'
            rect(b, layer, dx)
            cx, cy = (b['x1'] + b['x2']) / 2 + dx, (b['y1'] + b['y2']) / 2
            if item['kind'] in ('wc', 'basin', 'sink'):
                w, d = b['x2'] - b['x1'], b['y2'] - b['y1']
                major = (0, d * 0.32) if d >= w else (w * 0.32, 0)
                msp.add_ellipse((cx, cy), major_axis=major, ratio=0.7, dxfattribs={'layer': layer})
            if item['label']:
                text(item['label'], (cx, cy), 90, layer)
        for room in level['rooms']:
            b = room['box']
            cx, cy = (b['x1'] + b['x2']) / 2 + dx, (b['y1'] + b['y2']) / 2
            text(room['name'], (cx, cy + 120), 170, 'A-AREA-IDEN')
            text(f"{round((b['x2'] - b['x1']))} x {round((b['y2'] - b['y1']))} mm clear", (cx, cy - 120), 110, 'A-AREA-IDEN')
        san = level['sanitary']
        for st in san['stacks']:
            msp.add_circle((st['point']['x'] + dx, st['point']['y']), 75, dxfattribs={'layer': 'P-SANR-PIPE'})
            text(st['id'], (st['point']['x'] + 260 + dx, st['point']['y'] - 200), 120, 'P-SANR-PIPE', center=False)
        for br in san['branches']:
            msp.add_line((br['from']['x'] + dx, br['from']['y']), (br['to']['x'] + dx, br['to']['y']), dxfattribs={'layer': 'P-SANR-PIPE'})
        for tp in san['traps']:
            msp.add_circle((tp['x'] + dx, tp['y']), 60, dxfattribs={'layer': 'P-SANR-PIPE'})
        title(f"{level['id'].upper()} FLOOR PLAN  (FFL +{level['elevationMm']} mm)", dx, level['slabs'])

    # 3. Roof plan
    dx = span * (len(data['levels']) + 1)
    roof = data['roof']
    for region in roof['regions']:
        for b in region['boxes']:
            rect(b, 'A-ROOF', dx)
            rect({'x1': b['x1'] + 229, 'y1': b['y1'] + 229, 'x2': b['x2'] - 229, 'y2': b['y2'] - 229}, 'A-ROOF-OTLN', dx)
        big = max(region['boxes'], key=lambda b: (b['x2'] - b['x1']) * (b['y2'] - b['y1']))
        text(f"{region['name']} +{region['levelMm']} mm", ((big['x1'] + big['x2']) / 2 + dx, (big['y1'] + big['y2']) / 2), 200, 'A-ROOF')
    rect(roof['stairCover'], 'A-ROOF', dx)
    sc = roof['stairCover']
    text('STAIR COVER (MUMTY)', ((sc['x1'] + sc['x2']) / 2 + dx, (sc['y1'] + sc['y2']) / 2 + 700), 150, 'A-ROOF')
    msp.add_circle((roof['tank']['x'] + dx, roof['tank']['y']), roof['tank']['r'], dxfattribs={'layer': 'P-WATR'})
    text('OHT', (roof['tank']['x'] + dx, roof['tank']['y']), 150, 'P-WATR')
    rect(roof['solar'], 'A-ROOF-OTLN', dx)
    for o in roof['outlets']:
        msp.add_circle((o['x'] + dx, o['y']), 60, dxfattribs={'layer': 'P-SANR-PIPE'})
        text(f"RWP{o['n']}", (o['x'] + 200 + dx, o['y'] + 200), 120, 'P-SANR-PIPE', center=False)
    title('ROOF PLAN', dx, data['levels'][0]['slabs'])

    # 4. Structural layout (preliminary)
    dx = span * (len(data['levels']) + 2)
    ground = data['levels'][0]
    grid(dx, ground['slabs'])
    for col in data['levels'][0]['columns']:
        h = col['widthMm'] / 2
        b = {'x1': col['xMm'] - h, 'y1': col['yMm'] - h, 'x2': col['xMm'] + h, 'y2': col['yMm'] + h}
        rect(b, 'S-COLS', dx)
        solid(b, 'S-COLS', dx)
        text('C1', (col['xMm'] + 330 + dx, col['yMm'] + 260), 120, 'S-COLS', center=False)
    for beam in data['structure']['beams']:
        w = 115
        b = ({'x1': beam['from'], 'y1': beam['line'] - w, 'x2': beam['to'], 'y2': beam['line'] + w} if beam['axis'] == 'x'
             else {'x1': beam['line'] - w, 'y1': beam['from'], 'x2': beam['line'] + w, 'y2': beam['to']})
        rect(b, 'S-BEAM', dx)
        mx = (beam['from'] + beam['to']) / 2 if beam['axis'] == 'x' else beam['line'] + 250
        my = beam['line'] + 250 if beam['axis'] == 'x' else (beam['from'] + beam['to']) / 2
        text(beam['type'], (mx + dx, my), 120, 'S-BEAM')
    types = ', '.join(f"{t['id']} {t['widthMm']}x{t['depthMm']}" for t in data['structure']['beamTypes'])
    x1, y1, x2, _ = bounds(ground['slabs'])
    text(f"PRELIMINARY: C1 350x350; {types}; slab {data['structure']['slabThicknessMm']} mm - by structural design",
         ((x1 + x2) / 2 + dx, y1 - 2500), 160, 'S-BEAM')
    title('COLUMN AND BEAM LAYOUT (PRELIMINARY)', dx, ground['slabs'])

    # status and notes block under the site drawing
    y = site['y1'] - 3000
    text(data['status'], (site['x1'], y), 300, 'A-ANNO-TEXT', center=False)
    text(f"{data['location']}  |  {data['option']}  |  units: millimetres", (site['x1'], y - 500), 200, 'A-ANNO-TEXT', center=False)
    for i, note in enumerate(data['notes']):
        text(f"{i + 1}. {note}", (site['x1'], y - 900 - i * 320), 170, 'A-ANNO-TEXT', center=False)
    doc.set_modelspace_vport(height=site['y2'] - site['y1'] + 12000,
                             center=(span * (len(data['levels']) + 3) / 2, (site['y1'] + site['y2']) / 2))
    out = io.StringIO()
    doc.write(out)
    return out.getvalue()


if __name__ == '__main__':
    sys.stdout.write(build(json.load(sys.stdin)))
