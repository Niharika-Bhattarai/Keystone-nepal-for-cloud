"""Native CAD dimensions and paper sheets; feet modelspace, inches paperspace."""
import math
from ezdxf import bbox
from shapely.geometry import box
from shapely.ops import unary_union
from cad_plot_style import configure_sheet


def dimension(target, p1, p2, base, angle=0):
    if math.dist(p1, p2) < 1e-6:
        return
    # ezdxf's renderer does not format DIMLUNIT=4 architectural fractions.
    # Supply formatted text, retaining measured endpoints in a native entity.
    sixteenths = round(math.dist(p1, p2) * 12 * 16)
    feet, remainder = divmod(sixteenths, 192)
    inches, numerator = divmod(remainder, 16)
    divisor = math.gcd(numerator, 16)
    fraction = f' {numerator // divisor}/{16 // divisor}' if numerator else ''
    label = f'{feet}\'-{inches}{fraction}"'
    dim = target.add_linear_dim(base=base, p1=p1, p2=p2, angle=angle, text=label,
        override={'dimtxt': .28, 'dimasz': .18, 'dimexo': .12, 'dimexe': .18,
                  'dimlfac': 12, 'dimlunit': 4, 'dimdec': 4,
                  'dimlwd': 13, 'dimlwe': 9, 'dimclrd': 256, 'dimclre': 256, 'dimclrt': 256},
        dxfattribs={'layer': 'A-DIMS-DETAIL'})
    dim.render()


def add_dimensions(block, level):
    height = level['height']
    def xy(x, y):
        return x, height - y
    # One chain per actual wall axis. Openings are measured to their jambs,
    # partitions to nominal centrelines. Recessed walls retain their own axes.
    groups = {}
    for wall in level['walls']:
        key = wall['dir'], round(wall['axis'], 6)
        groups.setdefault(key, []).append(wall)
    for (direction, axis), walls in groups.items():
        vertical = direction == 'vertical'
        points = {round(v, 6) for wall in walls for v in (wall['start'], wall['end'])}
        for opening in level['openings']:
            if opening['dir'] != direction or abs((opening['x'] if vertical else opening['y']) - axis) > 1e-6:
                continue
            center = opening['y'] if vertical else opening['x']
            points.update(round(center + sign * opening['width'] / 2, 6) for sign in (-1, 1))
        ordered = sorted(points)
        for a, b in zip(ordered, ordered[1:]):
            if not any(w['start'] - 1e-6 <= (a + b) / 2 <= w['end'] + 1e-6 for w in walls):
                continue
            if vertical:
                exterior = abs(axis) < 1e-6 or abs(axis - level['width']) < 1e-6
                offset = -1.5 if axis < level['width'] / 2 else 1.5
                dimension(block, xy(axis, b), xy(axis, a), xy(axis + (offset if exterior else .7), a), 90)
            else:
                exterior = abs(axis) < 1e-6 or abs(axis - height) < 1e-6
                offset = -1.5 if axis < height / 2 else 1.5
                dimension(block, xy(a, axis), xy(b, axis), xy(a, axis + (offset if exterior else .7)))


def room_label_position(room, level):
    """Choose a label rectangle inside the room and clear of saved furniture."""
    parts = room['parts']
    polygon = unary_union([box(r['x'], r['y'], r['x'] + r['w'], r['y'] + r['h']) for r in parts]).buffer(-.35)
    obstacles = [box(r['x'] - .1, r['y'] - .1, r['x'] + r['w'] + .1, r['y'] + r['h'] + .1) for r in level.get('furniture', [])]
    for flight in (level.get('stairs') or {}).get('flights', []):
        r = flight['rect']
        obstacles.append(box(r['x'], r['y'], r['x'] + r['w'], r['y'] + r['h']))
    occupied = unary_union(obstacles)
    for full in [True, False]:
        width = max(len(room['tag']) * .23, len(room['label']) * .19) if full else len(room['tag']) * .23
        height = .95 if full else .5
        for r in sorted(parts, key=lambda r: -r['w'] * r['h']):
            candidates = [(r['x'] + r['w'] * fx, r['y'] + r['h'] * fy) for fy in [.5, .25, .75, .15, .85] for fx in [.5, .25, .75, .15, .85]]
            for x, y in candidates:
                rect = box(x - width / 2, y - height / 2, x + width / 2, y + height / 2)
                if polygon.covers(rect) and not occupied.intersects(rect):
                    return x, y, full
    # A tag-only fallback still resolves the full room name in the schedule.
    point = polygon.representative_point() if not polygon.is_empty else unary_union([box(r['x'], r['y'], r['x'] + r['w'], r['y'] + r['h']) for r in parts]).representative_point()
    return point.x, point.y, False


def north_arrow(block, level, text):
    edge = {'top': 90, 'right': 0, 'bottom': 270, 'left': 180}.get(level.get('frontEdge'))
    facing = {'north': 90, 'east': 0, 'south': 270, 'west': 180}.get(str(level.get('frontFacing')).lower())
    if edge is None or facing is None:
        text(block, 'North orientation not supplied', (level['width'] + 3, level['height']), .3, 'A-TITLE')
        return
    angle = math.radians(90 + edge - facing)
    x, y = level['width'] + 5, level['height'] - 3
    ux, uy = math.cos(angle), math.sin(angle)
    tip = x + ux * 3, y + uy * 3
    block.add_line((x, y), tip, dxfattribs={'layer': 'A-TITLE'})
    for sign in [-1, 1]:
        block.add_line(tip, (tip[0] - ux * .6 + sign * uy * .3, tip[1] - uy * .6 - sign * ux * .3), dxfattribs={'layer': 'A-TITLE'})
    text(block, 'N', (tip[0] + ux, tip[1] + uy), .5, 'A-TITLE', True)


def table(target, text, title, rows, widths, origin=(0, 0)):
    x0, top = origin
    text(target, title, (x0, top + 1), .6, 'A-SCHEDULE')
    xs = [x0]
    for width in widths:
        xs.append(xs[-1] + width)
    row_height = 1.2
    for i in range(len(rows) + 1):
        y = top - i * row_height
        target.add_line((xs[0], y), (xs[-1], y), dxfattribs={'layer': 'A-SCHEDULE'})
    for x in xs:
        target.add_line((x, top), (x, top - len(rows) * row_height), dxfattribs={'layer': 'A-SCHEDULE'})
    for i, row in enumerate(rows):
        for j, value in enumerate(row):
            # Fit long room names into their own cells, without truncating them.
            h = min(.35, (widths[j] - .6) / max(1, len(str(value))) / .65)
            text(target, value, (xs[j] + .3, top - i * row_height - .8), h, 'A-SCHEDULE')


def add_sheet(doc, name, title, block, text, brand):
    """Dedicated block inserted far from others prevents adjacent-view leakage."""
    ext = bbox.extents(block, fast=True)
    if not ext.has_data:
        return
    width, height = ext.size.x + 4, ext.size.y + 4
    ratio = min(32 / width, 19 / height)  # paper inches per model foot
    scale = next((s for s in [.5, .375, .25, .1875, .125, .09375, .0625] if s <= ratio), ratio)
    origin = (10000 + len(doc.layouts) * 2000, 10000)
    doc.modelspace().add_blockref(block.name, origin)
    layout = doc.layouts.new(name)
    layout.page_setup(size=(36, 24), margins=(0, 0, 0, 0), units='inch')
    configure_sheet(layout)
    layout.add_lwpolyline([(1, 1), (35, 1), (35, 23), (1, 23)], close=True, dxfattribs={'layer': 'A-TITLE'})
    layout.add_line((1, 3), (35, 3), dxfattribs={'layer': 'A-TITLE'})
    text(layout, brand, (1.4, 2.3), .25, 'A-TITLE')
    text(layout, title, (1.4, 1.7), .18, 'A-TITLE')
    text(layout, 'ARCHITECTURAL CONCEPT - NOT FOR CONSTRUCTION', (14, 2.3), .13, 'A-TITLE')
    text(layout, f'{name} | Scale: {scale:g} paper inches = 1 foot', (14, 1.7), .13, 'A-TITLE')
    center = ((ext.extmin.x + ext.extmax.x) / 2 + origin[0], (ext.extmin.y + ext.extmax.y) / 2 + origin[1])
    viewport = layout.add_viewport(center=(18, 13), size=(32, 19), view_center_point=center, view_height=19 / scale,
                                  dxfattribs={'layer': 'A-VPORT'})
    viewport.dxf.flags |= 16384  # lock the selected scale


def stair_development(block, stairs, text, origin=(0, 0)):
    """Unfolded stair rise/run diagram, explicitly not a building section."""
    x, base = origin
    text(block, 'STAIR DEVELOPMENT - UNFOLDED NOMINAL FLIGHTS', (x, base + stairs['riseFt'] + 2), .5, 'A-TITLE')
    for index, flight in enumerate(stairs['flights']):
        run = (flight['risers'] - 1) * stairs['treadFt']
        points = [(x, base + flight['fromZFt'])]
        for i in range(flight['risers']):
            z = base + flight['fromZFt'] + (i + 1) * stairs['riserFt']
            points.append((x + i * stairs['treadFt'], z))
            if i < flight['risers'] - 1:
                points.append((x + (i + 1) * stairs['treadFt'], z))
        block.add_lwpolyline(points, dxfattribs={'layer': 'A-STAIR'})
        dimension(block, (x, base), (x + run, base), (x, base - 1.5))
        dimension(block, (x, base + flight['fromZFt']), (x, base + flight['toZFt']), (x - 1, base), 90)
        text(block, f"F{index + 1}: {flight['risers']}R @ {stairs['riserFt'] * 12:.3f} in; {flight['risers'] - 1}T @ {stairs['treadFt'] * 12:.3f} in", (x, base - 3), .3, 'A-STAIR')
        x += run + 5
    text(block, 'Rails / structure / finish build-ups and headroom require coordinated assembly details.', (origin[0], base - 5), .3, 'A-TITLE')
