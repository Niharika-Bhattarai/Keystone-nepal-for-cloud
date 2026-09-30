'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {areaSqM,measureAreaLedger,evaluateAreaLimits}=require('../lib/nepal/areaLedger');
const fs=require('node:fs');
const path=require('node:path');
const {resolveRulePack,catalogDrift}=require('../lib/nepal/rules/resolveRulePack');
const {normalizedTextSha256}=require('../lib/nepal/rules/buildCatalog');
const catalog=require('../lib/nepal/rules/catalog.json');
const box=(x1,y1,x2,y2)=>[x1,y1,x2,y2];
test('union counts an overlapping rectangle only once',()=>{
  assert.equal(areaSqM([box(0,0,10000,10000),box(5000,0,15000,10000)]),150);
  const ledger=measureAreaLedger({site:box(0,0,20000,20000),levels:[
    {categories:{habitable:[box(0,0,10000,10000),box(5000,0,15000,10000)]}}]});
  assert.equal(ledger.floors[0].grossSqM,150);
  assert.equal(ledger.floors[0].categoriesSqM.habitable,150);
});
test('rectangular court is excluded from gross and ground coverage',()=>{
  const l=measureAreaLedger({site:box(0,0,20000,20000),levels:[
    {id:'ground',categories:{habitable:[box(0,0,16000,16000)]},voids:[box(4000,4000,8000,8000)]},
    {id:'upper',categories:{habitable:[box(0,0,16000,16000)]},voids:[box(4000,4000,8000,8000)]}]});
  assert.equal(l.siteAreaSqM,400); assert.equal(l.groundCoverSqM,240);
  assert.equal(l.grossBuiltSqM,480); assert.equal(l.farChargeableSqM,null);
  assert.equal(l.groundCoverageRatio,0.6);
});
test('a roofed court counts as covered ground even though its floor slab is void',()=>{
  const l=measureAreaLedger({site:box(0,0,20000,20000),
    levels:[{id:'ground',categories:{habitable:[box(0,0,16000,16000)]},
      voids:[box(4000,4000,8000,8000)]}],
    coveredGround:[box(4000,4000,8000,8000)]});
  assert.equal(l.floors[0].grossSqM,240);
  assert.equal(l.groundCoverSqM,256);
});
test('partial L-shaped floor and covered parking stay in separate categories',()=>{
  const l=measureAreaLedger({site:box(0,0,20000,20000),levels:[
    {id:'ground',categories:{habitable:[box(0,0,10000,10000)],coveredParking:[box(10000,0,15000,10000)]}},
    {id:'upper',categories:{habitable:[box(0,0,10000,4000),box(0,4000,4000,10000)]}}]});
  assert.equal(l.floors[1].grossSqM,64); assert.equal(l.groundCoverSqM,150);
  assert.equal(l.farChargeableSqM,null);
});
test('area ledger refuses overlapping categories and out-of-site floors',()=>{
  assert.throws(()=>measureAreaLedger({site:box(0,0,10000,10000),levels:[
    {categories:{room:[box(0,0,5000,5000)],parking:[box(2000,2000,6000,6000)]}}]}),/overlap/);
  assert.throws(()=>measureAreaLedger({site:box(0,0,10000,10000),levels:[
    {categories:{room:[box(0,0,11000,5000)]}}]}),/outside site/);
});
test('Kathmandu overlay is explicit and unreviewed, other city has no inherited approval',()=>{
  const kmc=resolveRulePack({jurisdiction:{municipality:'Kathmandu Metropolitan City'}});
  assert.equal(kmc.profile.municipality,'Kathmandu Metropolitan City');
  assert.equal(kmc.permitRulesReady,false); assert.equal(kmc.blockers[0].code,'KMC_RULE_REVIEW_REQUIRED');
  const pokhara=resolveRulePack({jurisdiction:{municipality:'Pokhara Metropolitan City'}});
  assert.equal(pokhara.permitRulesReady,false); assert.equal(pokhara.blockers[0].code,'MUNICIPAL_OVERLAY_PENDING');
});
test('exact and over-limit boundaries use independent coverage and FAR values in a synthetic profile',()=>{
  const ledger=measureAreaLedger({site:box(0,0,10000,10000),
    levels:[{categories:{habitable:[box(0,0,5000,10000)]}},
      {categories:{habitable:[box(0,0,5000,10000)]}}],
    regulatory:{farTreatment:{habitable:1}}});
  const profile={parameters:{maximumCoverageRatio:0.5,maximumFAR:1}};
  assert.equal(evaluateAreaLimits(ledger,profile).status,'pass');
  assert.equal(evaluateAreaLimits(ledger,{parameters:{...profile.parameters,maximumCoverageRatio:0.49}}).status,'fail');
  assert.equal(evaluateAreaLimits(ledger,{parameters:{...profile.parameters,maximumFAR:0.99}}).status,'fail');
  assert.equal(evaluateAreaLimits(ledger,{parameters:{}}).status,'needs_review');
});
test('knowledge catalog pins ignore CRLF/LF checkout differences but not content changes',()=>{
  for(const [file,pin] of [['rules.json',catalog.knowledgeRulesSha256],['manifest.json',catalog.knowledgeManifestSha256]]) {
    const text=fs.readFileSync(path.join(__dirname,'../../../knowledge',file),'utf8').replace(/\r\n/g,'\n');
    assert.equal(normalizedTextSha256(Buffer.from(text)),pin);
    assert.equal(normalizedTextSha256(Buffer.from(text.replace(/\n/g,'\r\n'))),pin);
    assert.notEqual(normalizedTextSha256(Buffer.from(text.replace('"','" '))),pin);
  }
});
test('rule source drift names its cause; only absent originals may remain',()=>{
  const drift=catalogDrift();
  assert.deepEqual(drift.filter(item=>item.kind!=='original_missing'),[]);
  const blocker=resolveRulePack({jurisdiction:{municipality:'Kathmandu'}}).blockers.find(b=>b.code==='RULE_SOURCE_DRIFT');
  if(drift.length)assert.deepEqual(blocker.causes,['original_missing']); else assert.equal(blocker,undefined);
});
