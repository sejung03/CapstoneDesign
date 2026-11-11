import test from 'node:test';
import assert from 'node:assert/strict';
import {mountApp} from './dom-harness.mjs';
test('Production defaults to real search with chat open and offers no sample mode',()=>{
 const ui=mountApp({source:null});
 assert.equal(ui.run('state.source'),'live');assert.equal(ui.run('state.chat.open'),true);
 ui.document.getElementById('skip').click();
 assert.ok(ui.document.getElementById('assistant-panel'));assert.ok(ui.document.getElementById('composer-input'));
 assert.equal(ui.document.getElementById('chat-open'),null);
 assert.equal(ui.document.querySelectorAll('[data-source]').length,0);assert.equal(ui.document.querySelector('.sample-info'),null);
 assert.equal(ui.document.querySelectorAll('[data-card]').length,0);
 assert.equal(ui.run('state.live.locationAttempted'),undefined,'No premature location request before map configuration');
 ui.document.getElementById('chat-close').click();
 assert.equal(ui.document.getElementById('assistant-panel'),null);assert.ok(ui.document.getElementById('chat-open'));
 ui.run("navigate('report');navigate('explore')");
 assert.equal(ui.run('state.chat.open'),false,'An explicit collapse is preserved across navigation');
 ui.document.getElementById('chat-open').click();assert.ok(ui.document.getElementById('assistant-panel'));
});
test('Unknown hours have no status badge; type illustrations have no explanatory caption',()=>{
 const ui=mountApp({source:null});
 ui.run("state.view='explore';state.live.items=['unknown','open'].map((status,i)=>({id:'test-'+i,source:'kakao',type:i?'pharmacy':'hospital',status,schedule:status==='open'?Array.from({length:8},(_,day)=>({day:day+1,start:'0000',end:'2400'})):null,name:{ko:'기관'+i,en:'Care'+i},area:{ko:'서울',en:'Seoul'},access:{ko:'',en:''},lat:37,lng:127,photo:null}));state.search.criteria=emptyCriteria();render()");
 assert.equal(ui.document.querySelector('.status-unknown'),null);
 assert.ok(ui.document.querySelector('.status-open'));
 assert.equal(ui.document.querySelector('.facility-art-note'),null);
 assert.doesNotMatch(ui.app.innerHTML,/기관 종류를 나타낸 안내 그림/);
 assert.equal(ui.document.querySelectorAll('[data-source]').length,0);
 assert.match(ui.app.innerHTML,/facility-illustration/);
 assert.equal(ui.run('state.live.items[0].status'),'unknown','Absent badge does not manufacture an opening status');
});
