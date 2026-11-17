import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module,{createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import {phrase,locales} from '../i18n.mjs';
const require=createRequire(import.meta.url),swc=require('next/dist/build/swc');await swc.loadBindings();
let Signup;const previous=Module._extensions['.jsx'];
try{
 Module._extensions['.jsx']=(module,filename)=>{const result=swc.transformSync(fs.readFileSync(filename,'utf8'),{filename,jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}},target:'es2022'},module:{type:'commonjs'}});module._compile(result.code,filename);};
 Signup=require(fileURLToPath(new URL('../app/signup/page.jsx',import.meta.url))).default;
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
   await act(async()=>{w.document.getElementById('signup-terms').click();});assert.equal(w.document.getElementById('signup-terms').checked,true);
  }
 }finally{await act(async()=>root.unmount());dom.window.close();for(const name of names){const d=old.get(name);if(d)Object.defineProperty(globalThis,name,d);else delete globalThis[name];}}
});
