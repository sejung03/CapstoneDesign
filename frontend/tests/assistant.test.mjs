import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeAssistantResponse,assistantContent,assistantReportNotes,createAssistantState} from '../assistant.mjs';
import {mockIntakeQuestionnaire} from '../intake-data.mjs';
import {mountApp} from './dom-harness.mjs';
import {startServer} from '../server.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const send=(ui,text)=>{ui.document.getElementById('composer-input').value=text;ui.document.getElementById('composer-form').emit('submit');};
const submit=ui=>ui.document.getElementById('intake-wizard').emit('submit');
const toOther=ui=>{for(let i=0;i<2;i++){ui.document.querySelector('[data-intake-option]').click();submit(ui);}};
const setup=()=>{
 const ui=mountApp({source:null});
 ui.run("globalThis.requests=[];setAssistantAdapter(async payload=>{requests.push(payload);return {summary:{ko:'입력한 상황 요약',en:'Input summary'},search:{department:'dental',mode:'traffic',openOnly:true}}})");
 return ui;
};

test('Response schema permits supported filters and question IDs from the supplied protocol only',()=>{
 const response=normalizeAssistantResponse({summary:{ko:'요약'},followUpQuestionId:'question-1',search:{department:'dental',mode:'traffic'}},mockIntakeQuestionnaire);
 assert.equal(response.search.type,'hospital');assert.equal(response.followUp.label.ko,'문진 1');
 response.followUp.label.ko='changed';assert.equal(mockIntakeQuestionnaire.questions[0].label.ko,'문진 1');
 for(const raw of [
  {},{summary:{ko:''}},{summary:{ko:'x'.repeat(2001)}},{followUpQuestionId:'invented'},
  {search:{department:'invented'}},{search:{type:'pharmacy',department:'dental'}},
  {search:{openOnly:'yes'}},{search:{visitTime:'19:00'}},{search:{mode:'bike'}},
  {search:{region:'x'.repeat(81)}}
 ])assert.throws(()=>normalizeAssistantResponse(raw,mockIntakeQuestionnaire),TypeError);
});

test('Context uses explicit user input and selected profile fields, without identity or coordinates',()=>{
 const value=assistantContent({profile:{nickname:'name',age:'30',allergies:'allergy',password:'secret'},chat:{intakeContext:{symptom:'note'},messages:[{role:'user',text:'input'},{role:'assistant',text:'not user input'}]},assistant:createAssistantState(),live:{position:{lat:37,lng:127}}});
 assert.deepEqual(value.messages,['input']);assert.equal(value.profile.nickname,undefined);assert.equal(value.profile.password,undefined);
 assert.equal(value.profile.allergies,'allergy');assert.equal(value.position,undefined);
});

test('Without an adapter the ordinary chat, intake and search remain usable and no summary is invented',()=>{
 const ui=mountApp({source:null});send(ui,'서울 병원');
 assert.equal(ui.run('state.assistant.status'),'disconnected');assert.equal(ui.document.getElementById('assistant-confirm'),null);
 assert.doesNotMatch(ui.app.innerHTML,/AI 답변은 아직 제공하지 않아요/);
 ui.document.getElementById('skip').click();assert.ok(ui.document.getElementById('search-form'));
 assert.equal(ui.storage.size,0);
});

test('Only free input triggers the adapter after intake; choices with a blank final answer never do',async()=>{
 const ui=setup();toOther(ui);submit(ui);submit(ui);await tick();
 assert.equal(ui.run('requests.length'),0);assert.equal(ui.run('state.view'),'explore');
 ui.run("navigate('entry');state.intakeStep=2;render()");
 ui.document.getElementById('intake-symptom').value='기타 상황';submit(ui);submit(ui);await tick();
 assert.equal(ui.run('requests.length'),1);assert.equal(ui.run('requests[0].reason'),'intake');
 assert.equal(ui.run('requests[0].intake.symptom'),'기타 상황');
 assert.equal(ui.run('requests[0].intake.answers.length'),2);
});

test('Summary is escaped, editable across rerenders, and enters the report only after confirmation',async()=>{
 const ui=setup();ui.run("setAssistantAdapter(async()=>({summary:{ko:'<img src=x onerror=alert(1)>'}}))");
 send(ui,'user note');await tick();
 assert.match(ui.app.innerHTML,/&lt;img src=x/);assert.doesNotMatch(ui.app.innerHTML,/<img src=x/);
 assert.equal(ui.run('assistantReportNotes(state)'),'');
 ui.document.getElementById('assistant-edit').click();ui.document.getElementById('assistant-summary').value='사용자가 고친 요약';
 ui.document.getElementById('theme').click();assert.equal(ui.document.getElementById('assistant-summary').value,'사용자가 고친 요약');
 ui.document.getElementById('assistant-confirm').click();
 assert.match(ui.run('assistantReportNotes(state)'),/사용자가 고친 요약/);
 ui.document.getElementById('assistant-edit').click();ui.document.getElementById('assistant-summary').value='취소할 수정';
 ui.document.getElementById('assistant-edit').click();
 assert.equal(ui.run('state.assistant.confirmed.text'),'사용자가 고친 요약');
 ui.run("navigate('report')");assert.match(ui.app.innerHTML,/확인한 상황 요약: 사용자가 고친 요약/);
 assert.deepEqual([...ui.storage.keys()].sort(),['medical-language','medical-theme'],'Only display preferences are stored');
 assert.equal(ui.storage.has('medical-report'),false);
});

test('Search proposal requires an explicit click and applies supported filters without inventing recommendation order',async()=>{
 const ui=setup();
 ui.run("state.live.position={lat:37.87,lng:127.74};state.search.criteria={...emptyCriteria(),center:{lat:37.87,lng:127.74},region:'',type:'all'};state.search.criteria=liveCriteria(state.search.criteria)");
 const before=ui.run('JSON.stringify(state.search.criteria)');
 send(ui,'대중교통으로 갈 수 있는 치과');await tick();
 assert.equal(ui.run('JSON.stringify(state.search.criteria)'),before);
 ui.document.getElementById('assistant-confirm').click();
 ui.document.getElementById('assistant-apply').click();
 assert.equal(ui.run('state.view'),'explore');assert.equal(ui.run('state.search.criteria.department'),'dental');
 assert.equal(ui.run('state.search.criteria.openOnly'),true);assert.equal(ui.run('state.routing.mode'),'traffic');
 assert.equal(ui.run('state.search.criteria.center.lat'),37.87);assert.equal(ui.run('state.search.criteria.sort'),'distance');
 assert.equal(ui.run('state.assistant.applied'),true);assert.equal(ui.run('state.chat.open'),true);
 assert.match(ui.run('assistantReportNotes(state)'),/입력한 상황 요약/,'Changing search conditions does not invalidate a confirmed content summary');
});

test('Changing search conditions prevents applying an old proposal without discarding its content summary',async()=>{
 const ui=setup();send(ui,'서울');await tick();
 ui.run("state.search.criteria.region='부산';render()");
 ui.document.getElementById('assistant-apply').click();
 assert.equal(ui.run('state.search.criteria.region'),'부산');assert.equal(ui.run('state.assistant.applied'),false);
 assert.match(ui.app.innerHTML,/검색 조건이 바뀌었어요/);
 ui.document.getElementById('assistant-confirm').click();assert.match(ui.run('assistantReportNotes(state)'),/입력한 상황 요약/);
});

test('A follow-up selects text only from the provided question bank and records the exact choice once',async()=>{
 const ui=mountApp({source:null});
 ui.run("globalThis.requests=[];setAssistantAdapter(async payload=>{requests.push(payload);return payload.reason==='followup'?{summary:{ko:'답변을 반영한 요약'}}:{followUpQuestionId:'question-1'}},{questionnaire:mockIntakeQuestionnaire})");
 send(ui,'추가 설명');await tick();
 assert.match(ui.app.innerHTML,/문진 1/);
 ui.document.querySelectorAll('[data-assistant-option]')[1].click();await tick();
 assert.equal(ui.run('requests.length'),2);assert.equal(ui.run('requests[1].reason'),'followup');
 assert.equal(ui.run('requests[1].followUpAnswers[0].value'),'option-2');
 assert.equal(ui.run('state.chat.messages.length'),1);
 assert.match(ui.run('assistantReportNotes(state)'),/문진 1: 선지 2/);
 assert.match(ui.app.innerHTML,/답변을 반영한 요약/);
});

test('New user input supersedes an older pending response and old confirmed summaries stop entering the report',async()=>{
 const ui=mountApp({source:null});
 ui.run("globalThis.pending=[];setAssistantAdapter((payload,{signal})=>new Promise(resolve=>pending.push({payload,signal,resolve})))");
 send(ui,'first');await tick();send(ui,'second');await tick();
 assert.equal(ui.run('pending[0].signal.aborted'),true);
 ui.run("pending[1].resolve({summary:{ko:'new'}})");await tick();
 ui.document.getElementById('assistant-confirm').click();assert.match(ui.run('assistantReportNotes(state)'),/new/);
 ui.run("pending[0].resolve({summary:{ko:'old'}})");await tick();
 assert.equal(ui.run('state.assistant.response.summary.ko'),'new');
 send(ui,'third');await tick();assert.equal(ui.run('assistantReportNotes(state)'),'');
 ui.run("pending[2].resolve({summary:{ko:'third'}})");await tick();
});

test('Eight-second timeout aborts the request, shows a generic error, and retry preserves unsent input',async()=>{
 const ui=mountApp({source:null});
 ui.run("globalThis.deadlines=[];globalThis.setTimeout=(callback,delay)=>{deadlines.push({callback,delay});return deadlines.length};globalThis.lastSignal=null;setAssistantAdapter((payload,{signal})=>{lastSignal=signal;return new Promise(()=>{})})");
 send(ui,'note');await tick();
 assert.equal(ui.run('deadlines.at(-1).delay'),8000);
 ui.document.getElementById('composer-input').value='unsent';
 ui.run('deadlines.at(-1).callback()');await tick();
 assert.equal(ui.run('lastSignal.aborted'),true);assert.equal(ui.run('state.assistant.status'),'error');
 assert.equal(ui.document.getElementById('composer-input').value,'unsent');
 assert.ok(ui.document.getElementById('assistant-retry'));
 ui.run("assistantAdapter=async()=>({summary:{ko:'retried'}})");
 ui.document.getElementById('assistant-retry').click();await tick();
 assert.equal(ui.run('state.assistant.response.summary.ko'),'retried');
 assert.equal(ui.document.getElementById('composer-input').value,'unsent');
});

test('Malformed or failed responses do not expose raw errors or silently apply partial conditions',async()=>{
 for(const body of ["throw new Error('private-key-in-upstream-error')","return {summary:{ko:'ignore this'},search:{visitTime:'19:00'}}"]){
  const ui=mountApp({source:null});ui.run('setAssistantAdapter(async()=>{'+body+'})');send(ui,'note');await tick();
  assert.equal(ui.run('state.assistant.status'),'error');assert.equal(ui.run('state.assistant.response'),null);
  assert.doesNotMatch(ui.app.innerHTML,/private-key-in-upstream-error|ignore this/);
  ui.document.getElementById('skip').click();assert.ok(ui.document.getElementById('search-form'));
 }
});

test('A new confirmed summary raises a report source notice without overwriting user edits',async()=>{
 const ui=setup();send(ui,'note');await tick();ui.document.getElementById('assistant-confirm').click();
 ui.run("navigate('report')");ui.document.getElementById('report-edit').click();
 ui.document.getElementById('report-notes').value='my edited report';ui.document.getElementById('report-editor').emit('submit');
 send(ui,'more');await tick();ui.document.getElementById('assistant-edit').click();
 ui.document.getElementById('assistant-summary').value='new confirmed summary';ui.document.getElementById('assistant-confirm').click();
 assert.match(ui.app.innerHTML,/report-source-notice/);assert.equal(ui.run('state.report.saved.notes'),'my edited report');
 ui.document.getElementById('report-reset').click();assert.match(ui.app.innerHTML,/new confirmed summary/);
});

test('Disabling or replacing an adapter cancels pending work and does not pass old input to the new adapter',async()=>{
 const ui=mountApp({source:null});ui.run("globalThis.calls=0;setAssistantAdapter(async()=>{calls++;return {summary:{ko:'old'}}})");
 send(ui,'note');ui.run("setAssistantAdapter(null)");await tick();
 assert.equal(ui.run('calls'),0);assert.equal(ui.run('state.assistant.status'),'disconnected');
 assert.equal(ui.document.getElementById('assistant-confirm'),null);
});

test('Assistant browser module is served without exposing server implementation or adding an endpoint',async()=>{
 const server=await startServer({port:0,log:()=>{}});
 try{
  const base='http://127.0.0.1:'+server.address().port;
  const response=await fetch(base+'/assistant.mjs');assert.equal(response.status,200);
  assert.match(response.headers.get('content-type'),/javascript/);
  assert.equal((await fetch(base+'/api/assistant')).status,404);
  assert.equal((await fetch(base+'/server.mjs')).status,404);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
