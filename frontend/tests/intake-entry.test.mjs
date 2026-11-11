import test from 'node:test';
import assert from 'node:assert/strict';
import {mountApp} from './dom-harness.mjs';
const submit=ui=>ui.document.getElementById('intake-wizard').emit('submit');
const choose=(ui,value='option-1')=>ui.document.querySelectorAll('[data-intake-option]').find(n=>n.dataset.intakeOption===value).click();
const toOther=ui=>{choose(ui);submit(ui);choose(ui,'option-2');submit(ui);};
const toReview=ui=>{toOther(ui);submit(ui);};

test('Choice questions precede a separate optional free question; neither choice shows a textarea',()=>{
 const ui=mountApp({source:null});
 assert.match(ui.app.innerHTML,/문진 1/);assert.equal(ui.document.getElementById('intake-symptom'),null);
 submit(ui);assert.equal(ui.run('state.intakeStep'),0);assert.equal(ui.document.getElementById('intake-error').hidden,false);
 choose(ui);ui.document.getElementById('theme').click();ui.document.getElementById('language').click();
 assert.equal(ui.document.querySelector('[data-intake-option]').attributes['aria-pressed'],'true');
 submit(ui);assert.equal(ui.run('state.intakeStep'),1);assert.equal(ui.document.getElementById('intake-symptom'),null);
 submit(ui);assert.equal(ui.run('state.intakeStep'),1);
 choose(ui,'unknown');submit(ui);assert.equal(ui.run('state.intakeStep'),2);
 assert.ok(ui.document.getElementById('intake-symptom'));
 assert.equal(ui.document.querySelectorAll('[data-intake-option]').length,0);
 submit(ui);assert.equal(ui.run('state.intakeStep'),3,'Other information may be left blank');
});

test('Selections and other information survive backtracking; review edits return to their original steps',()=>{
 const ui=mountApp({source:null});toOther(ui);
 ui.document.getElementById('intake-symptom').value='<script>기타 사항</script>';
 ui.document.getElementById('intake-region').value='춘천';
 ui.document.getElementById('theme').click();ui.document.getElementById('language').click();
 assert.equal(ui.document.getElementById('intake-symptom').value,'<script>기타 사항</script>');
 ui.document.getElementById('intake-back').click();assert.equal(ui.run('state.intakeStep'),1);
 assert.equal(ui.run("state.intakeAnswers['question-2']"),'option-2');
 submit(ui);assert.equal(ui.document.getElementById('intake-region').value,'춘천');
 submit(ui);assert.match(ui.app.innerHTML,/&lt;script&gt;기타 사항/);
 ui.document.querySelectorAll('[data-intake-edit]').find(n=>n.dataset.intakeEdit==='2').click();
 assert.ok(ui.document.getElementById('intake-symptom'));assert.equal(ui.run('state.intakeStep'),2);
 submit(ui);ui.document.getElementById('intake-report').click();
 assert.equal(ui.run('state.view'),'report');assert.match(ui.app.innerHTML,/&lt;script&gt;기타 사항/);
 assert.match(ui.app.innerHTML,/Question 1: Option 1/);assert.match(ui.app.innerHTML,/Question 2: Option 2/);
 assert.equal(ui.run('state.draft.onset'),'');
});

test('Completing intake with blank other information opens search with versioned selections and no invented specialty',()=>{
 const ui=mountApp({source:null});toOther(ui);
 ui.document.getElementById('intake-region').value='춘천';submit(ui);submit(ui);
 assert.equal(ui.run('state.view'),'explore');assert.equal(ui.run('state.chat.intakeContext.region'),'춘천');
 assert.equal(ui.run('state.chat.intakeContext.symptom'),'');
 assert.equal(ui.run('state.chat.intakeContext.answers[0].value'),'option-1');
 assert.equal(ui.run('state.chat.intakeContext.answers[1].value'),'option-2');
 assert.equal(ui.run('state.chat.messages.length'),0);
 assert.equal(ui.run('state.search.criteria.sort'),'distance');assert.equal(ui.run('state.search.criteria.department'),'all');
 ui.document.getElementById('chat-close').click();ui.document.getElementById('review-intake').click();
 assert.equal(ui.run('state.chat.open'),true);
 assert.equal(ui.document.activeElement,ui.document.getElementById('chat-intake-context'));
 ui.run("navigate('entry')");
 ui.document.querySelectorAll('[data-intake-edit]').find(n=>n.dataset.intakeEdit==='0').click();
 choose(ui,'unknown');submit(ui);submit(ui);
 ui.document.getElementById('intake-symptom').value='<img src=x onerror=alert(1)>';
 submit(ui);submit(ui);
 assert.equal(ui.run('state.chat.intakeContext.answers[0].value'),'unknown');
 assert.equal(ui.document.querySelectorAll('.chat-intake-context').length,1);
 assert.match(ui.app.innerHTML,/&lt;img src=x/);assert.doesNotMatch(ui.app.innerHTML,/<img src=x/);
});

test('Skipping remains possible on every question step and preserves pending other information',()=>{
 for(const step of [0,1,2]){
  const ui=mountApp({source:null});
  if(step>=1){choose(ui);submit(ui);}
  if(step===2){choose(ui);submit(ui);ui.document.getElementById('intake-symptom').value='기타 사항';}
  ui.document.getElementById('skip').click();
  assert.equal(ui.run('state.view'),'explore');assert.ok(ui.document.getElementById('search-form'));
  assert.equal(ui.run('state.draft.symptom'),step===2?'기타 사항':'');assert.equal(ui.run('state.chat.intakeContext'),undefined);
 }
});

test('Submitted choices and final free answer survive follow-up and language changes without duplication',()=>{
 const ui=mountApp({source:null});toOther(ui);
 ui.document.getElementById('intake-symptom').value='More context';submit(ui);submit(ui);
 ui.document.getElementById('composer-input').value='Follow up';ui.document.getElementById('composer-form').emit('submit');
 assert.equal(ui.run('state.chat.intakeContext.symptom'),'More context');
 assert.equal(ui.run('state.chat.intakeContext.onset'),'');assert.equal(ui.run('state.chat.messages.length'),1);
 ui.document.getElementById('language').click();ui.run("navigate('entry');navigate('explore')");
 assert.equal(ui.run('state.chat.intakeContext.answers[1].value'),'option-2');
 assert.match(ui.app.innerHTML,/Other information/);assert.match(ui.app.innerHTML,/More context/);
 assert.equal(ui.run('state.suggestion?.department'),'all');
});

test('Manual search does not claim an intake or show the intake review action',()=>{
 const ui=mountApp({source:null});ui.document.getElementById('skip').click();
 assert.equal(ui.document.getElementById('review-intake'),null);assert.equal(ui.run('state.chat.intakeContext'),undefined);
});

test('Completing a new intake resets filters and preserves unsent conversation input',()=>{
 const ui=mountApp({source:null});
 ui.run("state.search.initialized=true;state.search.department='dental';state.type='hospital';state.search.openOnly=true;state.search.criteria={...emptyCriteria(),department:'dental',openOnly:true}");
 toReview(ui);ui.document.getElementById('composer-input').value='Unsent follow-up';submit(ui);
 assert.equal(ui.run('state.view'),'explore');
 assert.equal(ui.run('state.search.department'),'all');assert.equal(ui.run('state.type'),'all');
 assert.equal(ui.run('state.search.openOnly'),false);assert.equal(ui.document.getElementById('composer-input').value,'Unsent follow-up');
 assert.equal(ui.run('state.search.criteria.sort'),'distance');assert.match(ui.app.innerHTML,/현재 정렬:/);
 ui.run("state.search.criteria.sort='name';render()");assert.match(ui.app.innerHTML,/이름순/);
});

test('Final-step area takes precedence while a blank area reuses the actual location',()=>{
 for(const region of ['', 'Seoul']){
  const ui=mountApp({source:null});
  ui.run("state.live.position={lat:37.87,lng:127.74,accuracy:200};state.live.locationAttempted=true");
  toOther(ui);ui.document.getElementById('intake-region').value=region;submit(ui);submit(ui);
  assert.equal(ui.run('state.view'),'explore');assert.equal(ui.run('state.search.criteria.region'),region);
  if(region)assert.equal(ui.run('state.search.criteria.center'),undefined);
  else{assert.equal(ui.run('state.search.criteria.center.lat'),37.87);assert.equal(ui.run('state.search.criteria.center.lng'),127.74);}
 }
});
