import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {createAssistantState,assistantContentKey,assistantInputKey} from '../assistant.mjs';
const require=createRequire(import.meta.url),swc=require('next/dist/build/swc');await swc.loadBindings();
const original=require.extensions['.jsx'];
require.extensions['.jsx']=(module,filename)=>module._compile(swc.transformSync(fs.readFileSync(filename,'utf8'),{filename,jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}},target:'es2022'},module:{type:'commonjs'}}).code,filename);
let AssistantResult;try{({AssistantResult}=require('../components/assistant-result.jsx'));}finally{if(original)require.extensions['.jsx']=original;else delete require.extensions['.jsx'];}
test('adaptive question presents variable options as text and gates skip and answer editing by response freshness',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'}),w=dom.window,previous=[globalThis.window,globalThis.document,globalThis.IS_REACT_ACT_ENVIRONMENT];
 globalThis.window=w;globalThis.document=w.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const {createRoot}=await import('react-dom/client');const root=createRoot(w.document.getElementById('root'));
 const q={id:'q2',label:{ko:'문진 2'},options:Array.from({length:8},(_,i)=>({id:'option-'+i,label:{ko:i===0?'<img src=x>':'선지 '+i}}))};
 const state={locale:'ko',profile:{},chat:{messages:[{role:'user',text:'약국을 찾고 싶어요'}],intakeContext:null},assistant:createAssistantState(true)};
 const update=()=>{state.assistant.response={followUp:q,contentKey:assistantContentKey(state),sourceKey:assistantInputKey(state)};};update();
 const render=()=>root.render(React.createElement(AssistantResult,{state,t:key=>key}));
 try{
  await act(async()=>render());assert.equal(w.document.querySelectorAll('[data-assistant-option]').length,8);assert.equal(w.document.querySelector('img'),null);assert.equal(w.document.getElementById('assistant-skip'),null);
  state.assistant.answers=[{questionId:'q1',value:'1',label:{ko:'문진 1'},optionLabel:{ko:'선지 1'}}];state.assistant.questions=[{id:'q1'}];update();await act(async()=>render());
  assert.equal(w.document.querySelector('.assistant-question-step').textContent,'문진 2');
  assert.equal(w.document.querySelector('.assistant-answer-history').open,false);
  assert.ok(w.document.querySelector('.active-question').compareDocumentPosition(w.document.querySelector('.assistant-answer-history'))&w.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.ok(w.document.getElementById('assistant-skip'));assert.equal(w.document.querySelector('[data-assistant-answer-edit]').disabled,false);
  state.assistant.status='loading';await act(async()=>render());assert.equal(w.document.getElementById('assistant-skip'),null);assert.equal(w.document.querySelector('[data-assistant-answer-edit]').disabled,true);
  state.assistant.status='ready';state.chat.messages.push({role:'user',text:'변경한 내용'});await act(async()=>render());assert.equal(w.document.querySelector('[data-assistant-option]'),null);assert.equal(w.document.querySelector('[data-assistant-answer-edit]').disabled,true);
 }finally{await act(async()=>root.unmount());w.close();[globalThis.window,globalThis.document,globalThis.IS_REACT_ACT_ENVIRONMENT]=previous;}
});
