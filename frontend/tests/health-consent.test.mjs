import test from 'node:test';
import assert from 'node:assert/strict';
import {createHealthConsent,healthConsentKey,hasHealthConsent,localHealthNotice,normalizeHealthNotice} from '../health-consent.mjs';
import {mountApp} from './dom-harness.mjs';
test('health consent is session scoped, changes with processing scope, and cannot authorize unknown external processing',()=>{
 const state={healthConsent:createHealthConsent(true),assistant:{connected:false}};
 assert.equal(hasHealthConsent(state),false);state.healthConsent.acceptedKey=healthConsentKey(state);assert.equal(hasHealthConsent(state),true);
 state.assistant.connected=true;assert.equal(healthConsentKey(state),'');assert.equal(hasHealthConsent(state),false);
 state.healthConsent.notice=normalizeHealthNotice({...localHealthNotice,version:'team-reviewed-v1'});assert.equal(hasHealthConsent(state),false);
 state.healthConsent.acceptedKey=healthConsentKey(state);assert.equal(hasHealthConsent(state),true);
 state.healthConsent.notice.version='team-reviewed-v2';assert.equal(hasHealthConsent(state),false);
 for(const data of [{}, {...localHealthNotice,items:[]},{...localHealthNotice,retention:''}])assert.throws(()=>normalizeHealthNotice(data),TypeError);
});
test('production-mode health gate blocks assistant and ranking before consent even when adapters are present',async()=>{
 const ui=mountApp({source:null});
 ui.run("state.healthConsent.enabled=true;globalThis.healthCalls=0;setAssistantAdapter(async()=>{healthCalls++;return {summary:{ko:'x'}}});requestAssistant('message')");
 await new Promise(resolve=>setImmediate(resolve));assert.equal(ui.run('healthCalls'),0);assert.equal(ui.run('state.healthConsent.open'),true);assert.equal(ui.run('state.assistant.connected'),true);assert.equal(ui.storage.size,0);
 ui.run("setHealthNotice({...localHealthNotice,version:'test-api-policy'});state.healthConsent.acceptedKey=healthConsentKey(state);requestAssistant('message')");await new Promise(resolve=>setImmediate(resolve));assert.equal(ui.run('healthCalls'),1);
});

test('logged-in notice consent restores on the same browser only for the corresponding account and scope', async()=>{
 const {createHealthConsent,healthConsentKey,hasHealthConsent,rememberAccountHealthConsent,restoreAccountHealthConsent,forgetAccountHealthConsent,careAiHealthNotice}=await import('../health-consent.mjs');
 const records=new Map(),storage={setItem:(k,v)=>records.set(k,v),getItem:k=>records.get(k),removeItem:k=>records.delete(k)};
 const state={account:{accountId:'one'},healthConsent:createHealthConsent(true),assistant:{connected:true}};
 state.healthConsent.notice=careAiHealthNotice;
 state.healthConsent.acceptedKey=healthConsentKey(state);
 state.healthConsent.acceptedAt='2026-11-19T01:00:00Z';
 rememberAccountHealthConsent(state,storage);
 const reloaded={...state,healthConsent:{...createHealthConsent(true),notice:careAiHealthNotice}};
 restoreAccountHealthConsent(reloaded,storage);
 assert.equal(hasHealthConsent(reloaded),true);
 const other={...reloaded,account:{accountId:'two'},healthConsent:{...createHealthConsent(true),notice:careAiHealthNotice}};
 restoreAccountHealthConsent(other,storage);
 assert.equal(hasHealthConsent(other),false);
 const newer={...reloaded,healthConsent:{...createHealthConsent(true),notice:{...careAiHealthNotice,version:'next'}}};
 restoreAccountHealthConsent(newer,storage);
 assert.equal(hasHealthConsent(newer),false);
 forgetAccountHealthConsent(reloaded,storage);
 reloaded.healthConsent.acceptedKey='';
 restoreAccountHealthConsent(reloaded,storage);
 assert.equal(hasHealthConsent(reloaded),false);
});

test('accepting consent from the voice entry resumes only that requested action',()=>{
 const ui=mountApp({source:null});
 ui.app.innerHTML='<button id="voice-entry-record"></button><form id="health-consent-form"><input id="health-consent-check" type="checkbox"></form>';
 ui.run("state.healthConsent.enabled=true;viewRenderer=()=>{};state.workspace=createWorkspace();render=()=>{};bind();");
 const button=ui.document.getElementById('voice-entry-record');
 const form=ui.document.getElementById('health-consent-form');
 let starts=0;
 button.addEventListener('click',()=>starts++);
 button.emit('medical:request-voice-consent');
 assert.equal(ui.run('state.healthConsent.pending'),'voice-entry');
 form.requestSubmit();
 assert.equal(starts,0);
 ui.document.getElementById('health-consent-check').checked=true;
 form.requestSubmit();
 assert.equal(ui.run('hasHealthConsent(state)'),true);
 assert.equal(starts,1);
});
test('one health consent covers voice input: the external AI notice names the recording and its OpenAI transcription', async () => {
  const {careAiHealthNotice, careAiHealthNoticeEn} = await import('../health-consent.mjs');
  const {CARE_CONSENT_VERSION} = await import('../care-adapter.mjs');
  assert.equal(CARE_CONSENT_VERSION, careAiHealthNotice.version);
  assert.notEqual(careAiHealthNotice.version, 'care-openai-1'); // 음성이 들어가기 전 동의로는 녹음을 보낼 수 없다
  assert.ok(careAiHealthNotice.items.some(item => /녹음/.test(item)));
  assert.match(careAiHealthNotice.processing, /음성 인식/);
  assert.ok(careAiHealthNoticeEn.items.some(item => /voice recording/.test(item)));
  assert.match(careAiHealthNoticeEn.processing, /speech recognition/);
});
