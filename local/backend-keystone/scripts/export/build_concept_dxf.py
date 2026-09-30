"""Editable concept plans. Geometry is prepared by the backend wall model."""
import io
import json
import math
import sys
import ezdxf
from ezdxf.enums import TextEntityAlignment
from cad_elevations import add_elevations
from cad_plot_style import install as install_plot_style
from cad_details import add_dimensions, add_sheet, stair_development, table, room_label_position, north_arrow


def build(data):
    doc = ezdxf.new('R2010', setup=True)
    doc.units = ezdxf.units.FT
    doc.header['$MEASUREMENT'] = 0
    install_plot_style(doc)
    msp = doc.modelspace()

    def text(target, value, point, height=.45, layer='A-ROOM', center=False):
        # Keep user labels as TEXT content, never executable formatting.
        value = str(value).replace('\n', ' ').replace('\r', ' ')[:200]
        entity = target.add_text(value, dxfattribs={'height': height, 'layer': layer})
        entity.set_placement(point, align=TextEntityAlignment.MIDDLE_CENTER if center else TextEntityAlignment.LEFT)

    doc.layers.get('A-STAIR-OVHD').dxf.linetype = 'DASHED'
    origin_x = 0
    schedule = []
    room_schedule = []
    for level in data['levels']:
        block = doc.blocks.new(f"LEVEL_{level['level']}")
        height = level['height']

        def xy(x, y):
            return (x, height - y)

        def line(a, b, layer):
            block.add_line(a, b, dxfattribs={'layer': layer})

        def rect(r, layer):
            block.add_lwpolyline([xy(r['x'], r['y']), xy(r['x'] + r['w'], r['y']),
                                  xy(r['x'] + r['w'], r['y'] + r['h']), xy(r['x'], r['y'] + r['h'])],
                                 close=True, dxfattribs={'layer': layer})

        for edge in level['outline']:
            if edge['dir'] == 'vertical':
                a, b = xy(edge['fixed'], edge['start']), xy(edge['fixed'], edge['end'])
            else:
                a, b = xy(edge['start'], edge['fixed']), xy(edge['end'], edge['fixed'])
            line(a, b, 'A-WALL')

        for opening in level['openings']:
            x, y, width = opening['x'], opening['y'], opening['width']
            vertical = opening['dir'] == 'vertical'
            layer = 'A-WINDOW' if opening['kind'] == 'window' else 'A-DOOR'
            if opening['kind'] == 'window' or opening.get('garageDoor') or opening.get('slidingDoor'):
                for offset in [-.08, .08]:
                    a = xy(x + offset, y - width / 2) if vertical else xy(x - width / 2, y + offset)
                    b = xy(x + offset, y + width / 2) if vertical else xy(x + width / 2, y + offset)
                    line(a, b, layer)
            elif not opening.get('openThreshold'):
                sign = opening['swingSign']
                hinge = xy(x, y - width / 2) if vertical else xy(x - width / 2, y)
                closed = xy(x, y + width / 2) if vertical else xy(x + width / 2, y)
                tip = (hinge[0] + sign * width, hinge[1]) if vertical else (hinge[0], hinge[1] - sign * width)
                line(hinge, tip, layer)
                a = math.degrees(math.atan2(closed[1] - hinge[1], closed[0] - hinge[0])) % 360
                b = math.degrees(math.atan2(tip[1] - hinge[1], tip[0] - hinge[0])) % 360
                if (b - a) % 360 > 180:
                    a, b = b, a
                block.add_arc(hinge, width, a, b, dxfattribs={'layer': 'A-DOOR-SWNG'})
            tag_point = xy(x + .9 if vertical else x, y if vertical else y - .9)
            text(block, opening['tag'], tag_point, .3, 'A-OPEN-TAGS', True)

        # Footprints are already rotated by the generator. Do not rotate twice.
        for item in level.get('furniture', []):
            kind = item.get('kind', '')
            layer = 'A-FIXT' if kind in ['toilet', 'shower', 'tub', 'vanity', 'sink'] else 'A-FURN'
            x, y, w, h = (item[k] for k in ['x', 'y', 'w', 'h'])
            if item.get('shape') == 'ellipse':
                block.add_ellipse(xy(x + w / 2, y + h / 2), major_axis=(w / 2, 0) if w >= h else (0, h / 2), ratio=min(w, h) / max(w, h), dxfattribs={'layer': layer})
            else:
                rect(item, layer)
            if kind.startswith('bed'):
                rotation = item.get('rotation', 0)
                if rotation in [0, 180]:
                    yy = y + h * (.2 if rotation == 0 else .8)
                    line(xy(x, yy), xy(x + w, yy), layer)
                else:
                    xx = x + w * (.8 if rotation == 90 else .2)
                    line(xy(xx, y), xy(xx, y + h), layer)
            elif kind == 'shower':
                line(xy(x, y), xy(x + w, y + h), layer)
                line(xy(x + w, y), xy(x, y + h), layer)
            elif kind == 'toilet':
                # Match saved plan convention: tank west at 90; north otherwise.
                if item.get('rotation') == 90:
                    line(xy(x + w * .3, y), xy(x + w * .3, y + h), layer)
                else:
                    line(xy(x, y + h * .3), xy(x + w, y + h * .3), layer)

        for room in level['rooms']:
            largest = max(room['parts'], key=lambda r: r['w'] * r['h'])
            px, py, full_label = room_label_position(room, level)
            x, y = xy(px, py)
            text(block, room['tag'], (x, y + (.25 if full_label else 0)), .35, center=True)
            if full_label:
                text(block, room['label'], (x, y - .25), .3, center=True)
            room_schedule.append([room['tag'], str(level['level']), room['label'], f"{room['area']:.2f}", str(len(room['parts']))])

        stairs = level.get('stairs') or {}
        for landing in stairs.get('landings', []):
            r = landing.get('rect', landing)
            if all(k in r for k in ['x', 'y', 'w', 'h']):
                rect(r, 'A-STAIR')
        for flight in stairs.get('flights', []):
            r = flight.get('rect', {})
            if not all(k in r for k in ['x', 'y', 'w', 'h']):
                continue
            rect(r, 'A-STAIR')
            start, end = flight.get('from', {}), flight.get('to', {})
            if not all(k in start and k in end for k in ['x', 'y']):
                raise ValueError('Saved stair flight endpoints are required.')
            along_x = abs(end['x'] - start['x']) > abs(end['y'] - start['y'])
            count = max(1, min(100, int(flight.get('risers', 1)) - 1))
            direction_positive = (end['x'] > start['x']) if along_x else (end['y'] > start['y'])
            for i in range(1, count):
                tread_index = i if direction_positive else count - i
                z = flight['fromZFt'] + (tread_index + 1) * stairs['riserFt']
                riser_layer = 'A-STAIR-OVHD' if not level['topLevel'] and z > 4 else 'A-STAIR-RISR' 
                if along_x:
                    x = r['x'] + r['w'] * i / count
                    line(xy(x, r['y']), xy(x, r['y'] + r['h']), riser_layer)
                else:
                    y = r['y'] + r['h'] * i / count
                    line(xy(r['x'], y), xy(r['x'] + r['w'], y), riser_layer)
            if not level['topLevel'] and flight['fromZFt'] < 4 < flight['toZFt']:
                t = max(0, min(1, ((4 - flight['fromZFt']) / stairs['riserFt'] - 1) / count))
                cut_x, cut_y = start['x'] + t * (end['x'] - start['x']), start['y'] + t * (end['y'] - start['y'])
                if along_x:
                    line(xy(cut_x - .25, r['y']), xy(cut_x + .25, r['y'] + r['h']), 'A-STAIR-CUT')
                else:
                    line(xy(r['x'], cut_y - .25), xy(r['x'] + r['w'], cut_y + .25), 'A-STAIR-CUT')
            a, b = xy(start['x'], start['y']), xy(end['x'], end['y'])
            if level['topLevel']:
                a, b = b, a
            line(a, b, 'A-STAIR-PATH')
            dx, dy = b[0] - a[0], b[1] - a[1]
            length = math.hypot(dx, dy)
            if length > 0:
                ux, uy = dx / length, dy / length
                for sign in [-1, 1]:
                    line(b, (b[0] - ux * .35 + sign * uy * .18,
                             b[1] - uy * .35 - sign * ux * .18), 'A-STAIR-PATH')
            text(block, f"{'DN' if level['topLevel'] else 'UP'} {flight.get('risers', 0)} RISERS", a, .25, 'A-STAIR-PATH')

        # Real DIMENSION entities and their rendered blocks stay editable in CAD.
        # Model units are feet; decimal feet avoid pretending CAD feet are inches.
        for p1, p2, base, angle in [((0, 0), (level['width'], 0), (0, -3), 0),
                                    ((0, 0), (0, height), (-3, 0), 90)]:
            dim = block.add_linear_dim(base=base, p1=p1, p2=p2, angle=angle,
                override={'dimtxt': .45, 'dimasz': .3, 'dimexo': .2, 'dimexe': .3,
                          'dimlfac': 1, 'dimlunit': 2, 'dimdec': 2, 'dimpost': '<> ft', 'dimlwd': 13, 'dimlwe': 9},
                dxfattribs={'layer': 'A-DIMS'})
            dim.render()
        add_dimensions(block, level)
        north_arrow(block, level, text)
        text(block, f"LEVEL {level['level']} - CONCEPT FLOOR PLAN", (0, height + 3), .8, 'A-TITLE')
        text(block, '1 drawing unit = 1 foot. Dimensions to nominal wall centrelines.', (0, -6), .4, 'A-TITLE')
        doc.modelspace().add_blockref(block.name, (origin_x, 0))
        add_sheet(doc, f"A1{int(level['level']):02d}", f"Level {level['level']} floor plan", block, text, data['brand'])
        if stairs.get('flights'):
            detail = doc.blocks.new(f"STAIR_DETAIL_{level['level']}")
            stair_development(detail, stairs, text)
            add_sheet(doc, f"A4{int(level['level']):02d}", f"Level {level['level']} stair development", detail, text, data['brand'])

        for o in level['openings']:
            kind = 'passage' if o.get('openThreshold') else 'garage door' if o.get('garageDoor') else 'sliding door' if o.get('slidingDoor') else o['kind']
            schedule.append([o['tag'], str(level['level']), kind, f"{o['width']:.3f}", f"{o['head'] - o['sill']:.3f}", f"{o['sill']:.3f}", '1'])
        origin_x += level['width'] + 20

    # Paginated schedules retain a readable paper scale on large buildings.
    for prefix, title, header, records, widths in [
        ('A6', 'BUILDING OPENING SCHEDULE - NOMINAL FEET', ['TAG', 'LEVEL', 'TYPE', 'WIDTH ft', 'HEIGHT ft', 'SILL ft', 'QTY'], schedule, [7, 5, 11, 8, 8, 8, 5]),
        ('A7', 'ROOM SCHEDULE - NOMINAL AREAS', ['TAG', 'LEVEL', 'ROOM', 'AREA sq ft', 'PARTS'], room_schedule, [7, 5, 24, 12, 6]),
    ]:
        for offset in range(0, len(records), 28):
            page = offset // 28 + 1
            schedule_block = doc.blocks.new(f'{prefix}_SCHEDULE_{page}')
            table(schedule_block, text, title, [header] + records[offset:offset + 28], widths)
            msp.add_blockref(schedule_block.name, ((page - 1) * 65, -12 if prefix == 'A6' else -65))
            add_sheet(doc, f'{prefix}{page:02d}', title, schedule_block, text, data['brand'])

    y = max(l['height'] for l in data['levels']) + 8
    text(msp, data['brand'] + ' - ARCHITECTURAL CONCEPT CAD', (0, y), 1, 'A-TITLE')
    for warning in data['warnings']:
        y += 1.2
        text(msp, warning, (0, y), .4, 'A-TITLE')
    doc.layers.get('A-ELEV-DATUM').dxf.linetype = 'DASHED'
    add_elevations(doc, data, text)
    audit = doc.audit()
    if audit.has_errors or audit.has_fixes:
        raise ValueError('Generated drawing failed the DXF audit.')
    stream = io.StringIO()
    doc.write(stream)
    return stream.getvalue()


if __name__ == '__main__':
    sys.stdout.write(build(json.load(sys.stdin)))
