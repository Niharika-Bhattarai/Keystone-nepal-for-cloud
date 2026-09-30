import json
import sqlite3
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch
import knowledge as k

def rule(id='X',tier=1,predicate=None,applies=None):
    return {'id':id,'tier':tier,'sources':[], 'predicate':predicate or {'fact':'x','op':'eq','value':True},'applies_when':applies}

class KnowledgeTests(unittest.TestCase):
    def test_all_inputs_indexed(self):
        m=json.loads((k.ROOT/'manifest.json').read_text(encoding='utf-8'))
        supplied=list((k.ROOT.parent/'Design Files').rglob('*.pdf'))+list((k.ROOT.parent/'Design Files').rglob('*.epub'))
        self.assertEqual(len(m),len(supplied))
        self.assertEqual(len({s['id'] for s in m}),len(m))
    def test_rule_citations_exist(self):
        for r in k.rules():
            self.assertTrue(r['sources'])
            for s in r['sources']:
                with closing(sqlite3.connect(k.ROOT/'library.sqlite')) as db:
                    self.assertIsNotNone(db.execute('select 1 from chunks where source_id=? and locator=?',(s['source_id'],s['locator'])).fetchone(),r['id'])
    def test_latest_seismic_search(self):
        hits=k.search('soil category',source='nbc105-2025',limit=5)
        self.assertTrue(hits)
        self.assertTrue(all(h['source_id']=='nbc105-2025' for h in hits))
    def test_old_commentary_excluded(self):
        self.assertEqual(k.search('seismic',source='nbc105-commentary-draft'),[])
        self.assertTrue(k.search('seismic',source='nbc105-commentary-draft',include_reference=True))
    def test_stair_table_retrieval(self):
        text=k.page('nbc206-2024','page-0015')['text']
        self.assertIn('250',text); self.assertIn('190',text)
    def test_empty_search(self): self.assertEqual(k.search(''),[])
    def test_punctuation_search(self): self.assertEqual(k.search('" () ;'),[])
    def test_unknown_page(self):
        with self.assertRaises(ValueError):k.page('nbc206-2024','page-9999')
    def test_missing_fact_never_passes(self):
        out=k.evaluate({},[rule(tier=0)])
        self.assertEqual(out['results'][0]['outcome'],'unknown');self.assertFalse(out['rankable'])
    def test_false_not_missing(self):
        self.assertEqual(k.evaluate({'x':False},[rule()])['results'][0]['outcome'],'fail')
    def test_string_bool_does_not_pass(self):
        self.assertEqual(k.evaluate({'x':'true'},[rule()])['results'][0]['outcome'],'fail')
    def test_numeric_boundaries(self):
        r=rule(tier=0,predicate={'fact':'rise','op':'lte','value':190})
        for value,outcome in [(190,'pass'),(190.1,'fail'),('190','invalid_fact'),(True,'invalid_fact'),(float('nan'),'invalid_fact')]:
            self.assertEqual(k.evaluate({'rise':value},[r])['results'][0]['outcome'],outcome)
    def test_applicability_unknown(self):
        r=rule(applies={'fact':'requested','op':'eq','value':True})
        self.assertEqual(k.evaluate({'x':True},[r])['results'][0]['outcome'],'unknown')
    def test_optional_absence(self):
        r=rule(applies={'fact':'requested','op':'eq','value':True})
        self.assertEqual(k.evaluate({'requested':False},[r])['results'][0]['outcome'],'not_applicable')
    def test_unknown_manual_rule_prevents_ranking(self):
        r=rule();r['predicate']=None
        self.assertFalse(k.evaluate({'x':True},[rule(id='gate',tier=0),r])['rankable'])
    def test_vastu_core_outranks_details(self):
        rs=[rule('gate',0),rule('core',1,{'fact':'core','op':'eq','value':True})]
        rs += [rule(str(i),2,{'fact':'details','op':'eq','value':True}) for i in range(10)]
        out=k.rank_candidates([{'id':'decor','facts':{'x':True,'core':False,'details':True}}, {'id':'core','facts':{'x':True,'core':True,'details':False}}],rs)
        self.assertEqual(out['ranked'][0]['id'],'core')
    def test_mandatory_failure_excluded(self):
        out=k.rank_candidates([{'id':'bad','facts':{'x':False}}],[rule(tier=0)])
        self.assertEqual(out['ranked'],[]);self.assertEqual(len(out['excluded']),1)
    def test_source_drift_detected(self):
        with patch.object(k.hashlib,'sha256') as digest:
            digest.return_value.hexdigest.return_value='changed'
            with self.assertRaises(ValueError):k.page('nbc206-2024','page-0015')
    def test_no_gates_cannot_rank(self):self.assertFalse(k.evaluate({'x':True},[rule()])['rankable'])
    def test_sparse_ocr_labeled(self):
        p=k.page('nbc105-2025','page-0002')
        self.assertIn('ocr_unverified',p['extraction_flags'])
        self.assertIn('2025',p['text'])

if __name__=='__main__':unittest.main()
