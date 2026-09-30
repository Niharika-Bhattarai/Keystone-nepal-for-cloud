'use strict';
const {spawn}=require('node:child_process');
const path=require('node:path');
const {ROOT,localEnv}=require('./local-env.cjs');
const task=process.argv[2]||'dev';
const children=[];
const env=localEnv();
if(task==='test') env.NEPAL_LOCAL_STUDIO='0'; // inherited account tests retain their original anonymous semantics
function start(file,args,cwd) {
  const child=spawn(process.execPath,[file,...args],{cwd,env,stdio:'inherit',windowsHide:true});
  children.push(child);
  child.on('error',err=>{console.error(err.message);stop(1);});
  return child;
}
function stop(code=0){for(const child of children)if(!child.killed)child.kill();process.exitCode=code;}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
const backend=path.join(ROOT,'backend-keystone');
const frontend=path.join(ROOT,'frontend-keystone');
const vite=path.join(frontend,'node_modules','vite','bin','vite.js');
if(!['dev','backend','frontend','build','test'].includes(task))throw new Error('Use dev, backend, frontend, build or test');
if(task==='test'){
 const c=spawn(process.execPath,['--test','test/*.test.js'],{cwd:backend,env,stdio:'inherit',windowsHide:true});
 c.on('exit',code=>process.exitCode=code);children.push(c);
}else{
 if(['dev','backend'].includes(task)){
  const b=start(path.join(backend,'server.js'),[],backend);
  b.on('exit',code=>{if(task==='dev')stop(code||0);else process.exitCode=code;});
 }
 if(['dev','frontend','build'].includes(task)){
  const pre=start(path.join(frontend,'scripts','prebuild.mjs'),[],frontend);
  pre.on('exit',code=>{
   if(code){stop(code);return;}
   const ui=start(vite,task==='build'?['build']:[],frontend);
   ui.on('exit',code=>{if(task==='dev')stop(code||0);else process.exitCode=code;});
  });
 }
}
