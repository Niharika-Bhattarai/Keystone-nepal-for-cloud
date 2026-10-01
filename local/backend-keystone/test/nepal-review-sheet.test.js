'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normalizeBrief}=require('../lib/nepal/normalizeBrief');
const {deriveConceptAssumptions}=require('../lib/nepal/workingAssumptions');
const {buildReviewCase,renderReviewDocument}=require('../lib/nepal/reviewSheet');
const {searchConcepts}=require('../lib/nepal/candidateSearch');
const fixture=require('./fixtures/nepal/rental-3_5.json');
test('working assumptions enable local review without claiming an adopted municipal profile',()=>{
  const brief=normalizeBrief(fixture).brief;
  const assumptions=deriveConceptAssumptions(brief);
  assert.deepEqual(assumptions.setbacksMm,[1000,1000,1000,1000]);
  assert.equal(assumptions.coverageLimit,0.7);
  const review=buildReviewCase('3.5 rental home',brief);
  assert.equal(review.result.candidates.length,3);
  assert.ok(review.result.candidates.every(c=>c.ledger.groundCoverageRatio<0.7));
  assert.ok(review.result.candidates.every(c=>c.rulePack.permitRulesReady===false));
  const html=renderReviewDocument([review]);
  assert.match(html,/FLOOR PAD/);assert.match(html,/Sum of floor envelopes/);
  assert.match(html,/MAIN ENTRY/);
  assert.match(html,/data-door-symbol="provisional-swing"/);
  assert.match(html,/clearance unverified/);
  assert.match(html,/not permit or construction drawings/);
});
test('a buildable area beyond the working coverage cap is reduced to fit it and user text is escaped in review HTML',()=>{
  const brief=normalizeBrief(fixture).brief;
  // Zero setbacks would cover 100 % of the plot: the footprint gives up rear depth instead of failing.
  const fitted=searchConcepts(brief,{provisionalSetbacksMm:[0,0,0,0],workingCoverageLimit:0.7});
  assert.ok(fitted.candidates.length>0);
  for(const c of fitted.candidates){
    assert.ok(c.ledger.groundCoverageRatio<=0.7+1e-9);
    assert.match(c.envelope.coverageFit.note,/70 % working coverage cap/);
    assert.equal(c.envelope.buildable.y1,c.envelope.site.y1);// road (bottom) side kept
    assert.ok(c.envelope.buildable.x2-c.envelope.buildable.x1<11250);
  }
  const copy=structuredClone(brief);
  copy.site.north.evidence='<img src=x onerror=alert(1)>';
  const html=renderReviewDocument([buildReviewCase('review',copy)]);
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
});
