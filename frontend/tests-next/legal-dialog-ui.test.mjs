import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import {healthConsentKey} from '../health-consent.mjs';
import {mockIntakeQuestionnaire} from '../intake-data.mjs';

const require=createRequire(import.meta.url),swc=require('next/dist/build/swc');
await swc.loadBindings();
const previous=require.extensions['.jsx'];
let AppView;
try{
 require.extensions['.jsx']=(module,filename)=>module._compile(swc.transformSync(fs.readFileSync(filename,'utf8'),{filename,jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}}).code,filename);
 ({AppView}=require('../components/app-view.jsx'));
}finally{if(previous)require.extensions['.jsx']=previous;else delete require.extensions['.jsx'];}

test('document dialogs close without navigating or remounting the active conversation',async()=>{
 const {window}=new JSDOM('<div id="root"></div>',{url:'http://localhost:3080/',pretendToBeVisual:true});
 const {document}=window;
 const globals={window,document,IS_REACT_ACT_ENVIRONMENT:true};
 const descriptors=Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]);
 Object.assign(globalThis,globals);
 const root=createRoot(document.getElementById('root'));
 const state={intakeQuestionnaire:mockIntakeQuestionnaire,intakeAnswers:{},intakeStep:1,locale:'ko',theme:'light',chat:{messages:[{id:'m1',text:'어제부터 목이 아파요'}],input:'작성 중인 답변'},workspace:{},reportImport:{},healthConsent:{enabled:true,open:false,pending:''},emergency:{location:{}},assistant:{},search:{},live:{}};
 state.healthConsent.acceptedKey=healthConsentKey(state);
 const render=()=>act(()=>root.render(React.createElement(AppView,{state,t:key=>key})));
 try{
  await render();
  const input=document.getElementById('composer-input'),messages=document.getElementById('chat-messages');
  messages.scrollTop=64;
  const questionnaire=messages.querySelector('.conversation-intake-heading span');
  assert.match(questionnaire.textContent,/2/);
  const assertConversation=()=>{
   assert.equal(document.getElementById('composer-input'),input);
   assert.equal(input.value,'작성 중인 답변');
   assert.equal(document.getElementById('chat-messages'),messages);
   assert.match(messages.textContent,/어제부터 목이 아파요/);
   assert.equal(messages.scrollTop,64);
   assert.equal(messages.querySelector('.conversation-intake-heading span'),questionnaire);
   assert.equal(window.location.pathname,'/');
  };
  for(const [name,label] of [['terms','이용약관'],['licenses','오픈소스 라이선스']]){
   const link=document.querySelector('a[href^="/legal/'+name+'"]');
   const event=new window.MouseEvent('click',{button:0,bubbles:true,cancelable:true});
   await act(()=>link.dispatchEvent(event));
   assert.equal(event.defaultPrevented,true);
   const dialog=document.getElementById('legal-document-dialog');
   assert.ok(dialog.open);
   assert.equal(dialog.querySelector('h2').textContent,label);
   if(name==='licenses')assert.equal(dialog.querySelector('a').target,'_blank');
   await act(()=>name==='terms'?dialog.querySelector('button').click():dialog.dispatchEvent(new window.Event('cancel',{cancelable:true})));
   assert.equal(document.getElementById('legal-document-dialog'),null);
   assert.equal(document.activeElement,link);
   assertConversation();
  }
  state.healthConsent.open=true;
  await render();
  const health=document.getElementById('chat-consent-dialog');
  assert.ok(health.open);
  assert.equal(messages.contains(health),false);
  assert.equal(health.querySelector('h3').textContent,'건강정보 처리 안내');
  state.healthConsent.open=false;
  await render();
  assert.equal(document.getElementById('chat-consent-dialog'),null);
  assertConversation();
 }finally{
  await act(()=>root.unmount());window.close();
  for(const [key,value] of descriptors){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}
 }
});
