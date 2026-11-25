import test from 'node:test';import assert from 'node:assert/strict';
import {JSDOM,VirtualConsole} from 'jsdom';import {setTimeout as delay} from 'node:timers/promises';
import {copy} from '../copy.mjs';import {phrase,locales} from '../i18n.mjs';
const base=process.env.MEDICAL_TEST_BASE_URL;
test('running multilingual app changes all five locales, preserves draft, and localizes account dialog',{skip:!base,timeout:45000},async()=>{
 const errors=[],virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',e=>{if(!/Not implemented/.test(e.message))errors.push(e.message);});
 const dom=await JSDOM.fromURL(base,{resources:'usable',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole,beforeParse(w){
  const descriptor=Object.getOwnPropertyDescriptor(w.Document.prototype,'currentScript');Object.defineProperty(w.document,'currentScript',{get(){return descriptor.get.call(this)||this.querySelector('script[src]');}});
  for(const method of ['mark','measure','clearMarks','clearMeasures'])if(!w.performance[method])w.performance[method]=()=>{};
  w.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
  w.fetch=(url,options)=>{const path=new URL(url,base).pathname;if(path==='/api/config')return Promise.resolve(Response.json({map:{configured:false},publicData:{configured:false},routing:{configured:false}}));if(path==='/api/auth/session')return Promise.resolve(Response.json({authenticated:false}));return fetch(new URL(url,base),options);};
  w.confirm=()=>true;w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}});
  Object.assign(w,{TextEncoder,TextDecoder,ReadableStream,WritableStream,TransformStream,TextEncoderStream,TextDecoderStream,Request,Response,Headers});
 }});
 const w=dom.window,d=w.document,wait=async check=>{for(let i=0;i<200;i++){if(check())return;await delay(50);}assert.ok(check(),errors.join('\n')||'UI did not become ready');};
 try{
  await wait(()=>d.getElementById('language-select'));assert.equal(d.querySelectorAll('#language-select option').length,5);
  const draft='원문 유지 QA text';d.getElementById('composer-input').value=draft;
  for(const locale of ['en','zh','vi','uz','ko']){
   const select=d.getElementById('language-select');select.value=locale;select.dispatchEvent(new w.Event('change',{bubbles:true}));
   await wait(()=>d.documentElement.lang===locale);
   assert.equal(d.getElementById('conversation-title').textContent,copy[locale].conversationTitle);
   assert.equal(d.getElementById('composer-input').value,draft);assert.equal(w.localStorage.getItem('medical-language'),locale);
   d.querySelector('.header-profile').click();await wait(()=>d.getElementById('account-open'));
   d.getElementById('account-open').click();await wait(()=>d.getElementById('account-dialog')?.open);
   const dialog=d.getElementById('account-dialog');assert.equal(d.getElementById('account-heading').textContent,phrase(locale,'Log in / Sign up'));
   if(['zh','vi','uz'].includes(locale))assert.doesNotMatch(dialog.textContent,/[가-힣]/);
   d.getElementById('account-close').click();d.getElementById('workspace-close').click();
  }
  assert.deepEqual(errors,[]);
 }finally{dom.window.close();}
});
