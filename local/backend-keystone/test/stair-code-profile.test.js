'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {getStairCodeProfile,createStricterProfile,ruleFeet,TICKS_PER_FOOT,PRODUCT_DEFAULTS}=require('../lib/stairs/codeProfiles');
const {exactTicks,uniformRiser,withinMaximum,rationalFeet}=require('../lib/stairs/precision');
const {fitStairLayout}=require('../lib/stairLayout');
const {validateFittedLayout}=require('../lib/stairs/validateFittedLayout');
const {migratePlanStairs}=require('../lib/stairs/stairModelMigration');
const {validateStairAssembly}=require('../lib/stairs/validateStairAssembly');
const {validatePlanStairAssemblies}=require('../lib/stairs/validatePlanStairAssemblies');
const {validatePlanSpecSchema}=require('../lib/validateSchema');
const {stripPlanSpecForValidation}=require('../lib/residential/v2/candidateGeneration');
const {validateStairGeometry}=require('../lib/residential/v2/validators/stairGeometryValidator');

function straight(riseFt=10) {
  return fitStairLayout({core:{x:0,y:0,w:6,h:14},lowerHall:{x:0,y:14,w:6,h:6},upperHall:{x:0,y:-6,w:6,h:6},riseFt});
}
function oldPlan(numbers=[1,2]) {
  return {stories:2,levels:numbers.map((number,index)=>({
    level:number,width:30,height:30,doors:[],windows:[],
    rooms:[{id:`s${number}`,type:'stairs',x:0,y:0,w:8,h:16},{id:`h${number}`,type:'hallway',x:0,y:-6,w:8,h:6}],
    stairCore:{roomId:`s${number}`,landingRoomId:`h${number}`,vertical:{riseFt:10},layout:{valid:true,risers:1}},
    verticalProfile:{level:number,floorZFt:(index-(numbers.length===3?1:0))*10},
  }))};
}

test('stair profile is immutable, source-traceable and separate from product defaults',()=>{
  const p=getStairCodeProfile();
  for(const r of Object.values(p.rules)) {
    assert.equal(r.edition,'2021 IRC');assert.match(r.section,/^R3/);assert.match(r.sourceUrl,/^https:/);
    assert.ok(r.purpose);assert.equal(r.ticks,r.inches*64);
  }
  assert.throws(()=>{p.rules.maxRiser.inches=9;},TypeError);
  assert.equal(ruleFeet('maxRiser'),7.75/12);
  assert.equal(PRODUCT_DEFAULTS.minBetweenRailsIn,36);
  assert.equal(p.rules.minWidthTwoRails.inches,27);
  assert.throws(()=>getStairCodeProfile('Craftsman'),/Unknown/);
  assert.throws(()=>getStairCodeProfile({...p}),/Unknown/,'untrusted objects cannot inject weakened rules');
});

test('exact riser boundary rejects one tick over and preserves a rational quotient',()=>{
  const max=getStairCodeProfile().rules.maxRiser.ticks;
  assert.equal(withinMaximum(uniformRiser(max*16,16),max),true);
  assert.equal(withinMaximum(uniformRiser(max*16+1,16),max),false);
  const rise=uniformRiser(exactTicks(10),17);
  assert.equal(rationalFeet(rise)*17,10);
  for(const n of [NaN,Infinity,'10',null]) assert.throws(()=>exactTicks(n));
  assert.throws(()=>exactTicks(10+0.5/TICKS_PER_FOOT),/grid/);
});

test('custom profile may only strengthen known rules and affects the fitter',()=>{
  const p=createStricterProfile({id:'project-stricter',overrides:{maxRiser:7,minGoing:11},reason:'Project brief',sourceUrl:'project:brief'});
  assert.equal(ruleFeet('maxRiser',p),7/12);
  const layout=fitStairLayout({core:{x:0,y:0,w:8,h:20},lowerHall:{x:0,y:20,w:8,h:8},upperHall:{x:0,y:-8,w:8,h:8},riseFt:10,codeProfile:p});
  assert.equal(layout.valid,true);assert.ok(layout.riserFt<=7/12);assert.ok(layout.treadFt>=11/12);
  assert.equal(validateFittedLayout(layout,{profile:p}).valid,true);
  for(const overrides of [{maxRiser:8},{minGoing:9},{imaginaryRule:3}]) assert.throws(()=>createStricterProfile({id:'bad',overrides,reason:'test',sourceUrl:'project:brief'}));
});

test('independent layout check rejects stale valid flags, fractional counts and malformed flights',()=>{
  const layout=straight();assert.equal(validateFittedLayout(layout).valid,true);
  for(const change of [
    p=>{p.flights=[];},p=>{p.flights[0].risers=1.5;},p=>{p.flights[0].to.x+=1;},
    p=>{p.flights[0].toZFt-=1;},p=>{p.flights[0].rect.w=2;},p=>{p.riserFt=Infinity;},
  ]) {const bad=structuredClone(layout);change(bad);assert.equal(validateFittedLayout(bad).valid,false);}
  const oneTickShort=structuredClone(layout);oneTickShort.treadFt=ruleFeet('minGoing')-1/TICKS_PER_FOOT;
  assert.equal(validateFittedLayout(oneTickShort).valid,false);
  const noFlag=structuredClone(layout);delete noFlag.valid;
  assert.equal(validateFittedLayout(noFlag).valid,true,'measure the dimensions, not the flag');
});

test('uninterrupted rise is limited independently of total riser height',()=>{
  const rise=151/12,risers=20,going=11/12,run=(risers-1)*going;
  const layout={valid:true,kind:'straight',riseFt:rise,risers,riserFt:rise/risers,treadFt:going,flightWidthFt:3.5,
    flights:[{rect:{x:0,y:0,w:3.5,h:run},from:{x:1.75,y:run},to:{x:1.75,y:0},fromZFt:0,toZFt:rise,risers}],landings:[]};
  assert.equal(validateFittedLayout(layout).valid,true);
  layout.riseFt+=1/TICKS_PER_FOOT;layout.riserFt=layout.riseFt/risers;layout.flights[0].toZFt=layout.riseFt;
  assert.ok(validateFittedLayout(layout).errors.some(e=>e.includes('maximum rise between landings')));
});

test('a physically fitted long stair is not rejected by template maximum core size',()=>{
  const core={x:0,y:0,w:9,h:20},layout=fitStairLayout({core,lowerHall:{x:0,y:20,w:9,h:6},upperHall:{x:0,y:-6,w:9,h:6},riseFt:12});
  assert.equal(layout.valid,true);
  assert.deepEqual(validateStairGeometry({levels:[{level:1,rooms:[{...core,id:'s',type:'stairs'}],stairCore:{roomId:'s',layout}}]}),[]);
});

test('migration refits old geometry, is idempotent and cannot carry structural approval',()=>{
  const source=oldPlan();source.stairAssemblies=[{structure:{status:'verified'},geometryHash:'old'}];
  const original=structuredClone(source), migrated=migratePlanStairs(source);
  assert.deepEqual(source,original);
  assert.equal(migrated.stairAssemblies.length,1);
  const assembly=migrated.stairAssemblies[0];
  assert.equal(assembly.validation.status,'incomplete');assert.equal(assembly.structure.status,'unverified');
  assert.ok(assembly.flights.length>0);assert.ok(assembly.validation.unverifiedInputs.includes('headroom_sweep'));
  for(const flight of assembly.flights) assert.equal(flight.slope,
    rationalFeet(flight.riser)/rationalFeet(flight.going),'pitch follows consecutive nosings, not landing-to-landing rise');
  assert.equal(validateStairAssembly(assembly).valid,true);
  assert.deepEqual(migratePlanStairs(migrated),migrated);
  migrated.levels[0].verticalProfile.floorZFt-=1;
  assert.notEqual(migratePlanStairs(migrated).stairAssemblies[0].geometryHash,assembly.geometryHash);
});

test('basement/main/upper connections retain distinct assemblies and two middle-level references',()=>{
  const migrated=migratePlanStairs(oldPlan([-1,1,2]));
  assert.equal(migrated.stairAssemblies.length,2);
  assert.equal(migrated.levels[1].stairAssemblyIds.length,2);
  const [below,above]=migrated.stairAssemblies;
  assert.equal(below.toLevelId,above.fromLevelId);
  assert.equal(below.elevations.lowerFinishedFloorZFt,-10);
  assert.equal(above.elevations.lowerFinishedFloorZFt,0);
  assert.notEqual(below.id,above.id);assert.notEqual(below.geometryHash,above.geometryHash);
});

test('strict assembly schema rejects numeric strings, nonfinite numbers and invented ready status',()=>{
  const assembly=migratePlanStairs(oldPlan()).stairAssemblies[0];
  for(const change of [
    a=>{a.flights[0].nominalWidthFt='3';},a=>{a.flights[0].from.x=NaN;},
    a=>{a.validation.status='verified';},a=>{a.structure.status='verified';},
    a=>{a.validation.unverifiedInputs=[];},a=>{a.codeProfileId='unknown';},a=>{a.extra=true;},
  ]) {const bad=structuredClone(assembly);change(bad);assert.equal(validateStairAssembly(bad).valid,false);}
});

test('unknown datums and unfittable geometry remain explicit and serialize without NaN',()=>{
  const plan=oldPlan();plan.levels.forEach(l=>delete l.verticalProfile);
  const missing=migratePlanStairs(plan).stairAssemblies[0];
  assert.equal(missing.elevations.source,'missing');assert.deepEqual(missing.flights,[]);
  assert.ok(missing.validation.findings.some(f=>f.code==='STAIR_ELEVATIONS_MISSING'));
  plan.levels[0].rooms[0].w=1;
  const bad=migratePlanStairs(plan).stairAssemblies[0];
  assert.equal(bad.validation.status,'invalid');
  assert.equal(validateStairAssembly(JSON.parse(JSON.stringify(bad))).valid,true);
});

test('schema validation retains stair assembly fields instead of stripping them away',()=>{
  const migrated=migratePlanStairs(oldPlan());
  assert.equal(validatePlanSpecSchema(stripPlanSpecForValidation(migrated)).valid,true);
  const nonfinite=structuredClone(migrated);
  nonfinite.stairAssemblies[0].flights[0].from.x=Infinity;
  assert.equal(validatePlanSpecSchema(stripPlanSpecForValidation(nonfinite)).valid,false);
  migrated.stairAssemblies[0].flights[0].risers='16';
  assert.equal(validatePlanSpecSchema(stripPlanSpecForValidation(migrated)).valid,false);
});

test('plan-level stair validation rejects stale geometry, altered step data and missing references',()=>{
  const migrated=migratePlanStairs(oldPlan());
  assert.deepEqual(validatePlanStairAssemblies(migrated),[]);
  const reordered=structuredClone(migrated);
  reordered.stairAssemblies[0]=Object.fromEntries(Object.entries(reordered.stairAssemblies[0]).reverse());
  assert.deepEqual(validatePlanStairAssemblies(reordered),[],'JSON object key order is not a geometry edit');
  for(const change of [
    p=>{p.levels[0].rooms[0].w+=1;},p=>{p.stairAssemblies[0].flights[0].riser.numeratorTicks+=1;},
    p=>{p.levels[0].stairAssemblyIds=[];},p=>{p.stairAssemblies.push(structuredClone(p.stairAssemblies[0]));},
    p=>{p.stairAssemblies=[];},
  ]) {const bad=structuredClone(migrated);change(bad);assert.ok(validatePlanStairAssemblies(bad).length);}
  assert.deepEqual(validatePlanStairAssemblies(oldPlan()),[],'unmigrated concept plans keep their existing validation path');
});
