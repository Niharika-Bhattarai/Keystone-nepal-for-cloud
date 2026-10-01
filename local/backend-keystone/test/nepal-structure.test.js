'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normalizeBrief}=require('../lib/nepal/normalizeBrief');
const {searchConcepts}=require('../lib/nepal/candidateSearch');
const {zoneFactorFor,soilTypeFor,spectralShape}=require('../lib/nepal/structural/hazard');
const {distribution}=require('../lib/nepal/structural/seismic');
const {designStructure}=require('../lib/nepal/structural');
const {renderStructuralReport}=require('../lib/nepal/structural/report');
const S=require('../lib/nepal/structural/sections');
const {annexCRows}=require('../lib/nepal/structural/codeData');

const top=file=>{const brief=normalizeBrief(require(`./fixtures/nepal/${file}.json`)).brief;
  return {brief,candidate:searchConcepts(brief,{provisionalSetbacksMm:[1000,1000,1000,1000],
    workingCoverageLimit:0.7,maxCandidates:1}).candidates[0]};};
const close=(a,b,tol=1e-3)=>assert.ok(Math.abs(a-b)<=tol,`${a} ≠ ${b}`);

test('Annex C zoning factors are transcribed for every local unit and matched by English names',()=>{
  const rows=annexCRows();
  assert.equal(rows.length,753);
  assert.ok(rows.every(r=>[0.25,0.3,0.35,0.4].includes(r.pga)&&r.page>=100));
  assert.equal(zoneFactorFor('Kathmandu Metropolitan City').Z,0.35);
  assert.equal(zoneFactorFor('Bharatpur Metropolitan City').Z,0.4);
  assert.equal(zoneFactorFor('Dharan Sub-Metropolitan City').Z,0.4);
  assert.match(zoneFactorFor('Pokhara Metropolitan City').row.localUnit,/Pokhara Lekhnath/);
  assert.equal(zoneFactorFor('Gokarneswor Municipality').row.localUnit,'Gokarneshwor Nagarpalika');
  assert.equal(zoneFactorFor('Nowhere Town').found,false);
});

test('Table 4-3 default soil D applies to listed Kathmandu valley wards only',()=>{
  assert.equal(soilTypeFor('Kathmandu Metropolitan City','10').soil,'D');
  assert.equal(soilTypeFor('Kathmandu Metropolitan City','31').soil,null);
  assert.equal(soilTypeFor('Bhaktapur Municipality','7').soil,'D');
  assert.equal(soilTypeFor('Pokhara Metropolitan City','3').soil,null);
});

test('spectral shape follows Table 4-1 and eq 4.1(2) with Ta = 0 for ESM',()=>{
  assert.equal(spectralShape(0.05,'C').value,2.5);// ESM: plateau from T = 0
  close(spectralShape(0.05,'D',{method:'MRSM'}).value,1+1.25*0.05/0.5);
  assert.equal(spectralShape(0.9,'C').value,2.5);
  close(spectralShape(1.4,'B').value,2.5*0.7/1.4);
  close(spectralShape(4.5,'A').value,2.5*0.5*4/4.5**2);
  assert.equal(spectralShape(1.9,'D').value,2.25);
});

test('vertical distribution sums to the base shear and k follows 6.3',()=>{
  const d=distribution([1000,1000,500],[3,6,9],300,0.4);
  assert.equal(d.k,1);close(d.F.reduce((a,b)=>a+b,0),300);close(d.F[2]/d.F[0],500*9/(1000*3));
  assert.equal(distribution([1],[3],1,1.5).k,1.5);assert.equal(distribution([1],[3],1,3).k,2);
});

test('section formulas reproduce IS 456 Table 19 and the limiting moment',()=>{
  close(S.tauC(1,20),0.62,0.01);close(S.tauC(0.5,20),0.48,0.01);close(S.tauC(0.25,25),0.36,0.01);
  close(S.muLimCoeff(500),0.133,0.001);close(S.muLimCoeff(415),0.138,0.001);
  const rows=S.barRows(350,40,8,16,8);
  close(rows.reduce((n,r)=>n+r.As,0),8*Math.PI*64,1e-6);
  // axial capacity cap (IS 456 39.3)
  assert.equal(S.uniaxialCapacity(2e6,350,350,rows,20,500).ok,false);
});

test('structural design of a 3.5-storey Kathmandu plan: loads balance, NBC 105 ESM values and sized members',()=>{
  const {brief,candidate}=top('rental-3_5');
  const r=designStructure(candidate,brief);
  // gravity takedown is in equilibrium
  close(r.td.equilibrium.sumFootingDL,r.td.equilibrium.totalDL,1e-6);
  // hazard and base shear
  const g=r.an.dirs.x.gov;
  assert.equal(r.an.hz.Z,0.35);assert.equal(g.soil,'D');
  close(r.an.Temp,1.25*0.075*r.an.H**0.75);
  assert.ok(g.T<=r.an.Temp&&g.T<=g.Tray+1e-9);
  close(g.Cd,2.25*0.35*1/(4*1.5));close(g.V,g.Cd*r.an.Wt,1e-6);
  close(g.dist.F.reduce((a,b)=>a+b,0),g.V,1e-6);
  // the adopted sizes pass the code checks
  assert.equal(r.summary.pass,true);
  for(const d of r.drifts){assert.ok(d.ulsRatio<=0.025&&d.slsRatio<=0.006);}
  for(const c of r.columns){assert.ok(c.chosen.p>=0.01-1e-9&&c.chosen.p<=0.04&&c.chosen.count>=8&&c.chosen.dia>=12);}
  for(const b of r.beams){assert.ok(b.topBars.As>=2*Math.PI*36-1e-6&&b.botBars.As>=Math.max(b.botReq,0.5*b.topReq)-1e-6,b.id);
    assert.ok(b.links.end>=75&&b.links.end<=100&&b.b>=200);}
  assert.ok(r.joints.filter(j=>!j.roof).every(j=>j.Mc>=1.2*j.Mb));
  assert.ok(r.model.inputs.columnMm>=300);
  // the trials step up from the layout size and the last one is adopted
  assert.equal(r.trials[0].columnMm,350);assert.equal(r.trials.at(-1).full.pass,true);
  // NBC 205: panel area and the 47 % third floor put this house outside the ready-to-use guideline
  assert.equal(r.elig.eligible,false);
  assert.deepEqual(r.elig.items.filter(i=>!i.ok).map(i=>i.id).sort(),['panel area','penthouse']);
  for(const f of r.footings){assert.ok(f.B*f.B/1e6*r.sbc>=f.serv*1.1-1e-6&&f.punch<=f.tp);}
});

test('the calculation report cites clauses and pages and leaves professional fields blank',()=>{
  const {brief,candidate}=top('rental-3_5');
  const html=renderStructuralReport(designStructure(candidate,brief),{option:'Option 1',date:'2026-10-01'});
  for(const s of ['NBC 105:2025 6.1.1 eq 6.1(1)','PDF p.60','Annex C Table C-1 S.N. 345','PDF p.128','Table 4-3','Annex A 4.4.4',
    'IS 456:2000*','not supplied','PRELIMINARY — FOR ENGINEER REVIEW ONLY','checked by: — NEC no.: — signature: —',
    'Rayleigh period','Strong column','Isolated footings','IS 1893 (Part 1):2016 cross-check'])assert.ok(html.includes(s),s);
  assert.ok(!/<script/i.test(html));
});

test('a locked undersized frame is reported as failing rather than silently enlarged',()=>{
  const {brief,candidate}=top('rental-3_5');
  const r=designStructure(candidate,brief,{lockSizes:true,columnMm:350,beamWidthMm:230,beamDepthMm:355});
  assert.equal(r.trials.length,1);assert.equal(r.summary.pass,false);assert.equal(r.summary.driftOk,true);
  assert.equal(r.model.inputs.columnMm,350);
});

test('an unclassified site is calculated for soil C and D and the larger base shear governs',()=>{
  const {brief,candidate}=top('rental-3_5');
  const b={...brief,jurisdiction:{...brief.jurisdiction,ward:'31'}};
  const r=designStructure(candidate,b,{lockSizes:true,columnMm:400,beamWidthMm:300,beamDepthMm:450});
  const ps=r.an.dirs.x.perSoil;
  assert.deepEqual(ps.map(p=>p.soil),['C','D']);
  assert.equal(r.an.dirs.x.gov.V,Math.max(...ps.map(p=>p.V)));
  assert.ok(r.an.hz.notes.some(n=>/soil investigation/.test(n)));
});

test('other plan shapes run end to end',()=>{
  for(const file of ['rectangle-2_5']){
    const {brief,candidate}=top(file);if(!candidate)continue;
    const r=designStructure(candidate,brief);
    close(r.td.equilibrium.sumFootingDL,r.td.equilibrium.totalDL,1e-6);
    assert.ok(r.trials.length>=1&&r.columns.length&&r.footings.length,file);
    assert.ok(renderStructuralReport(r).includes('Summary'));
  }
});
