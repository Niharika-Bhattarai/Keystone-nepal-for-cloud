import copy
import unittest
from shapely.geometry import box, shape, Polygon, mapping
from spatial_study import study, transform, court_shapes, usable_rectangle, export, repair_shaft_neighbors


def fixture():
    """Large analytical fixture, NOT a generated/engineered Nepal house."""
    c={'id':'analytical-court-fixture','envelope':{
        'site':dict(x1=0,y1=0,x2=14000,y2=14000),
        'buildable':dict(x1=1500,y1=1500,x2=12500,y2=12500)},
       'grid':{'xAxesMm':[1675,3925,8000,12325],
        'yAxesMm':[1675,5910,9900,12325],'columns':[]},
       'core':{'box':dict(x1=1500,y1=1500,x2=4100,y2=6085)},'levels':[]}
    for i in range(3):
        rooms=[]
        for j,(kind,b) in enumerate([('livingRoom',[5200,1500,12500,7000]),
                                   ('kitchen',[5200,7000,12500,12500])]):
            x1,y1,x2,y2=b
            rooms.append({'id':f'{i}-{j}','type':kind,
                'box':dict(zip(['x1','y1','x2','y2'],b)),
                'doorReservation':{'axis':'vertical','x':x1,'y1':y1+400,
                    'y2':y1+1300,'clearWidthMm':900}})
        c['levels'].append({'id':str(i),'footprint':{'slabs':[[1500,1500,12500,12500]]},
            'rooms':{'rooms':rooms,'corridor':dict(x1=4100,y1=1500,x2=5200,y2=12500)},
            'residentialDetails':{}})
    return c


class PolygonStudyTest(unittest.TestCase):
    def test_neighbor_partition_repair_preserves_rooms_and_fits_shaft(self):
        c=fixture()
        for level in c['levels']:
            room=level['rooms']['rooms'][0]
            room['type']='bathroom'
            room['box']=dict(x1=5200,y1=1500,x2=7100,y2=7000)
            level['rooms']['rooms'].append({'id':level['id']+'-utility','type':'utilityFlex',
                'box':dict(x1=7100,y1=1500,x2=12500,y2=7000)})
        shaft=box(5600,3200,7429.6,5029.6)
        _,error=transform(c,shaft)
        self.assertEqual(error,'COURT_LEAVES_UNUSABLE_ROOM')
        revised,error=repair_shaft_neighbors(c,shaft)
        self.assertIsNone(error)
        levels,error=transform(revised,shaft)
        self.assertIsNone(error)
        for before,after,measured in zip(c['levels'],revised['levels'],levels):
            self.assertEqual([r['id'] for r in before['rooms']['rooms']],
                             [r['id'] for r in after['rooms']['rooms']])
            self.assertTrue(any(r.get('shaftPartitionRepaired') for r in after['rooms']['rooms']))
            self.assertTrue(all(r['fit'] is not None for r in measured['rooms']))

    def test_service_shaft_is_not_credited_as_habitable_daylight(self):
        c=fixture()
        inner=box(8000,8500,9371.6,9871.6)
        shaft=inner.buffer(229,join_style=2)
        levels,error=transform(c,shaft)
        self.assertIsNone(error)
        for level in levels:
            level['balconies']=[]
        result=export(c,levels,shaft,inner,{})
        self.assertEqual(result['voidUse'],'bathroom_service_shaft')
        self.assertAlmostEqual(shape(result['courtClearCore']).area,1371.6**2)
        for level in result['levels']:
            self.assertTrue(any(o['kind']=='service-shaft-window' for o in level['openings']))
            kitchen=next(r for r in level['rooms'] if r['type']=='kitchen')
            issue=next(i for i in level['issues'] if i['code']=='INSUFFICIENT_RESERVED_LIGHT_OPENING_AREA'
                       and i['roomId']==kitchen['id'])
            self.assertEqual(issue['reservedSqM'],0)

    def test_court_aligned_on_every_floor_with_clear_core_and_exact_areas(self):
        c=fixture();r=study(c)
        self.assertEqual(r['courtStatus'],'continuous_open_to_sky')
        court=shape(r['court']);core=shape(r['courtClearCore'])
        self.assertAlmostEqual(core.area,9e6)
        self.assertTrue(court.buffer(-229+.01).covers(core))
        self.assertGreater(r['irregularRoomCount'],0)
        for original,l in zip(c['levels'],r['levels']):
            self.assertEqual(len(l['rooms']),len(original['rooms']['rooms']))
            self.assertLess(shape(l['slab']).intersection(court).area,1)
            self.assertAlmostEqual(l['slabAreaSqM'],121-court.area/1e6)
            for room in l['rooms']:
                self.assertTrue(shape(room['polygon']).is_valid)
                self.assertLess(shape(room['polygon']).intersection(court).area,1)
                self.assertIsNotNone(room['functionalZone'])

    def test_core_and_floor_arrival_cannot_be_cut(self):
        levels,error=transform(fixture(),box(2000,2000,5500,5500))
        self.assertIsNone(levels)
        self.assertIn('CORE_CIRCULATION',error)

    def test_column_cannot_disappear_in_court(self):
        c=fixture();r=study(c);court=shape(r['court']);p=court.centroid
        c['grid']['columns']=[{'id':'test','xMm':p.x,'yMm':p.y,'widthMm':350}]
        levels,error=transform(c,court)
        self.assertEqual(error,'COURT_HITS_COLUMN_OR_SUPPORT_RESERVATION')

    def test_required_door_cannot_be_removed(self):
        c=fixture()
        c['levels'][0]['rooms']['rooms'][0]['doorReservation']={
            'axis':'horizontal','y':7000,'x1':7500,'x2':8400,'clearWidthMm':900}
        _,error=transform(c,box(7200,6500,10658,9958))
        self.assertIn(error,['COURT_REMOVES_REQUIRED_ROOM_ACCESS','COURT_LEAVES_UNUSABLE_ROOM'])

    def test_angled_and_concave_rooms_use_polygon_area_not_bounding_box(self):
        c=fixture();room=c['levels'][0]['rooms']['rooms'][0]
        polygon=Polygon([(5200,1500),(12500,1500),(11500,7000),(5200,7000)])
        room['polygon']=mapping(polygon)
        levels,error=transform(c)
        self.assertIsNone(error)
        self.assertAlmostEqual(levels[0]['rooms'][0]['areaSqM'],polygon.area/1e6)
        self.assertLess(polygon.area,polygon.envelope.area)

    def test_crossed_polygon_rejected(self):
        c=fixture();c['levels'][0]['rooms']['rooms'][0]['polygon']=mapping(
            Polygon([(5200,1500),(12500,7000),(5200,7000),(12500,1500)]))
        _,error=transform(c)
        self.assertEqual(error,'INVALID_OR_OUTSIDE_ROOM_POLYGON')

    def test_functional_fit_cannot_use_a_polygon_bounding_void(self):
        p=box(0,0,4000,4000).difference(box(1000,1000,4000,4000))
        self.assertIsNone(usable_rectangle(p,2400,2700))

    def test_balconies_have_access_and_stay_outside_slab_inside_plot(self):
        c=fixture();r=study(c)
        self.assertGreater(r['balconyCount'],0)
        site=shape(r['site'])
        for l in r['levels']:
            for b in l['balconies']:
                slab=shape(l['slab']);balcony=shape(b['shape']);door=shape(b['door'])
                self.assertTrue(site.covers(balcony))
                self.assertLess(slab.intersection(balcony).area,1)
                self.assertTrue(balcony.boundary.buffer(.1).covers(door))
                self.assertTrue(slab.boundary.buffer(.1).covers(door))
                self.assertGreater(shape(b['guard']).length,0)
                self.assertLess(shape(l['wallSolids']).intersection(door).length,1)


if __name__=='__main__':
    unittest.main()

