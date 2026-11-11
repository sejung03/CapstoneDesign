import test from 'node:test';
import assert from 'node:assert/strict';
import {mountApp} from './dom-harness.mjs';

test('first chat input waits for intake, and intake completion requests assistance even without a final free note',()=>{
 const ui=mountApp({source:null});
 Object.getPrototypeOf(ui.document.getElementById('composer-input')).removeEventListener=function(type,handler){this.events.set(type,(this.events.get(type)||[]).filter(value=>value!==handler));this.listeners--;};
 for(const id of ['composer-form','intake-wizard'])ui.document.getElementById(id).events.clear();
 // Retain the harness DOM while exercising the production React-controller branch.
 ui.run("state.workspace=createWorkspace();viewRenderer=()=>{};globalThis.requestReasons=[];requestAssistant=async reason=>{requestReasons.push(reason);};state.source='demo';bind();");
 const composer=ui.document.getElementById('composer-input');composer.value='처음 작성한 불편한 점';ui.document.getElementById('composer-form').requestSubmit();
 assert.equal(ui.run('state.workspace.intake'),true);assert.equal(ui.run('state.chat.messages[0].text'),'처음 작성한 불편한 점');assert.equal(ui.run('requestReasons.length'),0);assert.equal(ui.run('state.search.initialized'),false);
 ui.run("state.intakeAnswers=Object.fromEntries(state.intakeQuestionnaire.questions.map(q=>[q.id,q.options[0].id]));state.intakeStep=state.intakeQuestionnaire.questions.length+1;state.draft.symptom='';");
 ui.document.getElementById('intake-wizard').requestSubmit();
 assert.equal(ui.run('state.workspace.intake'),false);assert.equal(ui.run('requestReasons.join()'),'intake');assert.equal(ui.run('state.chat.intakeContext.symptom'),'');assert.equal(ui.run('state.chat.messages[0].text'),'처음 작성한 불편한 점');assert.equal(ui.storage.size,0);
});
