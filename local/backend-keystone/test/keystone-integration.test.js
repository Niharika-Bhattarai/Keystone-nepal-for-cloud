'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createApp } = require('../app');
const { configureKeystoneRuntime } = require('../lib/keystoneRuntime');
const { setVerifier } = require('../lib/accounts/auth');
const { MemoryStore, setStore } = require('../lib/accounts/store');
const { projectPlanResponse } = require('../lib/accounts/planResponse');
const { clientKey } = require('../lib/rateLimit');
const fixture = require('./fixtures/bedroom-approach-repair/matrix-West-standard-1-option-3-level-2-input.json');

test('runtime cannot connect this conversion to live services', () => {
  const env = { KEYSTONE_RUNTIME: 'local' };
  assert.deepEqual(configureKeystoneRuntime(env), { host:'127.0.0.1',port:8198 });
  assert.equal(env.ACCOUNTS_STORE,'memory');
  for (const override of [{KEYSTONE_RUNTIME:'preview'},{K_SERVICE:'cloud'},{NODE_ENV:'production'},
    {GCS_BUCKET_NAME:'live'},{STRIPE_SECRET_KEY:'synthetic'},{FIREBASE_PROJECT_ID:'live'},{GOOGLE_API_KEY:'synthetic'}]) {
    assert.throws(() => configureKeystoneRuntime({KEYSTONE_RUNTIME:'local',...override}));
  }
});

test('projection retains original plan and strips every nested elevation output', () => {
  const source={planSpec:{elevations:{frontSvg:'private',meta:{roof:'hip'}}},alternatives:[{planSpec:{elevations:{frontSvg:'private'}}}],optionSequence:[{elevations:{rearSvg:'private'}}],svg:'public'};
  const before=structuredClone(source),result=projectPlanResponse(source);
  assert.deepEqual(source,before);assert.ok(!JSON.stringify(result).includes('private'));
  assert.equal(result.svg,'public');assert.equal(result.planSpec.elevations.meta.roof,'hip');
});

test('client-provided forwarded IP cannot change rate-limit identity', () => {
  const req={headers:{'x-forwarded-for':'spoof'},ip:'127.0.0.1'};
  assert.equal(clientKey(req),'127.0.0.1');req.user={uid:'account'};
  assert.equal(clientKey(req),'user:account');
});

test('combined application enforces tiers on real presentation/3D and closes unfinished job routes', async t => {
  const store=new MemoryStore();setStore(store);
  setVerifier(async token => { if (!['free','pro'].includes(token)) throw new Error('bad token'); return {uid:token,email:`${token}@example.test`}; });
  await store.ensureUser('pro');await store.updateUser('pro',{devAccess:{grantedAt:'test'}});
  const app=createApp({handlers:{plan:(req,res)=>res.json({success:true,svg:'plan',planSpec:{elevations:{frontSvg:'paid'}},alternatives:[{elevations:{rearSvg:'paid'}}]})}});
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url=`http://127.0.0.1:${server.address().port}`;
  async function call(route,token,body={}) {
    return fetch(url+route,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
  }
  for(const token of [null,'free','pro']) {
    const generation=await (await call('/api/plan',token)).json();
    assert.equal(JSON.stringify(generation).includes('paid'),token==='pro');
    const presentation=await call('/api/plan/presentation',token,{planSpec:fixture.plan,surveyData:fixture.survey});
    assert.equal(presentation.status,200);
    const body=await presentation.json();assert.match(body.svg,/<svg/);
    assert.equal(Boolean(body.elevations?.frontSvg),token==='pro');
    assert.equal(body.elevationsLocked,token==='pro'?undefined:true);
    const model=await call('/api/plan/model',token,{planSpec:fixture.plan});
    assert.equal(model.status,token?200:401);
    if(token)assert.match(model.headers.get('content-type'),/gltf/);
    const expected=token==='pro'?503:token?402:401;
    assert.equal((await call('/api/plan/model/hq',token,{planSpec:fixture.plan})).status,expected);
    assert.equal((await fetch(url+'/api/plan/model/hq/any/files/input.json',{headers:token?{Authorization:`Bearer ${token}`}:{}})).status,expected);
  }
  assert.equal((await call('/api/plan/model','invalid',{planSpec:fixture.plan})).status,401);
  assert.equal((await call('/api/stripe/webhook',null)).status,503);
  assert.equal((await call('/api/billing/checkout','pro')).status,503);
  assert.equal((await call('/api/verify')).status,410);
  const health=await fetch(url+'/api/health');
  assert.match(health.headers.get('content-security-policy'),/wasm-unsafe-eval/);
  assert.equal((await health.json()).automaticRepair,'off');
  assert.equal((await fetch(url+'/api/gallery')).status,404);
});

test('preview app: each visitor is rate-limited on their own address, behind Cloud Run and behind Vercel', () => {
  const app = createApp({ runtimeMode: 'preview' });
  assert.equal(app.get('trust proxy'), 1, 'exactly one proxy (the Cloud Run front end) is trusted');
  const req = (headers, ip) => ({ app, ip, get: (h) => headers[h.toLowerCase()] });
  assert.equal(clientKey(req({}, '198.51.100.7')), '198.51.100.7');
  assert.equal(clientKey(req({ 'x-vercel-forwarded-for': '203.0.113.5, 10.0.0.1' }, '76.76.21.1')), 'edge:203.0.113.5');
  assert.equal(clientKey(req({ 'x-vercel-forwarded-for': 'x'.repeat(65) }, '76.76.21.1')), '76.76.21.1', 'an oversized header is ignored');
  // The local app trusts no proxy and no edge header.
  const local = createApp();
  assert.equal(local.get('trust proxy'), false);
  assert.equal(clientKey({ app: local, ip: '127.0.0.1', get: () => '203.0.113.5' }), '127.0.0.1');
});
