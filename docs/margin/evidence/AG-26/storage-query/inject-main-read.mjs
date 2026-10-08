// Diagnostic evidence only: uses private Playwright 1.60.0 APIs. Not a runtime or gate dependency.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../../../../package.json',import.meta.url));
const {_electron}=require('playwright');
const originalLaunch=_electron.launch.bind(_electron),mode=new URL(import.meta.url).searchParams.get('mode')??'once';
const out=fs.mkdtempSync(path.join(os.tmpdir(),'margin-storage-query-injection-')),records=[];
console.log(`[storage-query-diagnostic] output: ${out}`);
const save=()=>fs.writeFileSync(path.join(out,`injection-${mode}.json`),JSON.stringify(records,null,2)+'\n');
_electron.launch=async (...args)=>{
 const app=await originalLaunch(...args),impl=app._connection.toImpl(app),session=impl._nodeSession,originalSend=session.send;
 const row={mode,pid:app.process().pid,reads:0,injected:0};records.push(row);save();
 session.send=function(...args){
  const [method,params]=args;
  const expression=(params?.arguments??[]).map(a=>typeof a.value==='string'?a.value:'').join('\n');
  const isUserDataRead=method==='Runtime.callFunctionOn'&&/getPath\(['"]userData['"]\)/.test(expression);
  if(!isUserDataRead)return originalSend.apply(this,args);
  row.reads++;save();
  if(mode==='once'&&row.injected>0)return originalSend.apply(this,args);
  if(mode==='none')return originalSend.apply(this,args);
  row.injected++;save();
  if(mode==='other')return Promise.resolve({result:{type:'undefined'},exceptionDetails:{text:'Uncaught',exception:{type:'object',subtype:'error',className:'Error',description:'Error: DIAGNOSTIC_NON_CONTEXT_FAILURE'}}});
  if(mode==='dead')return new Promise((resolve,reject)=>{app.process().once('exit',(code,signal)=>{row.exit={code,signal};save();reject(new Error('Protocol error (Runtime.callFunctionOn): Promise was collected'));});app.process().kill('SIGTERM');});
  return Promise.reject(new Error('Protocol error (Runtime.callFunctionOn): Promise was collected'));
 };
 app.process().once('exit',(code,signal)=>{row.exit={code,signal};save();});
 return app;
};
