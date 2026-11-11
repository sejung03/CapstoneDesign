import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module,{createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
const require=createRequire(import.meta.url),swc=require('next/dist/build/swc');await swc.loadBindings();
const filename=fileURLToPath(new URL('../components/account-dialog.jsx',import.meta.url));
const compiled=swc.transformSync(fs.readFileSync(filename,'utf8'),{filename,jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}},target:'es2022'},module:{type:'commonjs'}});
const componentModule=new Module(filename);componentModule.filename=filename;componentModule.paths=Module._nodeModulePaths(path.dirname(filename));componentModule._compile(compiled.code,filename);
const {AccountDialog}=componentModule.exports;
test('account continuation separates signup consent from existing login and never submits unchecked required consent',async()=>{
 const dom=new JSDOM('<!doctype html><button id="account-open"></button><div id="root"></div>',{url:'http://localhost'}),w=dom.window;
 const previous={window:globalThis.window,document:globalThis.document,act:globalThis.IS_REACT_ACT_ENVIRONMENT};
 globalThis.window=w;globalThis.document=w.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const {createRoot}=await import('react-dom/client'),root=createRoot(w.document.getElementById('root')),calls=[];
 const render=props=>root.render(React.createElement(AccountDialog,{locale:'ko',onDismiss(){},onContinue:payload=>calls.push(payload),...props}));
 const el=id=>w.document.getElementById(id),submit=()=>el('signup-consent-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
 try{
  await act(async()=>render({}));assert.equal(el('signup-continue').disabled,true);await act(async()=>submit());assert.equal(calls.length,0);
  await act(async()=>el('signup-terms').click());await act(async()=>el('signup-account').click());assert.equal(el('signup-continue').disabled,false);
  await act(async()=>submit());assert.equal(calls.length,1);assert.equal(calls[0].intent,'signup');assert.ok(calls[0].consentSelection);assert.equal(el('signup-selection-result'),null);assert.equal(w.localStorage.length,0);
  await act(async()=>render({needsSignupConsent:false}));assert.equal(el('signup-terms'),null);assert.equal(el('signup-continue').disabled,false);
  await act(async()=>submit());assert.deepEqual(calls.at(-1),{intent:'login',consentSelection:null});
  await act(async()=>render({needsSignupConsent:false,onContinue:undefined}));assert.equal(el('signup-continue').disabled,true);await act(async()=>submit());assert.equal(calls.length,2);
 }finally{
  await act(async()=>root.unmount());dom.window.close();globalThis.window=previous.window;globalThis.document=previous.document;globalThis.IS_REACT_ACT_ENVIRONMENT=previous.act;
 }
});
