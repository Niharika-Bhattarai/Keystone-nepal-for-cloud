"""Area ledger arithmetic; caller supplies verified, non-overlapping measured atoms.

No legal exemptions or polygon unions are inferred. Unknown decisions stay unknown.
"""
import math

def number(value,name):
    if type(value) not in (int,float) or not math.isfinite(value) or value<0:
        raise ValueError(f'{name} must be a finite nonnegative number')
    return value

def calculate(plot_area_m2,atoms,coverage_limit_pct=None,far_limit=None):
    number(plot_area_m2,'plot_area_m2')
    if plot_area_m2==0:raise ValueError('Plot area must be positive')
    if coverage_limit_pct is not None:
        number(coverage_limit_pct,'coverage_limit_pct')
        if coverage_limit_pct>100:raise ValueError('Coverage limit must not exceed 100%')
    if far_limit is not None:number(far_limit,'far_limit')
    seen=set(); sums={'far':0.0,'coverage':0.0}; unresolved={'far':[],'coverage':[]}
    ledger=[]
    for atom in atoms:
        if atom['id'] in seen:raise ValueError('Duplicate area atom')
        seen.add(atom['id']);area=number(atom['area_m2'],'area_m2')
        item={'id':atom['id'],'area_m2':area,'level_id':atom['level_id'],'use':atom['use']}
        for metric in sums:
            decision=atom.get(metric)
            if decision not in ('include','exclude',None):raise ValueError('Decision must be include, exclude or null')
            evidence=atom.get(metric+'_basis')
            if decision is None or not evidence:
                unresolved[metric].append(atom['id']);item[metric]='unresolved'
            else:
                item[metric]=decision;item[metric+'_basis']=evidence
                if decision=='include':sums[metric]+=area
        ledger.append(item)
    if not atoms:
        unresolved={'far':['no_geometry'],'coverage':['no_geometry']}
    far=sums['far']/plot_area_m2 if not unresolved['far'] else None
    coverage=100*sums['coverage']/plot_area_m2 if not unresolved['coverage'] else None
    def status(value,limit):return 'unknown' if value is None or limit is None else 'pass' if value<=limit+1e-9 else 'fail'
    return dict(plot_area_m2=plot_area_m2,far=far,coverage_pct=coverage,
      far_status=status(far,far_limit),coverage_status=status(coverage,coverage_limit_pct),
      known_counted_area_m2=sums,unresolved=unresolved,ledger=ledger,
      notice='Arithmetic only. Caller must prove polygon partition/union, legal accounting basis, plot denominator and adopted limits. Not a permit compliance decision.')

def resource_residential_coverage_candidate(plot_area_m2):
    """2023 resource p54 candidate only; caller must confirm adopted applicability."""
    number(plot_area_m2,'plot_area_m2')
    if plot_area_m2<=0:raise ValueError('Plot area must be positive')
    return {'coverage_limit_pct':70 if plot_area_m2<=250 else 60,
            'source':'bylaws-resource-2023#page-0054','status':'requires_local_adoption_confirmation'}
