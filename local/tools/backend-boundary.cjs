'use strict';
// Loaded before cloud-capable modules. Ordinary TCP/TLS/fetch stays on loopback.
const {localEnv}=require('./local-env.cjs');
if(process.env.K_SERVICE||process.env.VERCEL||process.env.CLOUD_RUN_JOB||process.env.KEYSTONE_RUNTIME==='preview')throw new Error('Nepal copy is local-only; cloud runtime refused.');
const clean=localEnv();
for(const key of Object.keys(process.env))delete process.env[key];
Object.assign(process.env,clean);
const net=require('node:net');
const original=net.Socket.prototype.connect;
const LOOPBACK=new Set(['127.0.0.1','localhost','::1']);
net.Socket.prototype.connect=function(...args){
 const first=args[0];
 const options=Array.isArray(first)?first[0]:typeof first==='object'?first:null;
 const host=options?options.host:(typeof args[1]==='string'?args[1]:undefined);
 if(options?.path || typeof first==='string' && !/^\d+$/.test(first))throw new Error('Nepal runtime refuses outbound IPC connections');
 if(host&&!LOOPBACK.has(String(host)))throw new Error('Nepal runtime refuses outbound network connections');
 return original.apply(this,args);
};
