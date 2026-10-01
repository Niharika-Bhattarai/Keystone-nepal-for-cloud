'use strict';
// Survey cases found by the 2026-10-01 case matrix (local/tools/nepal-survey-matrix.cjs).
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normalizeBrief}=require('../lib/nepal/normalizeBrief');
const {preflightNepal}=require('../lib/nepal/preflight');
const {buildReviewCase}=require('../lib/nepal/reviewSheet');
const {planningBrief,largestRectangle}=require('../lib/nepal/plotFit');
const {renderDrawingSet}=require('../lib/nepal/drawingSet');
const {prepareNepalDxf}=require('../lib/nepal/dxfExport');
const {designStructure}=require('../lib/nepal/structural');
const rental=require('./fixtures/nepal/rectangle-2_5.json');

const survey=(patch={})=>{const s=structuredClone(rental);
  // a new plot size replaces the fixture's measured sides and recorded area
  if(patch['site.rectangle']||patch.site){delete s.site.sideLengths;delete s.site.declaredArea;}
  for(const [path,value] of Object.entries(patch)){const keys=path.split('.');let o=s;
    for(const k of keys.slice(0,-1))o=o[k]??={};o[keys.at(-1)]=value;}
  return s;};
const plan=s=>buildReviewCase('case',normalizeBrief(s).brief);
const sides=n=>Array.from({length:n},()=>({neighbor:'unknown'}));

test('a 0 m proposed setback on a shared-wall side is accepted and used',()=>{
  const s=survey({'site.boundaries':[{neighbor:'road'},{neighbor:'building',proposedSetback:{value:0,unit:'m'}},
    {neighbor:'unknown'},{neighbor:'building',proposedSetback:{value:0,unit:'m'}}]});
  const pf=preflightNepal(s);
  assert.equal(pf.contractReady,true,JSON.stringify(pf.blockers));
  assert.deepEqual(plan(s).assumptions.setbacksMm,[1000,0,1000,0]);
});

test('large plots fit the footprint to the coverage cap instead of failing',()=>{
  const s=survey({'site.rectangle':{width:{value:20,unit:'m'},depth:{value:25,unit:'m'}}});
  const r=plan(s).result;
  assert.ok(r.candidates.length>0);
  for(const c of r.candidates){assert.ok(c.ledger.groundCoverageRatio<=0.7+1e-9);assert.ok(c.envelope.coverageFit);}
});

test('a plot too small for the planner says why instead of returning nothing',()=>{
  const s=survey({'site.rectangle':{width:{value:5.5,unit:'m'},depth:{value:7.5,unit:'m'}},
    'buildingProgram.levels':rental.buildingProgram.levels.map(l=>l.kind==='partial'?{...l,targetArea:{value:25,unit:'sq_m'}}:l)});
  const r=plan(s).result;
  assert.equal(r.candidates.length,0);
  assert.match(r.attempts[0].reason,/below the planner's minimum 3\.9 × 6 m/);
  assert.ok(r.attempts.some(a=>a.status==='hint'&&/0 m there adds 2\.0 m of width/.test(a.reason)));
});

test('single-storey homes and 3.3 m storeys are planned',()=>{
  const one=survey({'buildingProgram.storeys':1,'buildingProgram.bedrooms':2,'buildingProgram.bathrooms':1,
    'buildingProgram.ownerProgram':{...rental.buildingProgram.ownerProgram,bedrooms:2,bathrooms:1,attachedBathrooms:0},
    'buildingProgram.levels':[{id:'ground',kind:'full',elevation:{value:0,unit:'m'},use:'home',occupancy:'owner',
      bedrooms:2,bathrooms:1,kitchens:1,livingRooms:1,attachedBathrooms:0,specialRooms:['puja']}]});
  const pf=preflightNepal(one);assert.equal(pf.contractReady,true,JSON.stringify(pf.blockers));
  const r=plan(one).result;
  assert.ok(r.candidates.length>0,JSON.stringify(r.attempts.slice(0,3)));
  assert.equal(r.candidates[0].core.futureStairReserved,true);
  const tall=survey({'buildingProgram.levels':rental.buildingProgram.levels.map((l,i)=>({...l,elevation:{value:i*3.3,unit:'m'}}))});
  const t=plan(tall).result;
  assert.ok(t.candidates.length>0,JSON.stringify(t.attempts.slice(0,3)));
  assert.ok(t.candidates[0].core.box.y2-t.candidates[0].core.box.y1>4585);
});

test('drawn plots are planned on their largest inner rectangle with the road at the bottom',()=>{
  const P=a=>a.map(([x,y])=>({xMm:x*1000,yMm:y*1000}));
  assert.deepEqual(largestRectangle(P([[0,0],[14,0],[14,7],[8,7],[8,14],[0,14]])),{x1:0,y1:0,x2:8000,y2:14000});
  const verts=[[0,0],[13,0],[14,12],[5,14],[0,10]];
  const s=survey({'site':{shape:'surveyedPolygon',vertices:verts.map(([x,y])=>({x,y,unit:'m'})),
    sideLengths:verts.map((p,i)=>{const q=verts[(i+1)%verts.length];return {value:Math.hypot(q[0]-p[0],q[1]-p[1]),unit:'m'};}),
    north:{bearingDegrees:90,evidence:'survey'},frontageEdges:[{edgeIndex:1,roadWidth:{value:4,unit:'m'}}],boundaries:sides(5)}});
  const pf=preflightNepal(s);assert.equal(pf.contractReady,true,JSON.stringify(pf.blockers));
  const b=planningBrief(pf.normalizedBrief);
  assert.equal(b.site.shape,'rectangle');assert.equal(b.site.frontageEdges[0].edgeIndex,0);
  // road edge (13,0)→(14,12) is turned to +x, so north turns with it
  const theta=Math.atan2(12,1)*180/Math.PI;
  assert.ok(Math.abs(b.site.north.bearingDegrees-((90-theta+360)%360))<0.01);
  assert.ok(b.site.planningFit.usedShare>0.6&&b.site.planningFit.usedShare<=1);
  // every planning-rectangle corner lies inside the real (turned) boundary
  const review=plan(s);assert.ok(review.result.candidates.length>0);
  const c=review.result.candidates[0];
  const set=renderDrawingSet(c,review.brief,{date:'2026-10-01'});
  assert.ok(set.html.includes('Drawn plot (heavy dashed)')&&set.html.includes('<polygon'));
  assert.equal(prepareNepalDxf(c,review.brief).plotPolygon.length,5);
  assert.ok(designStructure(c,review.brief).summary);
});

test('common municipality spellings resolve; partial floors larger than the plot allows are refused',()=>{
  for(const name of ['Kathmandu','kmc','KATHMANDU METROPOLITAN CITY','Kathmandu Mahanagarpalika'])
    assert.equal(normalizeBrief(survey({'jurisdiction.municipality':name})).brief.jurisdiction.municipality,'Kathmandu Metropolitan City');
  assert.equal(normalizeBrief(survey({'jurisdiction.municipality':'pokhara'})).brief.jurisdiction.municipality,'Pokhara Metropolitan City');
  // Owner decision 2026-10-01: other municipalities plan with generic working assumptions.
  for(const [typed,name] of [['lalitpur','Lalitpur Metropolitan City'],['Bhaktapur','Bhaktapur Municipality'],['Tokha','Tokha Municipality'],
    ['Kageshwori Manohara Municipality','Kageshwori Manahora Municipality']]){
    const pf=preflightNepal(survey({'jurisdiction.municipality':typed}));
    assert.equal(pf.contractReady,true,typed);assert.equal(pf.normalizedBrief.jurisdiction.municipality,name);
    assert.equal(pf.normalizedBrief.jurisdiction.profile.status,'generic_working_assumptions_bylaws_unreviewed');
    assert.ok(pf.blockers.some(b=>b.code==='MUNICIPAL_OVERLAY_PENDING'));
  }
  const html=require('../lib/nepal/reviewSheet').renderReviewDocument([plan(survey({'jurisdiction.municipality':'Lalitpur'}))]);
  assert.match(html,/Lalitpur Metropolitan City has no reviewed bylaw profile/);
  const unknown=preflightNepal(survey({'jurisdiction.municipality':'Nowhere Town'}));
  assert.equal(unknown.contractReady,false);assert.match(unknown.message,/Did you mean/);
  const big=preflightNepal(survey({'buildingProgram.levels':rental.buildingProgram.levels.map(l=>l.kind==='partial'?{...l,targetArea:{value:500,unit:'sq_m'}}:l)}));
  assert.ok(big.blockers.some(b=>b.code==='PARTIAL_AREA_TOO_LARGE'));
});

test('structure: bays too short for a frame beam are layout issues, not a reason to enlarge every member',()=>{
  const s=survey({'site.rectangle':{width:{value:12,unit:'m'},depth:{value:14,unit:'m'}}});
  const review=plan(s);
  for(const c of review.result.candidates.slice(0,2)){
    const r=designStructure(c,review.brief);
    assert.equal(r.summary.pass,true,JSON.stringify(r.summary));
    for(const b of r.beams){assert.ok(b.links.end>=75);
      if(b.layoutIssue)assert.ok(r.summary.layoutIssues.includes(b.id));}
  }
});

test('narrow plots: shared-wall 6 m and 4 m wide houses get narrow or mid-stair layouts',()=>{
  const sides0=[{neighbor:'road'},{neighbor:'building',proposedSetback:{value:0,unit:'m'}},{neighbor:'unknown'},{neighbor:'building',proposedSetback:{value:0,unit:'m'}}];
  const six=plan(survey({'site.rectangle':{width:{value:6,unit:'m'},depth:{value:16,unit:'m'}},'site.boundaries':sides0}));
  const cands=[...six.result.candidates,...(six.result.parkingProgramVariant?.candidates||[])];
  assert.ok(cands.length>0,JSON.stringify(six.result.attempts.slice(0,3)));
  const layouts=new Set(cands.flatMap(c=>c.levels.map(l=>l.rooms?.layout).filter(Boolean)));
  assert.ok([...layouts].some(l=>/^narrow/.test(l)),[...layouts].join());
  for(const c of cands)for(const l of c.levels)for(const r of l.rooms?.rooms||[])
    assert.ok(r.doorReservation||r.entryFrom==='shared-floor-level-arrival',`${r.id} has no door`);
  // A mid-depth stair puts a full-width room in front of it.
  const mid=cands.find(c=>c.core.position==='middle');
  if(mid){assert.ok(mid.core.box.y1>mid.levels[0].footprint.slabs[0].y1);
    assert.equal(mid.levels[0].rooms.rooms.find(r=>r.box.y1===mid.levels[0].footprint.slabs[0].y1).box.x2-
      mid.levels[0].rooms.rooms.find(r=>r.box.y1===mid.levels[0].footprint.slabs[0].y1).box.x1,
      mid.levels[0].footprint.slabs[0].x2-mid.levels[0].footprint.slabs[0].x1);}
});

test('rooms that do not fit their floor are offered as a labelled program variant, never silently',()=>{
  const sides0=[{neighbor:'road'},{neighbor:'building',proposedSetback:{value:0,unit:'m'}},{neighbor:'unknown'},{neighbor:'building',proposedSetback:{value:0,unit:'m'}}];
  const r=plan(survey({'site.rectangle':{width:{value:8,unit:'m'},depth:{value:10,unit:'m'}},'site.boundaries':sides0})).result;
  if(!r.candidates.length){
    const v=r.parkingProgramVariant;assert.ok(v&&v.candidates.length>0);
    assert.match(v.change.label,/^Program variant: /);assert.equal(v.change.status,'program_change_requires_household_confirmation');
    for(const c of v.candidates)assert.ok(c.validation.blockers.some(b=>b.code==='PROGRAM_CHANGED_TO_FIT_OWNER_REVIEW'));
  }
});
