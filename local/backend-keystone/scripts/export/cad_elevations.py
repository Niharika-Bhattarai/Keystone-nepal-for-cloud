"""Orthographic facade profiles, including depth occlusion of recessed walls."""
from shapely.geometry import Polygon, box
from shapely.ops import unary_union
from cad_details import add_sheet, dimension


def outlines(target, geometry, layer):
    if geometry.is_empty:
        return
    if geometry.geom_type == 'Polygon':
        for ring in [geometry.exterior, *geometry.interiors]:
            target.add_lwpolyline(list(ring.coords)[:-1], close=True, dxfattribs={'layer': layer})
    elif hasattr(geometry, 'geoms'):
        for part in geometry.geoms:
            outlines(target, part, layer)


def add_elevations(doc, data, text):
    cx, cy = data['modelCenter']
    for number, (name, horizontal, reverse, near_sign) in enumerate([
        ('TOP', True, True, 1), ('BOTTOM', True, False, -1),
        ('LEFT', False, False, 1), ('RIGHT', False, True, -1),
    ], 1):
        block = doc.blocks.new(f'ELEVATION_{name}')
        def project(x, y):
            return (-1 if reverse else 1) * (x if horizontal else y)
        roof_polygons = []
        for triangle in data.get('roofTriangles', []):
            polygon = Polygon([(project(p[0] + cx, p[2] + cy), p[1]) for p in triangle])
            if polygon.is_valid and polygon.area > 1e-8:
                roof_polygons.append(polygon)
        roof = unary_union(roof_polygons)
        # Roof is deliberately a silhouette. Internal hidden edges are not
        # presented as visible construction lines.
        outlines(block, roof, 'A-ELEV-ROOF')
        groups = {}
        for level in data['levels']:
            for wall in level['walls']:
                if not wall['exterior'] or (wall['dir'] == 'horizontal') != horizontal:
                    continue
                a, b = sorted([project(wall['start'], wall['start']), project(wall['end'], wall['end'])])
                key = level['level'], round(wall['axis'], 6)
                if key not in groups:
                    groups[key] = (near_sign * wall['axis'], level, wall, [])
                groups[key][3].append(box(a, level['floorZ'], b, level['wallTopZ']))
        walls = [(depth, level, wall, unary_union(faces)) for depth, level, wall, faces in groups.values()]
        occluded = Polygon()
        for _, level, wall, face in sorted(walls, key=lambda item: item[0]):
            visible = face.difference(occluded).difference(roof)
            if visible.is_empty:
                occluded = occluded.union(face)
                continue
            outlines(block, visible, 'A-ELEV-WALL')
            for opening in level['openings']:
                if opening['dir'] != wall['dir']:
                    continue
                axis = opening['y'] if horizontal else opening['x']
                center = opening['x'] if horizontal else opening['y']
                if abs(axis - wall['axis']) > 1e-6:
                    continue
                a, b = sorted([project(center - opening['width'] / 2, center - opening['width'] / 2), project(center + opening['width'] / 2, center + opening['width'] / 2)])
                shape = box(a, level['floorZ'] + opening['sill'], b, level['floorZ'] + opening['head'])
                outlines(block, shape.intersection(visible), 'A-WINDOW' if opening['kind'] == 'window' else 'A-DOOR')
                if visible.covers(shape.centroid):
                    text(block, opening['tag'], (shape.centroid.x, shape.centroid.y), .3, 'A-OPEN-TAGS', True)
            # Opaque facade envelope, including glazing, masks the far side.
            occluded = occluded.union(face)
        if not occluded.is_empty:
            xmin, zmin, xmax, zmax = occluded.union(roof).bounds
            for level in data['levels']:
                z = level['floorZ']
                block.add_line((xmin - 2, z), (xmax + 2, z), dxfattribs={'layer': 'A-ELEV-DATUM'})
                text(block, f"L{level['level']} FFL {z:.3f} ft", (xmax + 2.5, z), .35, 'A-ELEV-DATUM')
            dimension(block, (xmin, zmin), (xmin, zmax), (xmin - 3, zmin), 90)
            text(block, f'{name} PLAN EDGE - EXTERIOR ELEVATION', (xmin, zmax + 3), .6, 'A-TITLE')
            text(block, 'Roof silhouette from 3D model. Datum heights from saved vertical model.', (xmin, zmin - 3), .3, 'A-TITLE')
            add_sheet(doc, f'A2{number:02d}', f'{name.title()} plan edge elevation', block, text, data['brand'])
