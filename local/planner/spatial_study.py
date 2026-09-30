"""Local polygon refinement of Nepal concepts. Geometry evidence, not permit approval.

stdin/stdout JSON contract; no network, files, credentials or model inference.
All lengths are millimetres. Preserve room IDs/counts and core/circulation.
"""
import json
import math
import sys
from itertools import islice
from shapely.geometry import Polygon, LineString, box, mapping, shape
from shapely.ops import unary_union


def rectangle(b):
    return box(*b) if isinstance(b, list) else box(b['x1'], b['y1'], b['x2'], b['y2'])


def poly_json(g):
    return mapping(g)


def opening_line(o):
    if o['axis'] == 'vertical':
        return LineString([(o['x'], o['y1']), (o['x'], o['y2'])])
    return LineString([(o['x1'], o['y']), (o['x2'], o['y'])])


def edges(poly):
    pts = list(poly.exterior.coords)
    return [LineString([a, b]) for a, b in zip(pts, pts[1:])]


def parts(g, kind):
    if g.is_empty:
        return []
    if g.geom_type == kind:
        return [g]
    return [p for child in getattr(g, 'geoms', []) for p in parts(child, kind)]


def usable_rectangle(poly, width, depth):
    """Conservative finite placement search; failure means no sampled fit, not impossible."""
    x0, y0, x1, y1 = poly.bounds
    for w, h in [(width, depth), (depth, width)]:
        if w > x1-x0 or h > y1-y0:
            continue
        xs = {x0, x1-w, (x0+x1-w)/2}
        ys = {y0, y1-h, (y0+y1-h)/2}
        for x, y in poly.exterior.coords:
            xs.update([x, x-w])
            ys.update([y, y-h])
        for x in sorted(xs):
            for y in sorted(ys):
                r = box(x, y, x+w, y+h)
                if poly.buffer(.01).covers(r):
                    return r
    return None


def functional_target(kind):
    # Working functional envelopes, not imported municipal minimums.
    if kind in ['bedroom', 'primaryBedroom', 'guestBedroom']:
        return 2400, 2700, 8.0
    if kind == 'livingRoom':
        return 2700, 3000, 10.0
    if kind == 'kitchen':
        return 1900, 2600, 5.0
    if kind == 'bathroom':
        return 1200, 2100, 2.8
    if kind == 'puja':
        return 1800, 1800, 3.24
    return 1000, 1200, 1.5


def court_shapes(candidate, clear_size=3000):
    """Reserve a common open-to-sky volume; bevel outside a 3m square core."""
    b = rectangle(candidate['envelope']['buildable'])
    x0, y0, x1, y1 = b.bounds
    # Coarse seeds plus frame midpoints; no random seed or claim of exhaustive solving.
    xs = set(round(x0+600+i*(x1-x0-clear_size-1200)/4) for i in range(5))
    ys = set(round(y0+600+i*(y1-y0-clear_size-1200)/4) for i in range(5))
    for a, z in zip(candidate['grid']['xAxesMm'], candidate['grid']['xAxesMm'][1:]):
        xs.add(round((a+z)/2-clear_size/2))
    for a, z in zip(candidate['grid']['yAxesMm'], candidate['grid']['yAxesMm'][1:]):
        ys.add(round((a+z)/2-clear_size/2))
    if clear_size<3000:
        # Start at bathroom corners, rather than relying on coarse site seeds.
        for level in candidate['levels']:
            for room in (level.get('rooms') or {}).get('rooms',[]):
                if room['type']=='bathroom':
                    a,by,c,d=rectangle(room['box']).bounds
                    xs.update([a+229,c-229-clear_size])
                    ys.update([by+229,d-229-clear_size])
    for x in sorted(xs):
        for y in sorted(ys):
            for bevel in ([300, 0] if clear_size==3000 else [0]):
                inner = box(x, y, x+clear_size, y+clear_size)
                # Reserve wall thickness OUTSIDE the required clear court core.
                p = inner.buffer(229+bevel,join_style=3 if bevel else 2)
                ground=unary_union([rectangle(s) for s in candidate['levels'][0]['footprint']['slabs']])
                if b.covers(p) and ground.covers(p):
                    yield p, inner


def protected_zones(candidate, level):
    zones = [rectangle(candidate['core']['box'])]
    model = level.get('rooms') or {}
    if model.get('circulationPolygon'):
        zones.append(shape(model['circulationPolygon']))
    for key in ['corridor', 'crossHall']:
        if model.get(key):
            zones.append(rectangle(model[key]))
    for key in ['parking', 'balcony']:
        if model.get(key):
            zones.append(rectangle(model[key]['box']))
    return zones


def service_stack_shapes(candidate):
    """Place the shaft beyond a compact WC band beside the shared access spine."""
    buildable=rectangle(candidate['envelope']['buildable'])
    seen=set()
    for level in candidate['levels']:
        model=level.get('rooms') or {}
        for key in ['corridor','crossHall']:
            if not model.get(key):continue
            a,b,c,d=rectangle(model[key]).bounds
            for depth in [1658,1858,2558]:
                for x in [a-depth-1829.6,c+depth]:
                    for y in [b,b+1000,d-1829.6,(b+d-1829.6)/2]:
                        outer=box(x,y,x+1829.6,y+1829.6)
                        signature=tuple(outer.bounds)
                        if signature not in seen and buildable.covers(outer):
                            seen.add(signature)
                            yield outer,outer.buffer(-229,join_style=2)
    for outer,inner in court_shapes(candidate,1371.6):
        if tuple(outer.bounds) not in seen:
            yield outer,inner


def access_interval(poly, route, width):
    for edge in sorted(parts(poly.boundary.intersection(route.boundary),'LineString'),
                       key=lambda e:-e.length):
        if edge.length < width+200:
            continue
        a=edge.interpolate((edge.length-width)/2)
        b=edge.interpolate((edge.length+width)/2)
        if abs(a.x-b.x)<.01:
            return {'axis':'vertical','x':round(a.x),'y1':round(min(a.y,b.y)),
                    'y2':round(max(a.y,b.y)),'clearWidthMm':width}
        if abs(a.y-b.y)<.01:
            return {'axis':'horizontal','y':round(a.y),'x1':round(min(a.x,b.x)),
                    'x2':round(max(a.x,b.x)),'clearWidthMm':width}
    return None


def repartition_with_court(candidate, court, service=False, compact=True):
    """Bounded polygon partition search with the court reserved BEFORE rooms.

    This is an alternative topology; inability to find it is not infeasibility.
    Retains required IDs/types and records changed circulation/attachment checks.
    """
    import copy
    revised=copy.deepcopy(candidate)
    column_boxes=[box(col['xMm']-col['widthMm']/2,col['yMm']-col['widthMm']/2,
                      col['xMm']+col['widthMm']/2,col['yMm']+col['widthMm']/2)
                  for col in candidate['grid']['columns']]
    c=rectangle(candidate['core']['box'])
    west=candidate.get('coreSide',candidate['core'].get('side','west'))=='west'
    for level in revised['levels']:
        model=level.get('rooms')
        if not model or not model.get('rooms'):
            continue
        footprint=unary_union([rectangle(s) for s in level['footprint']['slabs']])
        # A partial roof outside the court remains open above it, unchanged.
        if footprint.intersection(court).area<1:
            continue
        ring=court.buffer(1102,join_style=2).difference(court).intersection(footprint).difference(c)
        if not service and (ring.geom_type!='Polygon' or ring.is_empty):
            return None,'COURT_FIRST_RING_DOES_NOT_FIT'
        entry=model.get('unitEntry',{}).get('doorReservation')
        if not entry:
            return None,'COURT_FIRST_MISSING_UNIT_ENTRY'
        ex=entry['x']; ey=min(entry['y1'],entry['y2'])-51
        x=ex if west else ex-1102
        _,ry0,_,ry1=ring.bounds
        branch=box(x,ey,x+1102,max(ey+1102,(ry0+ry1)/2))
        target_x=ring.bounds[0] if west else ring.bounds[2]
        link=box(min(x,target_x),max(ey,ry0),max(x+1102,target_x),max(ey,ry0)+1102)
        route=unary_union([ring,branch,link])
        if service:
            existing=[rectangle(model[k]) for k in ['corridor','crossHall'] if model.get(k)]
            # Keep one access spine. A ring would put a hall between every WC
            # and its shaft and therefore defeat direct ventilation adjacency.
            extent=max([ey+1102]+[p.bounds[3] for p in existing])
            route=unary_union(existing+[box(x,ey,x+1102,extent)])
            if compact:
                sx0,sy0,sx1,sy1=court.bounds
                fx0,fy0,fx1,fy1=footprint.bounds
                cross=box(max(fx0,min(x,sx0-1658)),sy0-1102,
                          min(fx1,max(x+1102,sx1+1658)),sy0)
                route=unary_union([route,cross,box(x,ey,x+1102,max(extent,sy0))])
        if route.geom_type!='Polygon' or not footprint.covers(route) or route.intersection(c).area>1:
            return None,'COURT_FIRST_ENTRY_ROUTE_DOES_NOT_FIT'
        clear_route=route.buffer(-500,join_style=2)
        if clear_route.geom_type!='Polygon' or clear_route.is_empty:
            return None,'COURT_FIRST_ROUTE_HAS_NARROW_OR_DISCONNECTED_PASSAGE'
        occupied=[c,court,route]
        if model.get('parking'):
            occupied.append(rectangle(model['parking']['box']))
        if model.get('balcony'):
            occupied.append(rectangle(model['balcony']['box']))
        free=footprint.difference(unary_union(occupied))
        requested=[r for r in model['rooms'] if not r.get('suggestedByPlanner')]
        requested.sort(key=lambda r:(service and r['type']!='bathroom',-functional_target(r['type'])[2]))
        budget=[160]

        def allocate(region,index,placed):
            if index==len(requested):
                return placed,region
            budget[0]-=1
            if budget[0]<=0:
                return None
            source=requested[index];w,h,minimum=functional_target(source['type'])
            width=750 if source['type']=='bathroom' else 1200 if source['type']=='kitchen' else 900
            options=[]
            for p in parts(region,'Polygon'):
                x0,y0,x1,y1=p.bounds
                cuts=[p]
                if service:
                    sx0,sy0,sx1,sy1=court.bounds
                    for depth in [w+458,h+458]:
                        for b in [box(sx0-depth,sy0,sx0,sy1),box(sx1,sy0,sx1+depth,sy1),
                                  box(sx0,sy0-depth,sx1,sy0),box(sx0,sy1,sx1,sy1+depth)]:
                            cuts.append(p.intersection(b))
                        for length in [w+458,h+458]:
                            for yy in [sy0,sy1-length]:
                                cuts.extend([p.intersection(box(sx0-depth,yy,sx0,yy+length)),
                                             p.intersection(box(sx1,yy,sx1+depth,yy+length))])
                desired=max(minimum*1.45,minimum+2)*1e6
                for dim in [w+458,h+458,desired/max(1,y1-y0),
                            desired/max(1,x1-x0),(x1-x0)/2,(y1-y0)/2]:
                    dim=round(dim)
                    if 0<dim<x1-x0:
                        cuts.extend([p.intersection(box(x0,y0,x0+dim,y1)),
                                     p.intersection(box(x1-dim,y0,x1,y1))])
                    if 0<dim<y1-y0:
                        cuts.extend([p.intersection(box(x0,y0,x1,y0+dim)),
                                     p.intersection(box(x0,y1-dim,x1,y1))])
                # Structural axes are useful split boundaries; reject rooms enclosing columns.
                for axis in candidate['grid']['xAxesMm']:
                    if x0<axis<x1:
                        cuts.extend([p.intersection(box(x0,y0,axis,y1)),p.intersection(box(axis,y0,x1,y1))])
                for axis in candidate['grid']['yAxesMm']:
                    if y0<axis<y1:
                        cuts.extend([p.intersection(box(x0,y0,x1,axis)),p.intersection(box(x0,axis,x1,y1))])
                # A room needs two bounded dimensions. Single full-strip cuts
                # cannot isolate a grid cell when both axes contain columns.
                for ax,bx in (zip(candidate['grid']['xAxesMm'],candidate['grid']['xAxesMm'][1:]) if service else []):
                    for ay,by in zip(candidate['grid']['yAxesMm'],candidate['grid']['yAxesMm'][1:]):
                        cuts.append(p.intersection(box(ax,ay,bx,by)))
                for q in cuts:
                    if q.geom_type!='Polygon' or q.is_empty or q.interiors:
                        continue
                    if service and compact and source['type']=='bathroom' and q.area>6.5e6:
                        continue
                    if service and source['type']=='bathroom' and not any(
                        edge.length>=1200 for edge in parts(q.boundary.intersection(court.boundary),'LineString')):
                        continue
                    interior=q.buffer(-1)
                    if any(interior.contains(col) for col in column_boxes):
                        continue
                    clear=q.buffer(-229,join_style=2)
                    if clear.geom_type!='Polygon' or clear.area<minimum*1e6 or usable_rectangle(clear,w,h) is None:
                        continue
                    door=access_interval(q,route,width)
                    if door is None:
                        continue
                    remainder=region.difference(q)
                    if remainder.area < sum(functional_target(r['type'])[2]*1e6 for r in requested[index+1:]):
                        continue
                    options.append((abs(q.area-desired),q,door,remainder))
            options.sort(key=lambda v:v[0])
            for _,q,door,remainder in options[:12]:
                r=copy.deepcopy(source);r['polygon']=poly_json(q);r['box']=dict(zip(['x1','y1','x2','y2'],q.bounds))
                r['doorReservation']=door;r['windowReservations']=[];r['windowReservation']=None
                if source['type']=='kitchen':
                    r['doorReservation']['status']='open_portal_reserved_no_door'
                result=allocate(remainder,index+1,placed+[r])
                if result is not None:
                    return result
            return None

        found=allocate(free,0,[])
        if found is None:
            return None,'COURT_FIRST_ROOM_PARTITION_SEARCH_EXHAUSTED'
        model['rooms'],unused=found
        for room in model['rooms']:
            if room.get('attachedTo'):
                primary=next((r for r in model['rooms'] if r['id']==room['attachedTo']),None)
                door=access_interval(shape(room['polygon']),shape(primary['polygon']),750) if primary else None
                if door:
                    room['doorReservation']=door
                    room['entryFrom']='primary-bedroom'
                    room['attachedAccessResolved']=True
        model['unassignedPolygon']=poly_json(unused)
        model['circulationPolygon']=poly_json(route)
        model['corridor']=None;model['crossHall']=None
        model['circulationPortal']=None;model['crossHallPortal']=None
        model['unitEntry']['to']='court-hall'
        level['replannedAroundCourt']=True
    return revised,None


def repair_shaft_neighbors(candidate, court):
    """Move a shared partition within adjoining room pairs, keeping access/program.

    No new hall, column or room deletion. All floors must survive the same void.
    """
    import copy
    revised=copy.deepcopy(candidate)
    columns=[box(c['xMm']-c['widthMm']/2,c['yMm']-c['widthMm']/2,
                 c['xMm']+c['widthMm']/2,c['yMm']+c['widthMm']/2)
             for c in candidate['grid']['columns']]
    if any(c.intersection(court.buffer(175)).area>1 for c in columns):
        return None,'SHAFT_REPAIR_SUPPORT_CONFLICT'
    if any(p.intersection(court.buffer(102)).area>1 for l in revised['levels']
           for p in protected_zones(revised,l)):
        return None,'SHAFT_REPAIR_PROTECTED_ZONE_CONFLICT'
    for level in revised['levels']:
        model=level.get('rooms') or {}
        rooms=model.get('rooms',[])
        footprint=unary_union([rectangle(s) for s in level['footprint']['slabs']])
        obstacles=unary_union([footprint.boundary.buffer(229),court.boundary.buffer(229)]+columns)
        fit_budget=[160]
        def geometry(r):
            return shape(r['polygon']) if r.get('polygon') else rectangle(r['box'])
        def relocated_door(poly,r):
            old=r.get('doorReservation')
            if not old:return None
            if poly.boundary.buffer(.1).covers(opening_line(old)):
                return old
            routes=[]
            for key in ['corridor','crossHall']:
                if model.get(key):routes.append(rectangle(model[key]))
            for neighbor in rooms:
                if neighbor is not r and geometry(neighbor).boundary.buffer(.1).covers(opening_line(old)):
                    routes.append(geometry(neighbor))
            if r.get('attachedTo'):
                routes=[geometry(n) for n in rooms if n['id']==r['attachedTo']]
            for route in routes:
                door=access_interval(poly,route,old['clearWidthMm'])
                if door and not any(opening_line(door).buffer(100).intersects(c) for c in columns):
                    return {**old,**door}
            return None
        def acceptable(poly,r):
            fit_budget[0]-=1
            if fit_budget[0]<0:
                return False
            if poly.is_empty or poly.geom_type!='Polygon' or not poly.is_valid:
                return False
            interior=poly.buffer(-1)
            if any(interior.contains(c) for c in columns):
                return False
            clear=poly.buffer(-51,join_style=2).difference(obstacles)
            w,h,area=functional_target(r['type'])
            door=r.get('doorReservation')
            return (clear.geom_type=='Polygon' and clear.area>=area*1e6
                    and usable_rectangle(clear,w,h) is not None
                    and (not door or relocated_door(poly,r) is not None))
        for room in rooms:
            original=geometry(room)
            if original.intersection(court).area<1 or acceptable(original.difference(court),room):
                continue
            found=False
            neighbors=sorted(rooms,key=lambda r:(r['type'] not in ['utilityFlex','diningAnnex','primaryAlcove'],r['id']))
            for other in neighbors:
                if other is room:
                    continue
                neighbor=geometry(other)
                if original.boundary.intersection(neighbor.boundary).length<500:
                    continue
                region=original.union(neighbor).difference(court)
                if region.geom_type!='Polygon':
                    continue
                x0,y0,x1,y1=region.bounds
                xs=set(candidate['grid']['xAxesMm']);ys=set(candidate['grid']['yAxesMm'])
                for r in [room,other]:
                    w,h,_=functional_target(r['type'])
                    for d in [w+458,h+458]:
                        xs.update([x0+d,x1-d]);ys.update([y0+d,y1-d])
                splits=[]
                for x in sorted(xs):
                    if x0<x<x1:
                        a=region.intersection(box(x0,y0,x,y1));splits.append((a,region.difference(a)))
                for y in sorted(ys):
                    if y0<y<y1:
                        a=region.intersection(box(x0,y0,x1,y));splits.append((a,region.difference(a)))
                for a,b in splits:
                    for first,second in [(a,b),(b,a)]:
                        if acceptable(first,room) and acceptable(second,other):
                            doors=[relocated_door(first,room),relocated_door(second,other)]
                            for (r,p),door in zip([(room,first),(other,second)],doors):
                                r['polygon']=poly_json(p)
                                r['box']=dict(zip(['x1','y1','x2','y2'],p.bounds))
                                r['shaftPartitionRepaired']=True
                                if door:r['doorReservation']=door
                            found=True;break
                    if found:break
                if found:break
            if not found:
                return None,'SHAFT_NEIGHBOR_REPAIR_EXHAUSTED'
        for room in rooms:
            if not room.get('shaftPartitionRepaired') or not room.get('doorReservation'):
                continue
            door=opening_line(room['doorReservation'])
            if room.get('attachedTo'):
                targets=[geometry(r) for r in rooms if r['id']==room['attachedTo']]
            else:
                targets=[geometry(r) for r in rooms if r is not room]
                targets += [rectangle(model[k]) for k in ['corridor','crossHall'] if model.get(k)]
            if (not any(p.boundary.buffer(.1).covers(door) for p in targets)
                    or any(door.buffer(100).intersects(c) for c in columns)):
                return None,'SHAFT_REPAIR_LOST_ACCESS_RELATIONSHIP'
    return revised,None


def transform(candidate, court=None):
    """Build real room polygons and nominal clear geometry on every physical level."""
    levels = []
    columns = [box(c['xMm']-c['widthMm']/2,c['yMm']-c['widthMm']/2,
                   c['xMm']+c['widthMm']/2,c['yMm']+c['widthMm']/2)
               for c in candidate['grid']['columns']]
    for source in candidate['levels']:
        footprint = unary_union([rectangle(b) for b in source['footprint']['slabs']])
        if court is not None:
            for p in protected_zones(candidate, source):
                if p.intersection(court if source.get('replannedAroundCourt') else court.buffer(102)).area > 1:
                    return None, 'COURT_HITS_CORE_CIRCULATION_OR_OUTDOOR_SPACE'
            if any(c.intersection(court.buffer(175)).area > 1 for c in columns):
                return None, 'COURT_HITS_COLUMN_OR_SUPPORT_RESERVATION'
        slab = footprint if court is None else footprint.difference(court)
        room_models = []
        for r in (source.get('rooms') or {}).get('rooms', []):
            original = shape(r['polygon']) if r.get('polygon') else rectangle(r['box'])
            if original.geom_type != 'Polygon' or not original.is_valid or not footprint.covers(original):
                return None, 'INVALID_OR_OUTSIDE_ROOM_POLYGON'
            polygon = original if court is None else original.difference(court)
            if polygon.geom_type != 'Polygon' or polygon.is_empty or not polygon.is_valid:
                return None, 'ROOM_REMOVED_OR_DISCONNECTED'
            # Nominal partition half-width; outer weather walls need full allowance.
            clear = polygon.buffer(-51, join_style=2)
            clear = clear.difference(footprint.boundary.buffer(229))
            if court is not None:
                clear = clear.difference(court.boundary.buffer(229))
            clear = clear.difference(unary_union(columns))
            w, h, minimum_area = functional_target(r['type'])
            fit = None if clear.geom_type != 'Polygon' else usable_rectangle(clear,w,h)
            # Preserve original unsuitable rooms as findings, never hide them. A
            # proposed court may not introduce one of these defects.
            changed = original.symmetric_difference(polygon).area > 1
            if (changed or r.get('shaftPartitionRepaired') or source.get('replannedAroundCourt')) and (fit is None or clear.area/1e6 < minimum_area):
                return None, 'COURT_LEAVES_UNUSABLE_ROOM'
            door = r.get('doorReservation')
            if door and (not polygon.boundary.buffer(.1).covers(opening_line(door))):
                return None, 'COURT_REMOVES_REQUIRED_ROOM_ACCESS'
            room_models.append({'id':r['id'],'type':r['type'], 'shape':polygon,
                'clear':clear,'fit':fit,'door':door,'source':r,
                'changed':changed,'areaSqM':polygon.area/1e6})
        for i,a in enumerate(room_models):
            if any(a['shape'].intersection(b['shape']).area>1 for b in room_models[i+1:]):
                return None,'OVERLAPPING_ROOM_POLYGONS'
        levels.append({'id':source['id'],'source':source,'slab':slab,
            'footprint':footprint,'rooms':room_models,'balconies':[]})
    return levels, None


def add_balconies(candidate, levels):
    site = rectangle(candidate['envelope']['site'])
    for floor_index, level in enumerate(levels):
        if floor_index == 0:
            continue
        requested = level['source'].get('residentialDetails',{}).get('requestedBalcony',False)
        hosts = sorted(level['rooms'],key=lambda r:
            {'livingRoom':0,'kitchen':1,'primaryBedroom':2}.get(r['type'],9))
        for room in hosts:
            if room['type'] not in ['livingRoom','kitchen','primaryBedroom','bedroom','guestBedroom']:
                continue
            for edge in edges(room['shape']):
                if edge.length < 2300 or not level['footprint'].boundary.buffer(.1).covers(edge):
                    continue
                (ax,ay),(bx,by)=edge.coords
                ux,uy=(bx-ax)/edge.length,(by-ay)/edge.length
                mx,my=(ax+bx)/2,(ay+by)/2
                nx,ny=-uy,ux
                if room['shape'].covers(Polygon([(mx,my),(mx+nx*10,my+ny*10),
                    (mx+nx*10+ux,my+ny*10+uy)]).centroid):
                    nx,ny=-nx,-ny
                length=min(3000,edge.length-700)
                for depth in [1200,1000,914]:
                    p1=(mx-ux*length/2,my-uy*length/2)
                    p2=(mx+ux*length/2,my+uy*length/2)
                    balcony=Polygon([p1,p2,(p2[0]+nx*depth,p2[1]+ny*depth),
                        (p1[0]+nx*depth,p1[1]+ny*depth)])
                    if not site.buffer(-50).covers(balcony) or balcony.intersection(level['slab']).area>1:
                        continue
                    projected=unary_union([levels[0]['slab'],balcony]+
                        [b['shape'] for l in levels for b in l['balconies']])
                    cap=candidate.get('workingCoverageLimit')
                    if cap is not None and projected.area/site.area>cap+1e-10:
                        continue
                    # Do not overlap an existing habitable window or a column.
                    width=1600
                    door=LineString([(mx-ux*width/2,my-uy*width/2),
                                     (mx+ux*width/2,my+uy*width/2)])
                    exclusions = [rectangle([c['xMm']-225,c['yMm']-225,
                        c['xMm']+225,c['yMm']+225]) for c in candidate['grid']['columns']]
                    # Search intervals along this edge so an existing window need not be deleted.
                    found=None
                    for shift in [0,-(length-width)/2,(length-width)/2]:
                        d=LineString([(x+ux*shift,y+uy*shift) for x,y in door.coords])
                        if not any(d.intersects(o) for o in exclusions):
                            found=d;break
                    if found is None:
                        continue
                    replaced=[w for w in room['source'].get('windowReservations',[])
                        if opening_line(w).intersects(found.buffer(1))]
                    # A sliding glazed opening replaces the entire old interval,
                    # never an accidental remnant window alongside a new door.
                    if any(not found.buffer(.1).covers(opening_line(w)) for w in replaced):
                        continue
                    level['balconies'].append({'hostRoomId':room['id'],'shape':balcony,
                        'door':found,'depthMm':depth,'requested':requested,
                        'guard':balcony.boundary.difference(level['footprint'].boundary.buffer(.1)),
                        'replacedWindowAreaSqM':sum(w.get('provisionalClearAreaSqM',0) for w in replaced),
                        'proposedGlazingAreaSqM':width*2100/1e6,
                        # Owner decision 2026-09-30: closable glazing, not a permanently open connection.
                        'boundary':'closable_glazed_opening_owner_confirmed',
                        'status':'site_contained_projection_permission_and_support_unverified'})
                    break
                if level['balconies']:
                    break
            if level['balconies']:
                break


def export(candidate, levels, court, core_square, attempts):
    site=rectangle(candidate['envelope']['site'])
    service_shaft=core_square is not None and core_square.area<9e6-1
    output=[]
    for level in levels:
        rooms=[]; openings=[]; issues=[]
        if level['source'].get('replannedAroundCourt'):
            issues.append({'code':'COURT_FIRST_ACCESS_PRIVACY_AND_ATTACHMENT_REVIEW',
                'roomId':'all: revised rooms enter court hall; attachment and direct-living entry unresolved'})
        for r in level['rooms']:
            if r['type']=='bathroom' and r['shape'].area>6.5e6:
                issues.append({'code':'OVERSIZED_BATHROOM_REQUIRES_REPLANNING','roomId':r['id']})
            for col in candidate['grid']['columns']:
                column=box(col['xMm']-col['widthMm']/2,col['yMm']-col['widthMm']/2,
                           col['xMm']+col['widthMm']/2,col['yMm']+col['widthMm']/2)
                if r['shape'].buffer(-1).contains(column):
                    issues.append({'code':'COLUMN_INSIDE_ROOM','roomId':r['id']})
            if level['source'].get('replannedAroundCourt') and r['source'].get('attachedTo') and not r['source'].get('attachedAccessResolved'):
                issues.append({'code':'ATTACHED_BATH_NOT_CONNECTED_TO_BEDROOM','roomId':r['id']})
            if r['door']:
                openings.append({'kind':'door','geometry':poly_json(opening_line(r['door'])),
                    'roomId':r['id'],'clearWidthMm':r['door']['clearWidthMm']})
            for w in r['source'].get('windowReservations',[]):
                line=opening_line(w)
                if any(b['hostRoomId']==r['id'] and b['door'].buffer(.1).covers(line)
                       for b in level['balconies']):
                    continue
                if r['shape'].boundary.buffer(.1).covers(line):
                    openings.append({'kind':'window','geometry':poly_json(line),'roomId':r['id']})
            if court is not None:
                for edge in parts(r['shape'].boundary.intersection(court.boundary),'LineString'):
                    if edge.length<1200:
                        continue
                    a=edge.interpolate(250);b=edge.interpolate(edge.length-250)
                    if a.distance(b)<700:
                        continue
                    openings.append({'kind':'service-shaft-window' if service_shaft else 'court-window','geometry':poly_json(LineString([a,b])),
                        'roomId':r['id'],'status':'aperture_area_and_openable_fraction_unverified'})
                    break
            habitable=r['type'] in ['bedroom','primaryBedroom','guestBedroom','livingRoom','kitchen','study','dining']
            demand=r['areaSqM']/(8 if r['type']=='kitchen' else 10) if habitable else 0
            measured=sum(LineString(o['geometry']['coordinates']).length*1200/1e6
                for o in openings if o.get('roomId')==r['id'] and 'window' in o['kind'] and o['kind']!='service-shaft-window')
            measured+=sum(b['proposedGlazingAreaSqM'] for b in level['balconies']
                          if b['hostRoomId']==r['id'])
            if level['source'].get('replannedAroundCourt') and measured<demand:
                for edge in parts(r['shape'].boundary.intersection(level['footprint'].boundary),'LineString'):
                    # Source-specific clearance remains unverified; only reserve
                    # this exterior opening where the 1.5m reference fits.
                    if edge.distance(site.boundary)<1500 or edge.length<1100:
                        continue
                    occupied=[opening_line(r['door']).buffer(150)] if r['door'] else []
                    occupied += [rectangle([c['xMm']-225,c['yMm']-225,c['xMm']+225,c['yMm']+225])
                        for c in candidate['grid']['columns']]
                    free=edge.difference(unary_union(occupied))
                    for segment in parts(free,'LineString'):
                        needed=(demand-measured)*1e6/1200
                        width=min(max(700,needed),segment.length-500)
                        if width<700:
                            continue
                        a=segment.interpolate((segment.length-width)/2)
                        b=segment.interpolate((segment.length+width)/2)
                        aperture=LineString([a,b])
                        openings.append({'kind':'window','geometry':poly_json(aperture),'roomId':r['id']})
                        measured+=aperture.length*1200/1e6
                        if measured>=demand:
                            break
                    if measured>=demand:
                        break
            if measured+1e-6<demand:
                issues.append({'code':'INSUFFICIENT_RESERVED_LIGHT_OPENING_AREA','roomId':r['id'],
                    'requiredSqM':demand,'reservedSqM':measured})
            if r['fit'] is None:
                issues.append({'code':'FUNCTIONAL_RECTANGLE_NOT_FOUND','roomId':r['id']})
            rooms.append({'id':r['id'],'type':r['type'],'polygon':poly_json(r['shape']),
                'labelPoint':list(r['shape'].representative_point().coords)[0],
                'clearPolygon':poly_json(r['clear']),'areaSqM':r['areaSqM'],
                'clearAreaSqM':r['clear'].area/1e6,'changed':r['changed'],
                'naturalLightDemandSqM':demand,'reservedGlazingAreaSqM':measured,
                'functionalZone':poly_json(r['fit']) if r['fit'] is not None else None})
        for balcony in level['balconies']:
            openings.append({'kind':'balcony-door','geometry':poly_json(balcony['door']),
                'roomId':balcony['hostRoomId'],'clearWidthMm':balcony['door'].length})
        # All enclosing edges remain solid except explicit cut intervals.
        lines=[r['shape'].boundary for r in level['rooms']]
        lines += [p.boundary for p in protected_zones(candidate,level['source'])]
        wall=unary_union(lines).buffer(51,join_style=2)
        wall=wall.union(level['slab'].boundary.buffer(114.5,join_style=2))
        # Preserve unit entrance and circulation portals as well as room doors.
        model=level['source'].get('rooms') or {}
        extra=[model.get('unitEntry',{}).get('doorReservation'),
            model.get('circulationPortal'),model.get('crossHallPortal'),
            (model.get('balcony') or {}).get('doorReservation')]
        if not output:
            extra.append(candidate['core'].get('siteEntry'))
        extra += [r['source'].get('serviceExitDoor') for r in level['rooms']]
        for o in filter(None,extra):
            openings.append({'kind':'access','geometry':poly_json(opening_line(o))})
        for o in openings:
            wall=wall.difference(LineString(o['geometry']['coordinates']).buffer(250,cap_style=2))
        output.append({'id':level['id'],'slab':poly_json(level['slab']),
            'columns':[c for c in candidate['grid']['columns'] if level['slab'].intersects(
                box(c['xMm']-c['widthMm']/2,c['yMm']-c['widthMm']/2,
                    c['xMm']+c['widthMm']/2,c['yMm']+c['widthMm']/2))],
            'replannedAroundCourt':level['source'].get('replannedAroundCourt',False),
            'unassignedPolygon':model.get('unassignedPolygon'),
            'slabAreaSqM':level['slab'].area/1e6,'rooms':rooms,'wallSolids':poly_json(wall),
            'openings':openings,'issues':issues,'balconies':[
                {k:(poly_json(v) if k in ['shape','door','guard'] else v) for k,v in b.items()}
                for b in level['balconies']]})
    covered=unary_union([levels[0]['slab']]+[b['shape'] for l in levels for b in l['balconies']])
    return {'candidateId':candidate['id'],'status':'polygon_review_not_verified_design',
        'court':poly_json(court) if court is not None else None,
        'voidUse':'bathroom_service_shaft' if service_shaft else 'habitable_court' if court is not None else None,
        'voidApproval':'working_owner_assumption_unverified' if service_shaft else 'source_adoption_unverified',
        'courtClearCore':poly_json(core_square) if core_square is not None else None,
        'courtStatus':'continuous_open_to_sky' if court is not None else 'no_feasible_court_in_search',
        'courtAttempts':attempts,'levels':output,'site':poly_json(site),
        'originalFindings':candidate.get('validation',{}).get('blockers',[]),
        'core':candidate['core'],'columns':candidate['grid']['columns'],
        'projectedCoveredAreaSqM':covered.area/1e6,
        'projectedCoverageRatio':covered.area/site.area,
        'balconyCount':sum(len(l['balconies']) for l in levels),
        'irregularRoomCount':sum(1 for l in levels for r in l['rooms']
            if not r['shape'].equals(r['shape'].envelope)),
        'unresolved':['Municipal projection and coverage treatment',
            'Court aperture performance, drainage and access',
            'Door swings and furnished access',
            'Structural beams, cantilevers and seismic response',
            'Original candidate findings remain applicable']}


def study(candidate):
    # Keep original defects visible; never imply a court exists if placement fails.
    attempts={};chosen=None;court=None;core_square=None;eligible=[]
    for proposal,square in court_shapes(candidate):
        result,error=transform(candidate,proposal)
        if error:
            attempts[error]=attempts.get(error,0)+1
            if error in ['COURT_LEAVES_UNUSABLE_ROOM','COURT_REMOVES_REQUIRED_ROOM_ACCESS',
                         'ROOM_REMOVED_OR_DISCONNECTED']:
                eligible.append((proposal,square))
            continue
        if not any(r['changed'] for l in result for r in l['rooms']):
            attempts['COURT_DOES_NOT_SERVE_ROOMS']=attempts.get('COURT_DOES_NOT_SERVE_ROOMS',0)+1;continue
        chosen=result;court=proposal;core_square=square;break
    if chosen is None:
        for proposal,square in eligible[:8]:
            revised,error=repartition_with_court(candidate,proposal)
            if error is None:
                result,error=transform(revised,proposal)
            if error:
                attempts[error]=attempts.get(error,0)+1;continue
            candidate=revised;chosen=result;court=proposal;core_square=square;break
    if chosen is None:
        # Smaller owner-proposed service shaft; never counted as habitable daylight.
        repair_candidates=[]
        for proposal,square in court_shapes(candidate,1371.6):
            result,error=transform(candidate,proposal)
            if error:
                attempts['SERVICE_SHAFT_'+error]=attempts.get('SERVICE_SHAFT_'+error,0)+1
                if error in ['COURT_LEAVES_UNUSABLE_ROOM','COURT_REMOVES_REQUIRED_ROOM_ACCESS',
                             'ROOM_REMOVED_OR_DISCONNECTED']:
                    repair_candidates.append((proposal,square))
                continue
            serves_bath=any(r['type']=='bathroom' and any(e.length>=1200 for e in
                parts(r['shape'].boundary.intersection(proposal.boundary),'LineString'))
                for l in result for r in l['rooms'])
            if not serves_bath:
                continue
            chosen=result;court=proposal;core_square=square;break
        if chosen is None:
            for proposal,square in islice(service_stack_shapes(candidate),96):
                revised,error=repartition_with_court(candidate,proposal,service=True)
                if error is None:
                    result,error=transform(revised,proposal)
                if error:
                    key='STACK_SERVICE_'+error
                    attempts[key]=attempts.get(key,0)+1;continue
                candidate=revised;chosen=result;court=proposal;core_square=square;break
        if chosen is None:
            def bathroom_distance(item):
                return min((rectangle(r['box']).distance(item[0])
                    for l in candidate['levels'] for r in (l.get('rooms') or {}).get('rooms',[])
                    if r['type']=='bathroom'),default=float('inf'))
            protected=unary_union([p for l in candidate['levels'] for p in protected_zones(candidate,l)])
            repair_candidates=[item for item in repair_candidates
                if protected.intersection(item[0].buffer(102)).area<=1]
            for proposal,square in sorted(repair_candidates,key=bathroom_distance)[:4]:
                revised,error=repair_shaft_neighbors(candidate,proposal)
                if error is None:
                    result,error=transform(revised,proposal)
                if error:
                    attempts[error]=attempts.get(error,0)+1;continue
                if not any(r['type']=='bathroom' and any(e.length>=1200 for e in
                    parts(r['shape'].boundary.intersection(proposal.boundary),'LineString'))
                    for l in result for r in l['rooms']):
                    continue
                candidate=revised;chosen=result;court=proposal;core_square=square;break
    if chosen is None:
        chosen,error=transform(candidate)
        if error:
            raise ValueError(error)
    add_balconies(candidate,chosen)
    return export(candidate,chosen,court,core_square,attempts)


if __name__=='__main__':
    try:
        request=json.load(sys.stdin)
        print(json.dumps({'studies':[study(c) for c in request['candidates'][:6]]},allow_nan=False))
    except Exception as e:
        print(json.dumps({'error':str(e)}));sys.exit(1)
