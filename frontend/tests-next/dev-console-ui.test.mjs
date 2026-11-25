import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {JSDOM,VirtualConsole} from 'jsdom';
const root=fileURLToPath(new URL('../',import.meta.url));
test('development browser console can enter a mock account and exercise the real logout button', {timeout:75000},async()=>{
 const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 const base='http://127.0.0.1:'+port,child=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port',String(port)],{cwd:root,env:{...process.env,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1',KAKAO_JAVASCRIPT_KEY:'',KAKAO_REST_API_KEY:'',DATA_SERVICE_KEY:''},stdio:'ignore'});
 let dom;
 const wait=async condition=>{for(let i=0;i<250;i++){if(condition())return;await delay(60);}assert.ok(condition(),'Development UI did not become ready');};
 try{
  for(let i=0;i<150;i++){try{if((await fetch(base)).ok)break;}catch{}await delay(80);}
  dom=await JSDOM.fromURL(base,{resources:'usable',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:new VirtualConsole(),beforeParse(w){
   // jsdom does not retain currentScript across Turbopack's deferred module evaluation.
   const currentScript=Object.getOwnPropertyDescriptor(w.Document.prototype,'currentScript');
   Object.defineProperty(w.document,'currentScript',{get(){return currentScript.get.call(this)||this.querySelector('script[src]');}});
   for(const method of ['mark','measure','clearMarks','clearMeasures'])if(!w.performance[method])w.performance[method]=()=>{};
   w.fetch=(url,options)=>new URL(url,base).pathname==='/api/config'?Promise.resolve(Response.json({map:{configured:false},publicData:{configured:false},routing:{configured:false}})):fetch(new URL(url,base),options);
   w.confirm=()=>true;w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}});
   Object.assign(w,{TextEncoder,TextDecoder,ReadableStream,WritableStream,TransformStream,TextEncoderStream,TextDecoderStream,Request,Response,Headers});
  }});
  const w=dom.window,d=w.document;await wait(()=>typeof w.medicalDev?.login==='function');
  await w.medicalDev.login();d.querySelector('.header-profile').click();await wait(()=>d.getElementById('account-logout'));assert.equal(d.getElementById('account-open'),null);
  d.getElementById('account-logout').click();await wait(()=>d.getElementById('account-open'));assert.equal(d.getElementById('account-logout'),null);
  await w.medicalDev.login('second');await wait(()=>d.getElementById('account-logout'));assert.equal(d.getElementById('account-open'),null);
 }finally{dom?.window.close();if(child.exitCode===null){const ended=once(child,'exit');child.kill();await ended;}}
});
