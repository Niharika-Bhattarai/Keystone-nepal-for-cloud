'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');const path=require('node:path');
const {localEnv,ROOT}=require('./local-env.cjs');
test('environment cannot inherit live credentials or node preloads',()=>{
 const env=localEnv({PATH:process.env.PATH,STRIPE_SECRET_KEY:'test',GOOGLE_APPLICATION_CREDENTIALS:'test',NODE_OPTIONS:'--require live',VITE_FIREBASE_API_KEY:'test',KEYSTONE_RUNTIME:'preview'});
 assert.equal(env.STRIPE_SECRET_KEY,undefined);assert.equal(env.GOOGLE_APPLICATION_CREDENTIALS,undefined);
 assert.equal(env.NODE_OPTIONS,undefined);assert.equal(env.VITE_FIREBASE_API_KEY,undefined);
 assert.equal(env.KEYSTONE_RUNTIME,'local');assert.equal(env.PORT,'8299');assert.equal(env.NEPAL_LOCAL_STUDIO,'1');
});
test('backend boundary blocks remote TCP before sending',()=>{
 const code=`require(${JSON.stringify(path.join(ROOT,'tools/backend-boundary.cjs'))});try{require('net').connect({host:'example.com',port:443});process.exit(2)}catch(e){if(!e.message.includes('outbound'))throw e;}`;
 const r=spawnSync(process.execPath,['-e',code],{env:localEnv(),encoding:'utf8'});assert.equal(r.status,0,r.stderr);
});
test('cloud startup refused',()=>{
 const r=spawnSync(process.execPath,['-e',`require(${JSON.stringify(path.join(ROOT,'tools/backend-boundary.cjs'))})`],{env:{...localEnv(),K_SERVICE:'test-cloud'},encoding:'utf8'});
 assert.notEqual(r.status,0);assert.match(r.stderr,/local-only/);
});
test('no shared dependency link',()=>{
 const fs=require('node:fs');for(const n of ['backend-keystone','frontend-keystone'])assert.equal(fs.lstatSync(path.join(ROOT,n,'node_modules')).isSymbolicLink(),false);
});
