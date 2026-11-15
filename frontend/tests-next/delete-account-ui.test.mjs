import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module,{createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
const require=createRequire(import.meta.url),swc=require('next/dist/build/swc');await swc.loadBindings();
const filename=fileURLToPath(new URL('../components/delete-account.jsx',import.meta.url));
const compiled=swc.transformSync(fs.readFileSync(filename,'utf8'),{filename,jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}},target:'es2022'},module:{type:'commonjs'}});
const componentModule=new Module(filename);componentModule.filename=filename;componentModule.paths=Module._nodeModulePaths(path.dirname(filename));componentModule._compile(compiled.code,filename);
const {DeleteAccount}=componentModule.exports;
test('deletion requires typed confirmation; cancel sends nothing and server failure keeps dialog open',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://app.test'}),w=dom.window;
 const previous={window:globalThis.window,document:globalThis.document,fetch:globalThis.fetch,act:globalThis.IS_REACT_ACT_ENVIRONMENT};
 globalThis.window=w;globalThis.document=w.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const calls=[];globalThis.fetch=async(url,options)=>{calls.push({url,options});return Response.json({error:'account_deletion_not_configured'},{status:503});};
 const {createRoot}=await import('react-dom/client'),root=createRoot(w.document.getElementById('root'));
 try{
  await act(async()=>root.render(React.createElement(DeleteAccount,{locale:'ko'})));
  await act(async()=>w.document.getElementById('account-delete-open').click());
  let dialog=w.document.querySelector('dialog');assert.equal(dialog.open,true);assert.equal(dialog.querySelector('[type=submit]').disabled,true);
  await act(async()=>dialog.querySelector('[type=button]').click());assert.equal(w.document.querySelector('dialog'),null);assert.equal(calls.length,0);
  await act(async()=>w.document.getElementById('account-delete-open').click());
  dialog=w.document.querySelector('dialog');const input=dialog.querySelector('input');
  await act(async()=>{Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype,'value').set.call(input,'탈퇴');input.dispatchEvent(new w.Event('input',{bubbles:true}));input.dispatchEvent(new w.Event('change',{bubbles:true}));});
  assert.equal(dialog.querySelector('[type=submit]').disabled,false);
   await act(async()=>dialog.querySelector('form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true})));
   assert.equal(calls.length,1);assert.deepEqual(JSON.parse(calls[0].options.body),{confirmation:'탈퇴'});assert.equal(calls[0].options.method,'DELETE');assert.match(dialog.querySelector('[role=alert]').textContent,/설정이 아직 완료되지/);assert.equal(dialog.open,true);
 }finally{await act(async()=>root.unmount());dom.window.close();globalThis.window=previous.window;globalThis.document=previous.document;globalThis.fetch=previous.fetch;globalThis.IS_REACT_ACT_ENVIRONMENT=previous.act;}
});
