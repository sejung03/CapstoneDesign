import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import {JSDOM} from 'jsdom';
import React, {act} from 'react';
import {assistantContentKey} from '../assistant.mjs';

const require = createRequire(import.meta.url);
const swc = require('next/dist/build/swc');
await swc.loadBindings();
const original = require.extensions['.jsx'];
require.extensions['.jsx'] = (module, filename) => module._compile(swc.transformSync(
  fs.readFileSync(filename, 'utf8'),
  {filename, jsc: {parser: {syntax: 'ecmascript', jsx: true}, transform: {react: {runtime: 'automatic'}}},
   module: {type: 'commonjs'}},
).code, filename);
let VoiceInput,AutoVoice,EmergencyCard;
try {
  ({VoiceInput,AutoVoice} = require('../components/voice-controls.jsx'));
  ({EmergencyCard} = require('../components/emergency-card.jsx'));
}
finally {
  if (original) require.extensions['.jsx'] = original;
  else delete require.extensions['.jsx'];
}

test('voice preview sends one matching answer and cancels stale or ambiguous answers', async context => {
  const {window} = new JSDOM('<form id="form"><textarea id="composer-input" maxlength="1000"></textarea><div id="root"></div></form>',
    {pretendToBeVisual: true});
  const backups = {};
  context.mock.method(window.HTMLMediaElement.prototype,'play',async()=>{});
  context.mock.method(window.HTMLMediaElement.prototype,'pause',()=>{});
  let transcript = '두 번째', requests = 0, trackStops = 0;
  const jobs = [];
  class Recorder {
    static isTypeSupported = () => true;
    state = 'inactive';
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      this.ondataavailable({data: new Blob(['test audio'])});
      return this.onstop();
    }
  }
  Object.defineProperty(window.navigator, 'mediaDevices', {value: {
    getUserMedia: async () => ({getTracks: () => [{stop: () => trackStops++}]}),
  }});
  for (const [name, value] of Object.entries({
    window, document: window.document, navigator: window.navigator, Event: window.Event,
    AbortController: window.AbortController, IS_REACT_ACT_ENVIRONMENT: true,
    MediaRecorder: Recorder,
    fetch: async () => { requests++; return Response.json({text: transcript}); },
  })) {
    backups[name] = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {configurable: true, writable: true, value});
  }
  const {createRoot} = await import('react-dom/client');
  const {consumeSpokenAnswer} = await import('../voice-answer.mjs');
  const root = createRoot(window.document.getElementById('root'));
  const input = window.document.getElementById('composer-input');
  const options = [{id: 'yes', label: {ko: '예'}}, {id: 'no', label: {ko: '아니요'}}];
  let question = {id: 'q1', options}, autoQuestion=null, autoListen=false;
  const conversation = [];
  const answers = [];
  input.form.addEventListener('submit', event => {
    event.preventDefault();
    answers.push(consumeSpokenAnswer(input, input.value, question)?.id);
  });
  const render = () => act(async () => root.render(React.createElement(VoiceInput, {question, conversation, permitted: true, autoListen, autoQuestion})));
  const button = () => window.document.querySelector('.composer-voice-button');
  const click = () => act(async () => button().click());
  const record = async () => {
    input.value = '';
    await click();
    assert.equal(button().getAttribute('aria-pressed'), 'true');
    await click();
  };
  const listeningJobs=[];
  const clock = context.mock.method(globalThis, 'setTimeout', (callback, delay) => {
    if (delay === 1000) jobs.push(callback);
    if (delay === 250) listeningJobs.push(callback);
    return 0;
  });

  try {
    await render();
    assert.equal(button().textContent, '');
    assert.equal(button().getAttribute('aria-label'), '음성 입력');
    await record();
    assert.equal(button().getAttribute('aria-label'), '자동 전송 취소');
    assert.deepEqual(answers, []);
    await act(async () => jobs.shift()());
    assert.deepEqual(answers, ['no']);

    await record();
    await click();
    await act(async () => jobs.shift()());
    assert.deepEqual(answers, ['no']);

    await record();
    question = {...question, id: 'q2'};
    await render();
    await act(async () => jobs.shift()());
    assert.deepEqual(answers, ['no']);

    transcript = '두 번째나 세 번째';
    await record();
    assert.equal(jobs.length, 0);
    assert.match(window.document.querySelector('[role=status]').textContent, /선택지/);
    assert.equal(requests, 4);
    assert.ok(trackStops >= 4);

    question={...question,id:'q3'};
    input.value='';
    autoListen=true;
    transcript='두 번째';
    await render();
    assert.equal(listeningJobs.length,0);
    const spokenQuestion=question;
    const renderReadout=()=>root.render(React.createElement(React.Fragment,null,
      React.createElement(VoiceInput,{question,conversation,permitted:true,autoListen,autoQuestion}),
      React.createElement(AutoVoice,{text:'어느 답인가요? 1번 예. 2번 아니요.',volume:0.7,prompt:true,onDone:()=>{
        autoQuestion=spokenQuestion;
        renderReadout();
      }})));
    await act(async()=>renderReadout());
    assert.equal(listeningJobs.length,0);
    await act(async()=>window.document.querySelector('audio').dispatchEvent(new window.Event('ended')));
    assert.equal(listeningJobs.length,1);
    await act(async()=>listeningJobs.shift()());
    assert.equal(button().getAttribute('aria-pressed'),'true');
    await click();
    assert.equal(input.value,''); // No stale draft while a choice awaits auto-send.
    await act(async()=>jobs.shift()());
    assert.deepEqual(answers,['no','no']);
    await act(async()=>renderReadout());
    assert.equal(listeningJobs.length,0);
  } finally {
    clock.mock.restore();
    await act(async () => root.unmount());
    window.close();
    for (const [name, descriptor] of Object.entries(backups)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});

test('opening emergency help stops the current readout and blocks the next one', async t => {
  const {window}=new JSDOM('<div id="root"></div>',{pretendToBeVisual:true});
  const {document}=window;
  const saved=new Map();
  for(const [key,value] of Object.entries({
    window,document,Event:window.Event,AbortController:window.AbortController,IS_REACT_ACT_ENVIRONMENT:true,
  })){
    saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));
    Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  }
  const {createRoot}=await import('react-dom/client');
  const root=createRoot(document.getElementById('root'));
  const play=t.mock.method(window.HTMLMediaElement.prototype,'play',async()=>{});
  const pause=t.mock.method(window.HTMLMediaElement.prototype,'pause',()=>{});
  let completed=0;
  const emergency={manual:false,notice:null,location:{}};
  const state={locale:'ko',emergency,chat:{messages:[]},profile:{},reportImport:{},assistant:{}};
  let resolveSpeech,signal;
  t.mock.method(globalThis,'fetch',async(_,request)=>{
    signal=request.signal;
    return new Promise(resolve=>{resolveSpeech=resolve;});
  });
  const draw=(text,prompt=true)=>act(async()=>root.render(React.createElement(React.Fragment,null,
    React.createElement(AutoVoice,{text,prompt,volume:0.7,onDone:()=>completed++}),
    React.createElement(EmergencyCard,{state,t:key=>key}),
  )));
  try{
    await draw('현재 질문');
    assert.equal(play.mock.callCount(),1);
    emergency.notice={contentKey:assistantContentKey(state),title:{ko:'응급 도움'}};
    await draw('현재 질문');
    assert.ok(document.getElementById('emergency-dialog')?.open);
    assert.equal(pause.mock.callCount(),1);
    await act(async()=>document.querySelector('audio').dispatchEvent(new window.Event('ended')));
    assert.equal(completed,0);
    await draw('다음 질문');
    assert.equal(play.mock.callCount(),1);
    assert.equal(completed,0);
    emergency.notice=null;
    await draw('안내를 닫고 넘어간 새 질문');
    assert.equal(play.mock.callCount(),2);

    await draw('음성 준비 중인 질문',false);
    assert.ok(signal&&!signal.aborted);
    emergency.manual=true;
    await draw('음성 준비 중인 질문',false);
    assert.equal(signal.aborted,true);
    await act(async()=>resolveSpeech(new Response(new Blob(['late audio']))));
    assert.equal(play.mock.callCount(),2);
    assert.equal(completed,0);
  }finally{
    await act(async()=>root.unmount());
    window.close();
    for(const [key,descriptor] of saved){
      if(descriptor)Object.defineProperty(globalThis,key,descriptor);
      else delete globalThis[key];
    }
  }
});
