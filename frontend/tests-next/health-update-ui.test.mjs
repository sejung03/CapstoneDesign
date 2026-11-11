import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module from 'node:module';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {createHealthConsent,healthConsentKey} from '../health-consent.mjs';
import {assistantContentKey} from '../assistant.mjs';
import {createHealthUpdates,normalizeHealthUpdates,applyHealthUpdateSelection} from '../health-updates.mjs';
import {emptyProfile} from '../profile.mjs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
// Compile the production component with the project's own Next compiler, without a test-only route or runtime UI.
const swc=require('next/dist/build/swc');await swc.loadBindings();
const filename=fileURLToPath(new URL('../components/health-update-review.jsx',import.meta.url));
const compiled=swc.transformSync(fs.readFileSync(filename,'utf8'),{filename,jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}},target:'es2022'},module:{type:'commonjs'}});
const componentModule=new Module(filename);componentModule.filename=filename;componentModule.paths=Module._nodeModulePaths(path.dirname(filename));componentModule._compile(compiled.code,filename);
const {HealthUpdateReview}=componentModule.exports;
test('health review requires selected confirmation, edited values are reviewed again, and applies only selected fields',async()=>{
 const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost'}),w=dom.window;
 const oldWindow=globalThis.window,oldDocument=globalThis.document,oldAct=globalThis.IS_REACT_ACT_ENVIRONMENT;
 globalThis.window=w;globalThis.document=w.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const {createRoot}=await import('react-dom/client');const root=createRoot(w.document.getElementById('root'));
 const state={locale:'ko',healthConsent:createHealthConsent(true),profile:{...emptyProfile(),medications:'기존 약',allergies:'기존 알레르기'},chat:{messages:[{role:'user',text:'약 이름은 직접 확인할게요. 알레르기도 있어요.'}],intakeContext:null},assistant:{answers:[]},healthUpdates:createHealthUpdates()};state.profileDraft={...state.profile};state.healthConsent.acceptedKey=healthConsentKey(state);
 state.healthUpdates={...createHealthUpdates(),phase:'pending',revision:1,contentKey:assistantContentKey(state),baseline:{...state.profile},items:normalizeHealthUpdates([{id:'med',field:'medications',operation:'set',value:'정리된 약 이름',evidence:{kind:'message',index:0,quote:'약 이름은 직접 확인할게요.'}},{id:'allergy',field:'allergies',operation:'set',value:'정리된 알레르기',evidence:{kind:'message',index:0,quote:'알레르기도 있어요.'}}])};
 let submitted;
 const render=()=>root.render(React.createElement(HealthUpdateReview,{state,onReview:action=>{submitted=action;if(action.type==='apply'){const result=applyHealthUpdateSelection(state.healthUpdates,action,state.profile,state.profileDraft);state.profile=result.profile;state.profileDraft=result.draft;state.healthUpdates={...state.healthUpdates,phase:'applied',items:[]};render();return {ok:true};}}}));
 const el=id=>w.document.getElementById(id);
 try{
  await act(async()=>render());
  assert.equal(w.document.querySelector('button[type="submit"]').disabled,true);assert.equal(el('health-update-check-med').checked,false);assert.match(el('health-update-review').textContent,/기존 약/);
  await act(async()=>el('health-update-check-med').click());assert.equal(w.document.querySelector('button[type="submit"]').disabled,false);
  state.profile.allergies='변경된 정보';await act(async()=>render());assert.equal(w.document.querySelector('button[type="submit"]').disabled,true);assert.match(el('health-update-review').textContent,/입력 내용이 바뀌어/);
  state.profile.allergies='기존 알레르기';await act(async()=>render());
  await act(async()=>{el('health-update-value-med').value='사용자가 수정한 약 이름';el('health-update-value-med').dispatchEvent(new w.Event('input',{bubbles:true}));});
  assert.equal(el('health-update-check-med').checked,false);assert.equal(w.document.querySelector('button[type="submit"]').disabled,true);
  await act(async()=>el('health-update-check-med').click());
  await act(async()=>el('health-update-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true})));
  assert.deepEqual(submitted.ids,['med']);assert.equal(state.profile.medications,'사용자가 수정한 약 이름');assert.equal(state.profile.allergies,'기존 알레르기');assert.match(el('health-update-result').textContent,/이 화면의 내 정보/);
  assert.equal(w.localStorage.length,0);
 }finally{await act(async()=>root.unmount());dom.window.close();globalThis.window=oldWindow;globalThis.document=oldDocument;globalThis.IS_REACT_ACT_ENVIRONMENT=oldAct;}
});
