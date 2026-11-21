import assert from 'node:assert/strict';
import test from 'node:test';
import {consumeSpokenAnswer, matchSpokenOption, rememberSpokenAnswer, spokenChoiceNumber} from '../voice-answer.mjs';
import {mountApp} from './dom-harness.mjs';

const yes={id:'yes',label:{ko:'예, 괜찮아요'}};
const no={id:'no',label:{ko:'아니요, 불편해요'}};
const unsure={id:'unsure',label:{ko:'잘 모르겠어요'}};
const question={id:'N1',type:'singleChoice',required:true,label:{ko:'지금 괜찮으세요?'},options:[yes,no,unsure]};

test('recognizes informal Korean options and leaves conflicting or unmatched answers alone',()=>{
 for(const text of ['예','네','응','응, 괜찮아','네 괜찮습니다','괜찮아.']) assert.equal(matchSpokenOption(text,question.options),yes);
 for(const text of ['아니요','아니오','아뇨']) assert.equal(matchSpokenOption(text,question.options),no);
 for(const text of ['잘 모르겠어요','모르겠어요','모름']) assert.equal(matchSpokenOption(text,question.options),unsure);
 assert.equal(matchSpokenOption('예',[yes,{id:'other',label:{ko:'예, 조금 아파요'}}]),null);
 assert.equal(matchSpokenOption('아니오',[yes,unsure]),null);
 for(const text of ['아니 괜찮아','응, 괜찮지 않아','괜찮아 근데 어지러워']) assert.equal(matchSpokenOption(text,question.options),null);
 assert.equal(matchSpokenOption('괜찮아',[yes,{id:'duplicate',label:{ko:'괜찮아요'}}]),null);
});

test('recognizes explicit ordinals without treating a pain score as a position',()=>{
 assert.equal(spokenChoiceNumber(1),'일 번');
 assert.equal(spokenChoiceNumber(2),'이 번');
 for(const text of ['1번','일 번','일번이요','한 번','첫 번째']) assert.equal(matchSpokenOption(text,question.options),yes);
 for(const text of ['2', '이', '2번', '２번이요.', '이 번', '이번입니다', '두 번', '두 번째요', '선택지 2번']) {
  assert.equal(matchSpokenOption(text,question.options),no);
 }
 for(const text of ['니', '안녕', '2.5', '4번', '2번이나 3번','일 번이나 이 번', '아니요 2번']) {
  assert.equal(matchSpokenOption(text,question.options),null);
 }
 const extra={id:'fourth',label:{ko:'오래 전'}};
 assert.equal(matchSpokenOption('네 번째요',[...question.options,extra]),extra);
 const scores=[{id:'zero',label:{ko:'0'}},{id:'one',label:{ko:'1'}},{id:'two',label:{ko:'2'}}];
 assert.equal(matchSpokenOption('2',scores),scores[2]);
 assert.equal(matchSpokenOption('2번',scores),scores[1]);
 assert.equal(matchSpokenOption('3',scores),null);
});

test('a transcript binds to the question at recording time and is consumed once',()=>{
 const input={};
 rememberSpokenAnswer(input,'응 괜찮아',question);
 assert.equal(consumeSpokenAnswer(input,'응 괜찮아',{...question}),null);
 rememberSpokenAnswer(input,'응 괜찮아',question);
 assert.equal(consumeSpokenAnswer(input,'응 괜찮아',question),yes);
 assert.equal(consumeSpokenAnswer(input,'응 괜찮아',question),null);
});

test('submitting an ordinal transcript sends the same follow-up payload as clicking the option',async()=>{
 const ui=mountApp({source:null});
 ui.run('globalThis.requests=[];setAssistantAdapter(async payload=>{requests.push(payload);return {followUp:'+JSON.stringify(question)+'};});state.workspace=createWorkspace();viewRenderer=()=>{};render=()=>{};');
 ui.run("submitChatText('목이 아파요')");
 await new Promise(resolve=>setImmediate(resolve));
 ui.app.innerHTML='<form id="composer-form"><textarea id="composer-input"></textarea></form>';
 const input=ui.document.getElementById('composer-input');
 input.value='이 번';
 ui.run("rememberSpokenAnswer(document.getElementById('composer-input'), '이 번', state.assistant.response.followUp)");
 ui.run('bind()');
 ui.document.getElementById('composer-form').requestSubmit();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(ui.run('requests.length'),2);
 assert.equal(ui.run('requests[1].reason'),'followup');
 assert.equal(ui.run('requests[1].followUpAnswers[0].value'),'no');
 assert.equal(ui.run('requests[1].messages.length'),1);
 assert.equal(input.value,'');
});

test('localized short replies and numbered options resolve only one visible answer',()=>{
 const positive={id:'yes',label:{ko:'예, 괜찮아요',en:'Yes, I feel fine'}};
 const negative={id:'no',label:{ko:'아니요, 이상해요',en:'No, something feels wrong'}};
 const unknown={id:'unknown',label:{ko:'잘 모르겠어요',en:'Not sure'}};
 const options=[positive,negative,unknown];
 for(const [locale,yes,no,unsure,ordinal] of [
  ['en','Yes.','No','Not sure','option two'],
  ['zh','是','不是','不确定','选项二'],
  ['vi','có','không','không chắc','phương án hai'],
  ['uz','ha','yo‘q','bilmayman','variant ikki'],
 ]){
  assert.equal(matchSpokenOption(yes,options,locale),positive);
  assert.equal(matchSpokenOption(no,options,locale),negative);
  assert.equal(matchSpokenOption(unsure,options,locale),unknown);
  assert.equal(matchSpokenOption(ordinal,options,locale),negative);
 }
 assert.equal(matchSpokenOption('yes',[...options,{id:'alt',label:{ko:'네, 조금 불편해요',en:'Yes'}}],'en'),null);
 assert.equal(matchSpokenOption('2',options,'en'),negative);
 for(const reply of ['no option two','option two or three','option 9'])assert.equal(matchSpokenOption(reply,options,'en'),null);
 assert.equal(spokenChoiceNumber(2,'en'),'Option 2');
 const input={}, followUp={options};
 rememberSpokenAnswer(input,'option two',followUp,'en');
 assert.equal(consumeSpokenAnswer(input,'option two',followUp),negative);
});

test('typed choices follow the active question, then an explicit search skips the assistant',async()=>{
 const ui=mountApp({source:null});
 ui.run('globalThis.requests=[];setAssistantAdapter(async payload=>{requests.push(payload);return {followUp:'+JSON.stringify(question)+'};});state.workspace=createWorkspace();viewRenderer=()=>{};render=()=>{};');
 ui.run("submitChatText('다리가 불편해요')");
 await new Promise(resolve=>setImmediate(resolve));
 ui.app.innerHTML='<form id="composer-form"><textarea id="composer-input"></textarea></form>';
 ui.run('bind()');
 const input=ui.document.getElementById('composer-input'),form=ui.document.getElementById('composer-form');
 for(const [value,option] of [['예','yes'],['아니요','no'],['잘 모르겠어요','unsure'],['1','yes'],['2','no'],['3','unsure'],['2번','no']]){
  input.value=value;form.requestSubmit();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(ui.run('requests.at(-1).reason'),'followup');
  assert.equal(ui.run('requests.at(-1).followUpAnswers[0].value'),option);
  assert.equal(ui.run('requests.at(-1).messages.length'),1);
 }
 const count=ui.run('requests.length');
 input.value='지금 운영하는 정형외과 찾아줘';form.requestSubmit();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(ui.run('requests.length'),count);
 assert.equal(ui.run('state.assistant.response'),null);
 assert.equal(ui.run('state.assistant.answers[0].value'),'no');
 assert.equal(ui.run('state.search.criteria.department'),'orthopedics');
 assert.equal(ui.run('state.search.criteria.openOnly'),true);
 assert.equal(ui.run('state.view'),'explore');
 assert.equal(input.value,'');
});

test('direct search only recognizes explicit search conditions and leaves symptom messages for intake',async()=>{
 const {directCareSearch}=await import('../care-context.mjs');
 assert.equal(directCareSearch('춘천에서 지금 운영 중인 정형외과 찾아주세요').region,'춘천');
 assert.equal(directCareSearch('지금 문 연 약국을 찾아줘').type,'pharmacy');
 assert.equal(directCareSearch('병원 찾아줘',{}, {department:'pharmacy',openOnly:true}).openOnly,false);
 for(const text of ['정형외과 진료받았어요','다리가 아파요. 정형외과 찾아줘','숨 쉬기 힘들어요. 병원 찾아줘','119 찾아줘','정형외과 말고 병원 찾아줘','언제 정형외과를 찾아야 하나요?']){
  assert.equal(directCareSearch(text),null,text);
 }
});
