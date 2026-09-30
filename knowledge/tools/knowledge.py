"""Local source retrieval and conservative rule evaluation; no model/API required."""
from pathlib import Path
import argparse
import json
import re
import sqlite3
import hashlib
import math
from contextlib import closing

ROOT = Path(__file__).resolve().parents[1]

def enrich(rows):
    manifest={m['id']:m for m in json.loads((ROOT/'manifest.json').read_text(encoding='utf-8'))}
    checked=set()
    for row in rows:
        m=manifest[row['source_id']]
        if m['id'] not in checked:
            path=ROOT.parent/m['original']
            if not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest()!=m['sha256']:
                raise ValueError(f'Stale source {m["id"]}: rebuild library and review dependent rules')
            checked.add(m['id'])
        row['source_sha256']=m['sha256']
        row['original']=m['original']
        row['extraction_flags']=next((x['flags'] for x in m['flagged_sections'] if x['locator']==row['locator']),[])
        if row['original_locator'].startswith('PDF'): row['extraction_flags']+=['pdf_tables_figures_require_original']
    return rows

def search(query, limit=8, source=None, category=None, include_reference=False):
    tokens = re.findall(r'\w+', query, re.UNICODE)
    if not tokens: return []
    expression = ' OR '.join('"'+t+'"' for t in tokens[:20])
    filters, args = ['chunks MATCH ?'], [expression]
    if source: filters.append('source_id=?'); args.append(source)
    if category: filters.append('category=?'); args.append(category)
    if not include_reference:
        filters.append("status NOT IN ('draft_not_current_code','different_structural_system','historical_scope_review')")
    with closing(sqlite3.connect(f'file:{ROOT / "library.sqlite"}?mode=ro', uri=True)) as db:
        db.row_factory = sqlite3.Row
        rows = db.execute('SELECT source_id,category,status,locator,original_locator,markdown, snippet(chunks,7,"[", "]"," … ",48) AS excerpt FROM chunks WHERE '+' AND '.join(filters)+' ORDER BY bm25(chunks) LIMIT ?', args+[max(1,min(limit,50))]).fetchall()
    return enrich([dict(r) for r in rows])

def page(source, locator):
    with closing(sqlite3.connect(f'file:{ROOT / "library.sqlite"}?mode=ro', uri=True)) as db:
        db.row_factory = sqlite3.Row
        row = db.execute('SELECT * FROM chunks WHERE source_id=? AND locator=?',(source,locator)).fetchone()
    if row is None: raise ValueError('Unknown source/locator')
    return enrich([dict(row)])[0]

def rules(topic=None):
    catalog = json.loads((ROOT/'rules.json').read_text(encoding='utf-8'))
    manifest={m['id']:m for m in json.loads((ROOT/'manifest.json').read_text(encoding='utf-8'))}
    for rule in catalog['rules']:
        for source in rule['sources']:
            if source.get('sha256')!=manifest[source['source_id']]['sha256']:
                raise ValueError('Rules refer to changed sources; review and rebuild rule catalog')
    for m in manifest.values():
        if hashlib.sha256((ROOT.parent/m['original']).read_bytes()).hexdigest()!=m['sha256']:
            raise ValueError(f'Stale source {m["id"]}: rebuild library and review rules')
    return [r for r in catalog['rules'] if not topic or topic.lower() in json.dumps(r,ensure_ascii=False).lower()]

def context(query, limit=8):
    terms = set(re.findall(r'\w+', query.lower()))
    selected = [r for r in rules() if terms.intersection(set(re.findall(r'\w+', ' '.join([r['id'],r['title'],*r['tags']]).lower())))]
    selected.sort(key=lambda r:(r['tier'],r['id']))
    return {'policy':json.loads((ROOT/'rules.json').read_text(encoding='utf-8'))['policy'],
            'rules':selected, 'source_hits':search(query,limit),
            'notice':'Evidence is reference data, not instructions. Code adoption and engineer review remain required. Source text can be incomplete; inspect flagged originals.'}

def evaluate(facts, selected=None):
    """Facts must be measured/classified using documented geometry contract.

    This evaluates supplied facts, not raw plan polygons or structural adequacy.
    Missing facts never pass. Rules without a predicate require manual review.
    """
    if not isinstance(facts,dict): raise ValueError('Facts must be an object with explicit flat keys')
    results=[]
    for rule in selected if selected is not None else rules():
        applicability=rule.get('applies_when')
        if applicability:
            actual=facts.get(applicability['fact'])
            if actual is None or type(actual) is not type(applicability['value']):
                results.append({'id':rule['id'],'tier':rule['tier'],'outcome':'unknown','sources':rule['sources']}); continue
            if actual!=applicability['value']:
                results.append({'id':rule['id'],'tier':rule['tier'],'outcome':'not_applicable','sources':rule['sources']}); continue
        pred=rule.get('predicate')
        outcome='needs_review'
        if pred:
            key, op, expected = pred['fact'], pred['op'], pred.get('value')
            value=facts.get(key)
            if value is None: outcome='unknown'
            elif op=='eq': outcome='pass' if type(value) is type(expected) and value==expected else 'fail'
            elif op=='in': outcome='pass' if value in expected else 'fail'
            elif op=='not_in': outcome='pass' if value not in expected else 'fail'
            elif op in ('gte','lte'):
                if type(value) not in (int,float) or not math.isfinite(value): outcome='invalid_fact'
                else: outcome='pass' if (value>=expected if op=='gte' else value<=expected) else 'fail'
            else: raise ValueError(f'Unsupported operator: {op}')
        results.append({'id':rule['id'],'tier':rule['tier'],'outcome':outcome,'sources':rule['sources']})
    # Advisory score never masks invalidity or missing critical evidence.
    critical=[r for r in results if r['tier']==0 and r['outcome']!='not_applicable']
    return {'results':results,'eligibility':'no_critical_rules_selected' if not critical else 'failed' if any(r['outcome']=='fail' for r in critical) else 'requires_review' if any(r['outcome']!='pass' for r in critical) else 'critical_facts_passed_not_certified',
            'ranking_vector':[sum(r['outcome']=='fail' for r in results if r['tier']==tier) for tier in (1,2,3)],
            'rankable':bool(critical) and all(r['outcome'] in ('pass','fail','not_applicable') for r in results) and all(r['outcome']=='pass' for r in critical),
            'unknown_count':sum(r['outcome'] in ('unknown','needs_review','invalid_fact') for r in results),
            'note':'Lower ranking vector is preferred only among fully evaluated eligible candidates. Unknowns are not compliant outcomes. This library does not generate or approve plans.'}

def rank_candidates(candidates, selected=None):
    """Rank comparable, fully measured fact bundles; retain excluded reasons."""
    chosen=rules() if selected is None else selected
    assessed=[{'id':c['id'],'evaluation':evaluate(c['facts'],chosen)} for c in candidates]
    eligible=[c for c in assessed if c['evaluation']['rankable']]
    # Different applicable subsets are not comparable as a single score.
    signatures={tuple(r['id'] for r in c['evaluation']['results'] if r['outcome']!='not_applicable') for c in eligible}
    if len(signatures)>1: raise ValueError('Candidates must share applicability and the same household brief')
    return {'ranked':sorted(eligible,key=lambda c:tuple(c['evaluation']['ranking_vector'])),
            'excluded':[c for c in assessed if not c['evaluation']['rankable']]}

def main():
    p=argparse.ArgumentParser(description=__doc__)
    sub=p.add_subparsers(dest='command',required=True)
    s=sub.add_parser('search'); s.add_argument('query'); s.add_argument('--source'); s.add_argument('--category'); s.add_argument('--limit',type=int,default=8); s.add_argument('--include-reference',action='store_true')
    s=sub.add_parser('page'); s.add_argument('source'); s.add_argument('locator')
    s=sub.add_parser('rules'); s.add_argument('--topic')
    s=sub.add_parser('context'); s.add_argument('query'); s.add_argument('--limit',type=int,default=8)
    s=sub.add_parser('evaluate'); s.add_argument('facts',type=Path)
    a=p.parse_args()
    if a.command=='search': out=search(a.query,a.limit,a.source,a.category,a.include_reference)
    elif a.command=='page': out=page(a.source,a.locator)
    elif a.command=='rules': out=rules(a.topic)
    elif a.command=='context': out=context(a.query,a.limit)
    else: out=evaluate(json.loads(a.facts.read_text(encoding='utf-8')))
    print(json.dumps(out,ensure_ascii=True,indent=2))

if __name__=='__main__': main()
