import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module,{createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import {phrase,locales} from '../i18n.mjs';
import {emptyProfile} from '../profile.mjs';
const require=createRequire(import.meta.url),swc=require('next/dist/build/swc');await swc.loadBindings();
let Signup,Profile;const previous=Module._extensions['.jsx'];
try{
 Module._extensions['.jsx']=(module,filename)=>{const result=swc.transformSync(fs.readFileSync(filename,'utf8'),{filename,jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}},target:'es2022'},module:{type:'commonjs'}});module._compile(result.code,filename);};
 Signup=require(fileURLToPath(new URL('../app/signup/page.jsx',import.meta.url))).default;
 Profile=require(fileURLToPath(new URL('../components/profile.jsx',import.meta.url))).Profile;
}finally{if(previous)Module._extensions['.jsx']=previous;else delete Module._extensions['.jsx'];}
test('signup modal can change all five consent languages, resets choices and persists the selected language',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost:3080/signup'}),w=dom.window;
 const names=['window','document','localStorage','fetch','IS_REACT_ACT_ENVIRONMENT'],old=new Map(names.map(n=>[n,Object.getOwnPropertyDescriptor(globalThis,n)]));
 Object.assign(globalThis,{window:w,document:w.document,localStorage:w.localStorage,fetch:async()=>Response.json({pending:true}),IS_REACT_ACT_ENVIRONMENT:true});
 const root=createRoot(w.document.getElementById('root'));
 try{
  await act(async()=>{root.render(React.createElement(Signup));});
  for(const locale of locales){
   const before=w.document.getElementById('signup-language');assert.ok(before);assert.ok(w.document.getElementById('account-dialog').contains(before));assert.equal(before.options.length,5);
   await act(async()=>{before.value=locale;before.dispatchEvent(new w.Event('change',{bubbles:true}));});
   const language=w.document.getElementById('signup-language');assert.equal(language.value,locale);assert.equal(w.localStorage.getItem('medical-language'),locale);
   assert.equal(w.document.querySelector('#account-dialog .signup-intro').textContent,phrase(locale,'Kakao authentication is verified. Review the terms and consent items below.'));
   assert.equal(w.document.getElementById('signup-terms').checked,false);
   const all=w.document.getElementById('signup-all');
   await act(async()=>all.click());
   assert.equal(all.checked,true);
   assert.equal(w.document.getElementById('signup-healthStorage').checked,true);
   assert.equal(w.document.getElementById('signup-continue').disabled,false);
   await act(async()=>w.document.getElementById('signup-healthProcessing').click());
   assert.equal(all.checked,false);
   assert.equal(w.document.getElementById('signup-healthStorage').checked,false);
   assert.equal(w.document.getElementById('signup-continue').disabled,false);
   await act(async()=>all.click());
   await act(async()=>all.click());
   assert.equal(w.document.getElementById('signup-continue').disabled,true);
   await act(async()=>{w.document.getElementById('signup-terms').click();});assert.equal(w.document.getElementById('signup-terms').checked,true);
  }
 }finally{await act(async()=>root.unmount());dom.window.close();for(const name of names){const d=old.get(name);if(d)Object.defineProperty(globalThis,name,d);else delete globalThis[name];}}
});

test('the health form updates its character count without changing saved health details',async()=>{
 const dom=new JSDOM('<div id="root"></div>'),w=dom.window;
 const old=new Map(['window','document','IS_REACT_ACT_ENVIRONMENT'].map(n=>[n,Object.getOwnPropertyDescriptor(globalThis,n)]));
 Object.assign(globalThis,{window:w,document:w.document,IS_REACT_ACT_ENVIRONMENT:true});
 const root=createRoot(w.document.getElementById('root'));
 const profile={...emptyProfile(),sex:'female'};
 const state={locale:'ko',profile,profileDraft:{...profile},healthConsent:{pending:''}};
 const edit=async(id,value)=>act(async()=>{const el=w.document.getElementById(id);el.value=value;el.dispatchEvent(new w.Event('input',{bubbles:true}));});
 try{
  await act(async()=>root.render(React.createElement(Profile,{state,t:key=>key})));
  const notes=w.document.getElementById('profile-allergies'),count=w.document.getElementById('profile-count-allergies');
  assert.equal(notes.maxLength,500);
  await edit('profile-allergies','가');assert.equal(count.textContent,'1 / 500');
  await edit('profile-allergies','가나');assert.equal(count.textContent,'2 / 500');
  await edit('profile-sex','male');assert.equal(state.profileDraft.sex,'male');
  assert.match(w.document.querySelector('.health-print-sheet').textContent,/여성/);
  assert.doesNotMatch(w.document.querySelector('.health-print-sheet').textContent,/남성|가나/);
 }finally{await act(async()=>root.unmount());w.close();for(const [name,value] of old)if(value)Object.defineProperty(globalThis,name,value);else delete globalThis[name];}
});
