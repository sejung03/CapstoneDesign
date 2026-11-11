import test from 'node:test';
import assert from 'node:assert/strict';
import {createHealthUpdates,normalizeHealthUpdates,validateHealthUpdateEvidence,applyHealthUpdateSelection} from '../health-updates.mjs';
import {normalizeAssistantResponse} from '../assistant.mjs';
import {mountApp} from './dom-harness.mjs';
const raw={id:'medication-1',field:'medications',operation:'set',value:'사용자가 말한 약',evidence:{kind:'message',index:0,quote:'복용 중인 약'}};
const context={chat:{messages:[{role:'user',text:'복용 중인 약이 있어요.'}],intakeContext:null},assistant:{answers:[]}};
test('health update schema allows only known fields and operations, with evidence and no duplicate fields',()=>{
 assert.equal(normalizeAssistantResponse({profileUpdates:[raw]}).profileUpdates[0].field,'medications');
 for(const item of [{...raw,field:'nickname'},{...raw,operation:'append'},{...raw,value:''},{...raw,field:'age',value:'adult'},{...raw,evidence:{...raw.evidence,index:-1}}])assert.throws(()=>normalizeHealthUpdates([item]),TypeError);
 assert.throws(()=>normalizeHealthUpdates([raw,{...raw,id:'another'}]),TypeError);
 assert.throws(()=>normalizeAssistantResponse({profileUpdates:[]}),TypeError);
 assert.doesNotThrow(()=>normalizeHealthUpdates([{...raw,operation:'clear',value:''}]));
 assert.doesNotThrow(()=>normalizeHealthUpdates([{...raw,field:'age',value:'30'}]));
 for(const value of ['-1','121','1.5'])assert.throws(()=>normalizeHealthUpdates([{...raw,field:'age',value}]),TypeError);
});
test('evidence must reference real user text or an answered questionnaire item; skipped answers are not evidence',()=>{
 const items=normalizeHealthUpdates([raw]);assert.equal(validateHealthUpdateEvidence(items,context),items);
 for(const evidence of [{kind:'message',index:1,quote:'복용 중인 약'},{kind:'message',index:0,quote:'없는 답변'},{kind:'intake',questionId:'q1',quote:'모름'}])assert.throws(()=>validateHealthUpdateEvidence(normalizeHealthUpdates([{...raw,evidence}]),context),TypeError);
 const answer={questionId:'q1',value:null,optionLabel:{ko:'모름'}};
 const state={...context,chat:{...context.chat,intakeContext:{answers:[answer]}}};
 assert.throws(()=>validateHealthUpdateEvidence(normalizeHealthUpdates([{...raw,evidence:{kind:'intake',questionId:'q1',quote:'모름'}}]),state),TypeError);
 const note=normalizeHealthUpdates([{...raw,evidence:{kind:'intakeNote',quote:'복용 중인 약'}}]);assert.throws(()=>validateHealthUpdateEvidence(note,context),TypeError);assert.doesNotThrow(()=>validateHealthUpdateEvidence(note,{...context,chat:{...context.chat,intakeContext:{symptom:'복용 중인 약이 있어요.'}}}));
 answer.value='unknown';assert.doesNotThrow(()=>validateHealthUpdateEvidence(normalizeHealthUpdates([{...raw,evidence:{kind:'intake',questionId:'q1',quote:'모름'}}]),state));
});
test('applying selected updates preserves other fields, rejects unsaved edits and never silently clears a set value',()=>{
 const profile={age:'30',medications:'기존 약',allergies:'기존 알레르기'},draft={...profile,history:'작성 중인 별도 내용'};
 const batch={...createHealthUpdates(),phase:'pending',baseline:{...profile},items:normalizeHealthUpdates([raw])};
 const result=applyHealthUpdateSelection(batch,{ids:[raw.id],values:{[raw.id]:'확인한 약 이름'}},profile,draft);
 assert.equal(result.profile.medications,'확인한 약 이름');assert.equal(result.profile.allergies,'기존 알레르기');assert.equal(result.draft.history,'작성 중인 별도 내용');assert.equal(profile.medications,'기존 약');
 assert.throws(()=>applyHealthUpdateSelection(batch,{ids:[raw.id],values:{[raw.id]:''}},profile,draft),/invalid/);
 assert.throws(()=>applyHealthUpdateSelection(batch,{ids:[raw.id],values:{[raw.id]:'약'}},profile,{...draft,medications:'직접 작성 중'}),/conflict/);
 assert.throws(()=>applyHealthUpdateSelection(batch,{ids:['missing'],values:{}},profile,draft),/invalid/);
 batch.items=normalizeHealthUpdates([{...raw,operation:'clear',value:''}]);assert.equal(applyHealthUpdateSelection(batch,{ids:[raw.id]},profile,draft).profile.medications,'');
});
test('controller requires confirmation, preserves report edits, makes no storage write and rejects stale candidates',()=>{
 const ui=mountApp({source:null});
 ui.run("state.workspace=createWorkspace();state.profile.medications='기존 약';state.profileDraft.medications='기존 약';state.report.saved={notes:'편집한 분석서'};state.chat.messages=[{role:'user',text:'복용 중인 약이 있어요.'}]");
 ui.run('setHealthUpdateCandidates('+JSON.stringify([raw])+')');assert.equal(ui.run('state.profile.medications'),'기존 약');
 ui.run('reviewHealthUpdates('+JSON.stringify({type:'apply',ids:[raw.id],values:{[raw.id]:'확인한 약'}})+')');
 assert.equal(ui.run('state.profile.medications'),'확인한 약');assert.equal(ui.run('state.report.saved.notes'),'편집한 분석서');assert.equal(ui.storage.size,0);
 ui.run('setHealthUpdateCandidates('+JSON.stringify([raw])+');state.chat.messages.push({role:"user",text:"새 답변"})');
 assert.equal(ui.run('reviewHealthUpdates('+JSON.stringify({type:'apply',ids:[raw.id],values:{[raw.id]:'다른 약'}})+').error'),'stale');
 ui.run('setHealthUpdateCandidates('+JSON.stringify([raw])+');reviewHealthUpdates({type:"session"})');assert.equal(ui.run('state.profile.medications'),'확인한 약');assert.equal(ui.run('state.healthUpdates.phase'),'session');
 ui.run('state.healthConsent.enabled=true;clearHealthAccess()');assert.equal(ui.run('state.healthUpdates.phase'),'idle');
 assert.throws(()=>ui.run('setHealthUpdateCandidates('+JSON.stringify([raw])+')'),/Health consent required/);
});

test('assistant adapter can deliver candidates without a summary and does not apply them automatically',async()=>{
 const ui=mountApp({source:null});ui.run('state.chat.messages='+JSON.stringify(context.chat.messages)+';setAssistantAdapter(async()=>({profileUpdates:'+JSON.stringify([raw])+'}));requestAssistant("message")');
 await new Promise(resolve=>setImmediate(resolve));assert.equal(ui.run('state.healthUpdates.phase'),'pending');assert.equal(ui.run('state.profile.medications'),'');assert.equal(ui.run('state.assistant.response.profileUpdates.length'),1);assert.equal(ui.storage.size,0);
});
