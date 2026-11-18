import assert from 'node:assert/strict';
import test from 'node:test';
import {consumeSpokenAnswer, matchSpokenOption, rememberSpokenAnswer} from '../voice-answer.mjs';
import {mountApp} from './dom-harness.mjs';

const yes={id:'yes',label:{ko:'예, 괜찮아요'}};
const no={id:'no',label:{ko:'아니요, 불편해요'}};
const unsure={id:'unsure',label:{ko:'잘 모르겠어요'}};
const question={id:'N1',type:'singleChoice',required:true,label:{ko:'지금 괜찮으세요?'},options:[yes,no,unsure]};

test('recognizes informal Korean options and leaves conflicting or unmatched answers alone',()=>{
 for(const text of ['응, 괜찮아','네 괜찮습니다','괜찮아.']) assert.equal(matchSpokenOption(text,question.options),yes);
 assert.equal(matchSpokenOption('잘 모르겠어',question.options),unsure);
 for(const text of ['아니 괜찮아','응','응, 괜찮지 않아','괜찮아 근데 어지러워']) assert.equal(matchSpokenOption(text,question.options),null);
 assert.equal(matchSpokenOption('괜찮아',[yes,{id:'duplicate',label:{ko:'괜찮아요'}}]),null);
});

test('a transcript binds to the question at recording time and is consumed once',()=>{
 const input={};
 rememberSpokenAnswer(input,'응 괜찮아',question);
 assert.equal(consumeSpokenAnswer(input,'응 괜찮아',{...question}),null);
 rememberSpokenAnswer(input,'응 괜찮아',question);
 assert.equal(consumeSpokenAnswer(input,'응 괜찮아',question),yes);
 assert.equal(consumeSpokenAnswer(input,'응 괜찮아',question),null);
});

test('submitting an informal transcript sends the same follow-up payload as clicking the option',async()=>{
 const ui=mountApp({source:null});
 ui.run('globalThis.requests=[];setAssistantAdapter(async payload=>{requests.push(payload);return {followUp:'+JSON.stringify(question)+'};});state.workspace=createWorkspace();viewRenderer=()=>{};render=()=>{};');
 ui.run("submitChatText('목이 아파요')");
 await new Promise(resolve=>setImmediate(resolve));
 ui.app.innerHTML='<form id="composer-form"><textarea id="composer-input"></textarea></form>';
 const input=ui.document.getElementById('composer-input');
 input.value='응 괜찮아';
 ui.run("rememberSpokenAnswer(document.getElementById('composer-input'), '응 괜찮아', state.assistant.response.followUp)");
 ui.run('bind()');
 ui.document.getElementById('composer-form').requestSubmit();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(ui.run('requests.length'),2);
 assert.equal(ui.run('requests[1].reason'),'followup');
 assert.equal(ui.run('requests[1].followUpAnswers[0].value'),'yes');
 assert.equal(ui.run('requests[1].messages.length'),1);
 assert.equal(input.value,'');
});
