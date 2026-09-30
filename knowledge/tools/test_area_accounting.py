import unittest
from area_accounting import calculate,resource_residential_coverage_candidate

def atom(id,area,far='include',coverage='exclude'):
    return dict(id=id,area_m2=area,level_id=id,use='test',far=far,coverage=coverage,far_basis='fixture-only reviewed rule',coverage_basis='fixture-only reviewed rule')

class AreaTests(unittest.TestCase):
    def test_partial_floor_and_coverage_separate(self):
        out=calculate(100,[atom('ground',60,coverage='include'),atom('first',60),atom('partial',25)],70,1.5)
        self.assertEqual(out['far'],1.45);self.assertEqual(out['coverage_pct'],60)
    def test_parking_not_globally_exempt(self):
        out=calculate(100,[atom('living',60,coverage='include'),atom('roofed-parking',15,far='exclude',coverage='include')],70,2)
        self.assertEqual(out['far'],.6);self.assertEqual(out['coverage_status'],'fail')
    def test_unknown_is_not_zero(self):
        out=calculate(100,[atom('balcony',10,far=None)])
        self.assertIsNone(out['far']);self.assertEqual(out['far_status'],'unknown')
    def test_missing_basis_is_unknown(self):
        a=atom('one',60);a.pop('far_basis')
        self.assertIsNone(calculate(100,[a])['far'])
    def test_empty_geometry_unknown(self):self.assertIsNone(calculate(100,[])['far'])
    def test_duplicate_atoms_rejected(self):
        with self.assertRaises(ValueError):calculate(100,[atom('same',10),atom('same',10)])
    def test_invalid_values_rejected(self):
        for p in (0,-1,True,float('inf')):
            with self.assertRaises(ValueError):calculate(p,[])
    def test_threshold(self):
        self.assertEqual(resource_residential_coverage_candidate(250)['coverage_limit_pct'],70)
        self.assertEqual(resource_residential_coverage_candidate(250.01)['coverage_limit_pct'],60)

if __name__=='__main__':unittest.main()
