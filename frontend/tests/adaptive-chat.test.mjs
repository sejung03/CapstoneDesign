import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeAssistantResponse} from '../assistant.mjs';
import {conversationStarters} from '../care-context.mjs';
import {mountApp} from './dom-harness.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const question=id=>({id,type:'singleChoice',required:true,label:{ko:'문진 '+id,en:'Question '+id},options:[1,2,3,4,5,6].map(n=>({id:'option-'+n,label:{ko:'선지 '+n,en:'Option '+n}}))});
test('backend can send a variable question without a frontend catalogue and retains pharmacy search support',()=>{
 const q=question('q1');const r=normalizeAssistantResponse({followUp:q});assert.equal(r.followUp.options.length,6);assert.equal(r.followUp.id,'q1');
 assert.equal(normalizeAssistantResponse({search:{type:'pharmacy',department:'pharmacy',openOnly:true}}).search.type,'pharmacy');
 for(const raw of [{followUp:{...q,options:[]}},{followUp:{...q,type:'diagnosis'}},{followUp:q,followUpQuestionId:'q1'}])assert.throws(()=>normalizeAssistantResponse(raw),TypeError);
 assert.equal(conversationStarters.find(x=>x.id==='pharmacy').search.openOnly,true);assert.equal(conversationStarters.length,4);
});
test('connected chat forwards the first phrase, receives questions and sends selected answers without a fixed wizard',async()=>{
 const ui=mountApp({source:null});
 ui.run('globalThis.requests=[];setAssistantAdapter(async payload=>{requests.push(payload);return {followUp:'+JSON.stringify(question('q1'))+'};});state.workspace=createWorkspace();viewRenderer=()=>{};render=()=>{};');
 ui.run("submitChatText('지금 문 연 약국을 찾고 싶어요')");await tick();
 assert.equal(ui.run('requests.length'),1);assert.equal(ui.run('requests[0].messages[0]'),'지금 문 연 약국을 찾고 싶어요');assert.equal(ui.run('state.workspace.intake'),false);assert.equal(ui.run('state.assistant.response.followUp.options.length'),6);
 ui.app.innerHTML='<button data-assistant-option="option-6"></button>';ui.run('bindAssistant()');ui.document.querySelector('[data-assistant-option]').click();await tick();
 assert.equal(ui.run('requests.length'),2);assert.equal(ui.run('requests[1].reason'),'followup');assert.equal(ui.run('requests[1].followUpAnswers[0].value'),'option-6');assert.equal(ui.storage.size,0);
});
test('editing an earlier adaptive answer removes later answers, and skip sends only actual answers',async()=>{
 const ui=mountApp({source:null});ui.run('globalThis.requests=[];setAssistantAdapter(async payload=>{requests.push(payload);return {search:{type:"pharmacy",openOnly:true}};});render=()=>{};');
 const qs=[question('q1'),question('q2')];
 ui.run('state.assistant.questions='+JSON.stringify(qs)+';state.assistant.answers='+JSON.stringify(qs.map(q=>({questionId:q.id,value:'option-1',label:q.label,optionLabel:q.options[0].label})))+';state.assistant.response={contentKey:assistantContentKey(state),followUp:'+JSON.stringify(question('q3'))+'};');
 ui.app.innerHTML='<button data-assistant-answer-edit="q1"></button>';ui.run('bindAssistant()');ui.document.querySelector('[data-assistant-answer-edit]').click();
 assert.equal(ui.run('state.assistant.answers.length'),0);assert.equal(ui.run('state.assistant.response.followUp.id'),'q1');assert.equal(ui.run('requests.length'),0);
 ui.app.innerHTML='<button id="assistant-skip"></button>';ui.run('bindAssistant()');ui.document.getElementById('assistant-skip').click();await tick();assert.equal(ui.run('requests.length'),0);
 ui.run('state.assistant.answers=[{questionId:"q1",value:"option-2",label:{ko:"문진 q1"},optionLabel:{ko:"선지 2"}}];state.assistant.response.contentKey=assistantContentKey(state);');
 ui.document.getElementById('assistant-skip').click();await tick();assert.equal(ui.run('requests.length'),1);assert.equal(ui.run('requests[0].reason'),'skip');assert.equal(ui.run('requests[0].followUpAnswers.length'),1);assert.equal(ui.run('requests[0].followUpAnswers[0].value'),'option-2');assert.equal(ui.storage.size,0);
});
