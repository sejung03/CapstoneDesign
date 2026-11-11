import test from 'node:test';
import assert from 'node:assert/strict';
import {mockIntakeQuestionnaire,normalizeIntakeQuestionnaire,buildIntakeSubmission} from '../intake-data.mjs';
import {mountApp} from './dom-harness.mjs';
import {startServer} from '../server.mjs';
const fixture=()=>structuredClone(mockIntakeQuestionnaire);
const submit=ui=>ui.document.getElementById('intake-wizard').emit('submit');
const choose=(ui,index=0)=>ui.document.querySelectorAll('[data-intake-option]')[index].click();
const apply=(ui,data)=>ui.run('setIntakeQuestionnaire('+JSON.stringify(data)+')');

test('Both questions are independent choice data; validation rejects malformed IDs, labels and unsupported types',()=>{
 const raw=fixture();raw.secret='not part of UI';raw.questions[0].clinicalRule='not supported';
 raw.questions[0].options[0].onset='today';
 const normalized=normalizeIntakeQuestionnaire(raw);
 assert.equal(normalized.secret,undefined);assert.equal(normalized.questions[0].clinicalRule,undefined);
 assert.equal(normalized.questions[0].options[0].onset,undefined,'Question data cannot silently bind a medical field');
 raw.questions[0].label.ko='changed';assert.equal(normalized.questions[0].label.ko,'문진 1');
 for(const mutate of [
  d=>d.questions=[],d=>d.questions[0].type='text',d=>d.questions[1].required='yes',
  d=>d.questions[0].label.ko='',d=>d.questions[1].options.push(d.questions[1].options[0]),
  d=>d.questions[1].options[0].id='"><script>',d=>d.questions[1].id=d.questions[0].id,
  d=>d.questions[1].options=Array(13).fill(d.questions[1].options[0])
 ]){
  const data=fixture();mutate(data);assert.throws(()=>normalizeIntakeQuestionnaire(data),TypeError);
 }
});

test('Submission preserves separate question IDs even when their option IDs match and snapshots original labels',()=>{
 const data=fixture();
 const snapshot=buildIntakeSubmission(data,{'question-1':'option-1','question-2':'option-2'});
 assert.equal(snapshot.questionnaireVersion,'mock-2');
 assert.equal(snapshot.answers[0].questionId,'question-1');assert.equal(snapshot.answers[0].value,'option-1');
 assert.equal(snapshot.answers[1].questionId,'question-2');assert.equal(snapshot.answers[1].value,'option-2');
 data.questions[0].options[0].label.ko='changed';assert.equal(snapshot.answers[0].optionLabel.ko,'선지 1');
 const empty=buildIntakeSubmission(data,{'question-1':'invalid'});
 assert.equal(empty.answers[0].value,null);assert.equal(empty.answers[1].value,null);
});

test('Injected question and choice text render safely and required choices work without notes',()=>{
 const ui=mountApp({source:null});const data=fixture();data.version='api-v1';
 data.questions[0].label={ko:'<img src=x>',en:'Your question'};
 data.questions[0].options=[{id:'answer-a',label:{ko:'<script>choice</script>'}}];
 apply(ui,data);assert.match(ui.app.innerHTML,/&lt;img src=x&gt;/);assert.doesNotMatch(ui.app.innerHTML,/<img src=x>/);
 assert.match(ui.app.innerHTML,/&lt;script&gt;choice/);submit(ui);assert.equal(ui.run('state.intakeStep'),0);
 choose(ui);submit(ui);choose(ui,1);submit(ui);submit(ui);submit(ui);
 assert.equal(ui.run('state.view'),'explore');
 assert.equal(ui.run('state.chat.intakeContext.answers[0].value'),'answer-a');
 assert.equal(ui.run('state.draft.symptom'),'');assert.equal(ui.run('state.draft.onset'),'');
 assert.match(ui.app.innerHTML,/&lt;script&gt;choice/);assert.equal(ui.run('state.chat.messages.length'),0);
});

test('Invalid response preserves pending input; valid replacement clears selections while preserving submitted snapshot',()=>{
 const ui=mountApp({source:null});choose(ui);submit(ui);choose(ui);submit(ui);submit(ui);submit(ui);
 const previous=ui.run('JSON.stringify(state.chat.intakeContext)');
 ui.run("navigate('entry');state.intakeStep=2;render()");
 ui.document.getElementById('intake-symptom').value='unfinished';
 assert.throws(()=>apply(ui,{id:'bad'}));
 assert.equal(ui.document.getElementById('intake-symptom').value,'unfinished');
 assert.equal(ui.run("state.intakeAnswers['question-1']"),'option-1');
 const replacement=fixture();replacement.version='next';apply(ui,replacement);
 assert.equal(ui.run('state.intakeStep'),0);assert.equal(ui.run('state.draft.symptom'),'');
 assert.equal(ui.run('Object.keys(state.intakeAnswers).length'),0);
 assert.equal(ui.run('JSON.stringify(state.chat.intakeContext)'),previous);
});

test('Questions marked optional can be left unanswered and health answers are never written to storage',()=>{
 const ui=mountApp({source:null});const data=fixture();data.questions.forEach(q=>q.required=false);
 apply(ui,data);submit(ui);submit(ui);submit(ui);submit(ui);
 assert.equal(ui.run('state.view'),'explore');
 assert.equal(ui.run('state.chat.intakeContext.answers[0].value'),null);
 assert.equal(ui.run('state.chat.intakeContext.answers[1].value'),null);
 assert.equal(ui.run('state.search.criteria.department'),'all');assert.equal(ui.storage.size,0);
});

test('Changed option IDs and missing English labels remain usable across backtracking and language changes',()=>{
 const ui=mountApp({source:null});const data=fixture();
 data.questions[0].label={ko:'외부 문진'};
 data.questions[0].options=[{id:'custom-option',label:{ko:'외부 선택지'}}];
 apply(ui,data);choose(ui);submit(ui);choose(ui,1);ui.document.getElementById('intake-back').click();
 ui.document.getElementById('language').click();assert.match(ui.app.innerHTML,/외부 문진/);
 assert.equal(ui.document.querySelector('[data-intake-option]').attributes['aria-pressed'],'true');
 submit(ui);submit(ui);submit(ui);submit(ui);
 assert.equal(ui.run('state.chat.intakeContext.answers[0].value'),'custom-option');
 assert.match(ui.app.innerHTML,/외부 선택지/);
});

test('Questionnaire browser module is served while the server implementation stays private',async()=>{
 const server=await startServer({port:0,log:()=>{}});
 try{
  const base='http://127.0.0.1:'+server.address().port;
  const response=await fetch(base+'/intake-data.mjs');
  assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/javascript/);
  assert.match(await response.text(),/normalizeIntakeQuestionnaire/);
  assert.equal((await fetch(base+'/server.mjs')).status,404);
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('Report retains edited content when a choice changes; reload and copy include the updated raw answer',async()=>{
 const ui=mountApp({source:null});choose(ui);submit(ui);choose(ui);submit(ui);submit(ui);
 ui.document.getElementById('intake-report').click();ui.document.getElementById('report-edit').click();
 ui.document.getElementById('report-notes').value='Edited report notes';ui.document.getElementById('report-editor').emit('submit');
 ui.run("navigate('entry')");ui.document.querySelectorAll('[data-intake-edit]')[0].click();
 choose(ui,1);submit(ui);submit(ui);submit(ui);ui.document.getElementById('intake-report').click();
 assert.match(ui.app.innerHTML,/report-source-notice/);assert.match(ui.app.innerHTML,/Edited report notes/);
 ui.document.getElementById('report-reset').click();assert.match(ui.app.innerHTML,/문진 1: 선지 2/);
 ui.run("globalThis.copied='';globalThis.navigator={clipboard:{writeText:async text=>{copied=text}}}");
 await ui.document.getElementById('report-copy').emit('click');
 assert.match(ui.run('copied'),/문진 1: 선지 2/);assert.match(ui.run('copied'),/문진 2: 선지 1/);
});

test('Optional notes are bounded independently and submitted alongside both choice answers',()=>{
 const ui=mountApp({source:null});choose(ui);submit(ui);choose(ui,1);submit(ui);
 ui.document.getElementById('intake-symptom').value='x'.repeat(1200);submit(ui);
 assert.equal(ui.run('state.draft.symptom.length'),1000);submit(ui);
 assert.equal(ui.run('state.chat.intakeContext.symptom.length'),1000);
 assert.equal(ui.run('state.chat.intakeContext.answers[0].value'),'option-1');
 assert.equal(ui.run('state.chat.intakeContext.answers[1].value'),'option-2');
 assert.equal(ui.run('state.chat.intakeContext.onset'),'');
});

test('Question count from data controls the final free question position and the review edit target',()=>{
 for(const count of [1,3,5]){
  const ui=mountApp({source:null});const data=fixture();
  data.questions=Array.from({length:count},(_,i)=>({...structuredClone(data.questions[0]),id:'q-'+i,label:{ko:'문진 '+(i+1)}}));
  apply(ui,data);
  for(let i=0;i<count;i++){
   assert.equal(ui.document.getElementById('intake-symptom'),null);
   choose(ui);submit(ui);
  }
  assert.equal(ui.run('state.intakeStep'),count);
  ui.document.getElementById('intake-symptom').value='마지막 기타 사항';submit(ui);
  ui.document.querySelectorAll('[data-intake-edit]').find(n=>n.dataset.intakeEdit===String(count)).click();
  assert.equal(ui.document.getElementById('intake-symptom').value,'마지막 기타 사항');
  submit(ui);submit(ui);
  assert.equal(ui.run('state.view'),'explore');assert.equal(ui.run('state.chat.intakeContext.answers.length'),count);
  assert.equal(ui.run('state.chat.intakeContext.symptom'),'마지막 기타 사항');
 }
});
