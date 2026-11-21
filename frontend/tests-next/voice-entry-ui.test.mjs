import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {healthConsentKey} from '../health-consent.mjs';

const require=createRequire(import.meta.url),swc=require('next/dist/build/swc');
await swc.loadBindings();
process.env.NEXT_PUBLIC_VOICE_ENABLED='1';
const original=require.extensions['.jsx'];
require.extensions['.jsx']=(module,filename)=>module._compile(swc.transformSync(fs.readFileSync(filename,'utf8'),{
  filename,jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'},
}).code,filename);
let AppView;
try {({AppView}=require('../components/app-view.jsx'));}
finally {if(original)require.extensions['.jsx']=original;else delete require.extensions['.jsx'];}

test('voice entry hides the original main screen until the user enters',async t=>{
  const {window}=new JSDOM('<a class="skip-link" href="#main">본문으로 이동</a><div id="root"></div>',{pretendToBeVisual:true});
  const {document}=window;
  const play=t.mock.method(window.HTMLMediaElement.prototype,'play',async()=>{});
  t.mock.method(window.HTMLMediaElement.prototype,'pause',()=>{});
  class Recorder {
    static isTypeSupported=()=>true;
    state='inactive';
    start(){this.state='recording';}
    stop(){
      this.state='inactive';
      this.ondataavailable({data:new Blob(['audio'],{type:'audio/webm'})});
      return this.onstop();
    }
  }
  const globals={window,document,Event:window.Event,AbortController:window.AbortController,IS_REACT_ACT_ENVIRONMENT:true,MediaRecorder:Recorder};
  t.mock.method(globalThis,'fetch',async url=>{
    assert.equal(url,'/api/voice/stt');
    return Response.json({text:'목이 아파요'});
  });
  Object.defineProperty(globalThis.navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})}});
  t.after(()=>delete globalThis.navigator.mediaDevices);
  const entryJobs=[];
  const nativeTimeout=globalThis.setTimeout;
  t.mock.method(globalThis,'setTimeout',(callback,delay,...args)=>{
    if(delay===2000){entryJobs.push(callback);return 0;}
    return nativeTimeout(callback,delay,...args);
  });
  const saved=Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]);
  Object.assign(globalThis,globals);
  t.after(()=>{for(const [key,descriptor] of saved){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
  const {createRoot}=await import('react-dom/client');
  const root=createRoot(document.getElementById('root'));
  const state={locale:'ko',theme:'light',chat:{messages:[],input:''},workspace:{},reportImport:{},
    healthConsent:{enabled:true},emergency:{location:{}},assistant:{},search:{},live:{}};
  const stage=()=>document.getElementById('voice-entry');
  const skipTarget=()=>document.querySelector(document.querySelector('.skip-link').getAttribute('href'));
  const main=()=>document.querySelector('.care-shell');
  const click=element=>act(async()=>element.click());
  const mount=(revision,key='screen',conversationVersion=0)=>act(()=>root.render(React.createElement(AppView,{state,t:key=>key,revision,key,conversationVersion})));
  try{
    await mount(1);
    assert.match(stage().textContent,/어디가 아프신가요/);
    assert.equal(skipTarget(),stage());
    assert.equal(stage().tabIndex,-1);
    assert.equal(stage().querySelector('audio'),null);
    assert.equal(play.mock.callCount(),0);
    assert.equal(main().hidden,true);
    assert.equal(main().hasAttribute('inert'),true);
    const volumeButton=document.querySelector('.header-voice-volume > button');
    const popover=document.getElementById('voice-volume-popover');
    assert.ok(volumeButton.querySelector('svg'));
    assert.equal(popover.hidden,true);
    await click(volumeButton);
    assert.equal(popover.hidden,false);
    assert.equal(document.getElementById('header-voice-level').value,'70');
    await click(popover.querySelector('button'));
    assert.match(volumeButton.getAttribute('aria-label'),/음소거/);
    await act(()=>document.getElementById('header-voice-level').dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
    assert.equal(popover.hidden,true);
    await click(stage().querySelector('.secondary-button'));
    assert.equal(stage(),null);
    assert.equal(main().hidden,false);
    assert.equal(skipTarget(),document.getElementById('main'));
    assert.match(main().querySelector('.chat-welcome').textContent,/무엇을|어떤|도움|찾/);
    await mount(2);
    assert.equal(stage(),null);

    await mount(3,'screen',1);
    assert.ok(stage());
    assert.equal(skipTarget(),stage());
    assert.equal(stage().querySelector('audio'),null);
    assert.equal(play.mock.callCount(),0);
    assert.equal(main().hasAttribute('inert'),true);
    assert.match(volumeButton.getAttribute('aria-label'),/음소거/);
    assert.equal(volumeButton,document.querySelector('.header-voice-volume > button'));
    assert.equal(stage().querySelector('.voice-entry-preview'),null);
    assert.match(document.getElementById('voice-entry-record').getAttribute('aria-label'),/음성/);

    await mount(3,'voice');
    let forwarded=0;
    document.getElementById('voice-entry-record').addEventListener('medical:request-voice-consent',()=>forwarded++);
    await click(stage().querySelector('.primary-button'));
    assert.ok(stage());
    assert.equal(main().hidden,true);
    assert.equal(forwarded,1);
    state.healthConsent.open=true;
    state.healthConsent.pending='voice-entry';
    await mount(4,'voice');
    const dialog=document.getElementById('chat-consent-dialog');
    assert.ok(dialog);
    assert.equal(main().contains(dialog),false);
    assert.equal(document.querySelectorAll('#health-consent-form').length,1);
    state.healthConsent.open=false;
    state.healthConsent.pending='';
    await mount(5,'voice');
    assert.ok(stage()); // Closing consent does not bypass the start screen.
    assert.equal(main().hidden,true);
    state.healthConsent.acceptedKey=healthConsentKey(state);
    await mount(6,'voice');
    assert.match(stage().textContent,/동의가 완료/);
    await click(stage().querySelector('.primary-button'));
    assert.ok(stage(), 'recording stays in the entry screen');
    assert.equal(main().hidden,true);
    assert.match(stage().textContent,/듣는 중/);
    await click(stage().querySelector('.primary-button'));
    assert.equal(main().hidden,true);
    assert.match(stage().querySelector('.voice-entry-preview').textContent,/목이 아파요/);
    const input=document.getElementById('composer-input');
    assert.equal(input.value,'');
    let sent='';
    input.form.addEventListener('submit',event=>{event.preventDefault();sent=input.value;});
    assert.equal(stage().querySelector('.voice-entry-preview button').textContent,'수정하기');
    assert.equal(entryJobs.length,1);
    await act(async()=>entryJobs.shift()());
    assert.equal(stage(),null);
    assert.equal(main().hidden,false);
    assert.equal(sent,'목이 아파요');
    assert.equal(forwarded,1);

    await mount(7,'edit');
    await click(stage().querySelector('.primary-button'));
    await click(stage().querySelector('.primary-button'));
    const pendingEdit=entryJobs.shift();
    sent='';
    document.getElementById('composer-input').form.addEventListener('submit',event=>{event.preventDefault();sent='unexpected';});
    await click(stage().querySelector('.voice-entry-preview button'));
    assert.equal(document.getElementById('composer-input').value,'목이 아파요');
    await act(async()=>pendingEdit());
    assert.equal(sent,'');

    await mount(8,'emergency');
    let emergencyClicks=0;
    const emergencyButton=document.getElementById('emergency-open');
    assert.equal(emergencyButton.parentElement.previousElementSibling,document.querySelector('.care-header'));
    assert.equal(stage().contains(emergencyButton),false);
    emergencyButton.addEventListener('click',()=>emergencyClicks++);
    await click(emergencyButton);
    assert.equal(emergencyClicks,1);
    state.emergency.manual=true;
    await mount(8,'emergency');
    assert.equal(main().hidden,true);
    assert.ok(stage());
    const emergency=document.getElementById('emergency-dialog');
    assert.ok(emergency?.hasAttribute('open'));
    assert.equal(main().contains(emergency),false);
    assert.equal(document.querySelectorAll('#emergency-dialog').length,1);
    state.emergency.manual=false;
    await mount(9,'emergency');
    assert.ok(stage());
    assert.equal(document.getElementById('emergency-dialog'),null);
  } finally {
    await act(()=>root.unmount());
    window.close();
  }
});
