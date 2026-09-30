'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {buildSurveyFulfillment}=require('../lib/surveyFulfillment');
const {surveyCapabilityGaps}=require('../lib/surveyCapabilities');
const {preflightSurvey}=require('../lib/surveyPreflight');
const {classifyGenerationResult}=require('../lib/generationDiagnostics');
const {base}=require('../scripts/benchmark/generation-coverage');
const {invoke}=require('../scripts/benchmark/survey-delivery-audit');
const {validateEditedPlan}=require('../lib/validateEditedPlan');

test('every submitted field gets explicit evidence or an unresolved status',()=>{
  const survey={bedrooms:'2 Bed',bathrooms:'1 Bath',features:'1 Gym',location:'Somewhere',surpriseOption:'Roof garden',naturalLight:'Maximum glazing'};
  const plan={levels:[{level:1,rooms:[{id:'primary',type:'primary_bedroom',x:0,y:0,w:10,h:10},{id:'bath',type:'bathroom',x:10,y:0,w:5,h:10}]}]};
  const report=buildSurveyFulfillment(plan,survey);
  assert.deepEqual(report.items.map(i=>i.field),Object.keys(survey));
  assert.equal(report.items.find(i=>i.field==='bedrooms').status,'conflict');
  const bathroom=report.items.find(i=>i.field==='bathrooms');
  assert.equal(bathroom.status,'satisfied');assert.equal(bathroom.resolved,1);assert.deepEqual(bathroom.evidenceRefs,['level:1/room:bath']);
  assert.equal(report.items.find(i=>i.field==='features').status,'conflict');
  for(const field of ['location','surpriseOption','naturalLight']) assert.equal(report.items.find(i=>i.field===field).status,'not_implemented');
  assert.equal(report.summary.complete,false);
  assert.deepEqual(report.summary.hardConflicts,['bedrooms','features']);
});

test('copied selections and a forged old ledger do not establish fulfillment',()=>{
  const survey={foundationType:'Full basement',accessibilityNeeds:'Wheelchair accessible',ceilingHeight:'Cathedral / Vaulted'};
  const plan={levels:[],designSurvey:survey,surveyFulfillment:{summary:{complete:true}}};
  const report=buildSurveyFulfillment(plan,survey);
  assert.ok(report.items.every(i=>i.status==='not_implemented'&&!i.evidenceRefs.length));
  assert.equal(report.summary.complete,false);
  assert.equal(surveyCapabilityGaps(survey).length,3);
});

test('wide nominal doors remain an incomplete finished-clearance claim',()=>{
  const plan={levels:[{level:1,rooms:[],doors:[{a:'a',b:'b',x:4,y:0,width:4}]}]};
  const report=buildSurveyFulfillment(plan,{accessibilityNeeds:'Wide doorways'});
  assert.equal(report.items[0].status,'needs_project_input');
  assert.deepEqual(report.items[0].resolved.nominalWidthsFt,[4]);
  plan.levels[0].doors[0].width=3;
  assert.equal(buildSurveyFulfillment(plan,{accessibilityNeeds:'Wide doorways'}).items[0].status,'conflict');
});

test('preflight and generation refuse known missing capabilities even with legacy enabled',async()=>{
  const previous=process.env.V2_DISABLE_LEGACY_FALLBACK;
  process.env.V2_DISABLE_LEGACY_FALLBACK='false';
  try {
    for(const patch of [{foundationType:'Full basement'},{accessibilityNeeds:'Wheelchair accessible'},{ceilingHeight:'Cathedral / Vaulted'},
      {foundationType:'Full basement',accessibilityNeeds:'Wheelchair accessible',ceilingHeight:'Cathedral / Vaulted'}]) {
      const survey={...base,...patch},preflight=preflightSurvey(survey);
      assert.equal(preflight.supported,false);assert.equal(preflight.code,'CAPABILITY_NOT_IMPLEMENTED');
      const {status,body}=await invoke(survey);
      assert.equal(status,422);assert.equal(body.code,preflight.code);assert.equal(body.complete,false);
      assert.equal(body.planSpec,undefined);assert.equal(body.diagnostics.triedCandidateCount,0);
      assert.deepEqual(body.diagnostics.blockers,preflight.blockers);
      assert.equal(classifyGenerationResult({status,body}),'implementation_gap');
    }
  } finally {if(previous===undefined)delete process.env.V2_DISABLE_LEGACY_FALLBACK;else process.env.V2_DISABLE_LEGACY_FALLBACK=previous;}
});

test('generation attaches per-field evidence to every alternative and preserves the survey',async()=>{
  const survey={...base};
  const {status,body}=await invoke(survey);
  assert.equal(status,200);
  const plans=[body.planSpec,...body.alternatives.map(a=>a.planSpec)];
  assert.ok(plans.length>=3);
  for(const plan of plans) {
    assert.deepEqual(plan.designSurvey,survey);
    assert.deepEqual(plan.surveyFulfillment.items.map(i=>i.field),Object.keys(survey));
    assert.equal(plan.surveyFulfillment.summary.complete,false,'unimplemented evaluators cannot become passes');
    assert.deepEqual(plan.surveyFulfillment.summary.hardConflicts,[]);
    assert.equal(plan.surveyFulfillment.items.find(i=>i.field==='bedrooms').resolved,3);
  }
  assert.deepEqual(body.fulfillmentSummary,body.planSpec.surveyFulfillment.summary);
  assert.ok(validateEditedPlan(body.planSpec,{...survey,foundationType:'Full basement'}).some(e=>e.includes('Survey capability (foundationType)')));
});

test('compatibility freeform operation outcome survives the new evidence ledger',()=>{
  const plan={levels:[],surveyFulfillment:{freeformWishes:{status:'not_applied',reason:'Unsupported instruction'}}};
  const report=buildSurveyFulfillment(plan,{freeformWishes:'Add a conservatory'});
  assert.deepEqual(report.freeformWishes,plan.surveyFulfillment.freeformWishes);
  assert.equal(report.items[0].status,'not_implemented');
});

test('legacy choice fallbacks and lot bounding boxes cannot certify missing semantics',()=>{
  const plan={levels:[{level:1,width:30,height:30,rooms:[],verticalProfile:{clearHeightFt:9}}]};
  assert.equal(buildSurveyFulfillment(plan,{ceilingHeight:'Unrecognized ceiling'}).items[0].status,'not_implemented');
  const lot=buildSurveyFulfillment(plan,{lotWidth:'40',lotDepth:'40'});
  assert.ok(lot.items.every(i=>i.status==='needs_project_input'));
  assert.equal(lot.summary.complete,false);
});
