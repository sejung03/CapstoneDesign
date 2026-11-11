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
