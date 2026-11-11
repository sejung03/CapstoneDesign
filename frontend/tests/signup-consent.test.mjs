import test from 'node:test';
import assert from 'node:assert/strict';
import {signupConsentPolicy,emptySignupChoices,changeSignupChoice,buildSignupConsentSelection} from '../signup-consent.mjs';
import {mountApp} from './dom-harness.mjs';
test('signup choices start unchecked, separate sensitive processing and optional storage, without creating server consent receipts',()=>{
 const empty=emptySignupChoices();assert.ok(Object.values(empty).every(value=>value===false));
 assert.throws(()=>buildSignupConsentSelection(empty),/Required/);
 let choices=changeSignupChoice(empty,'terms',true);choices=changeSignupChoice(choices,'account',true);
 const record=buildSignupConsentSelection(choices);assert.equal(record.persisted,false);assert.equal(record.acceptedAt,undefined);
 assert.equal(record.decisions.find(value=>value.id==='healthStorage').agreed,false);
 assert.equal(record.decisions.find(value=>value.id==='healthProcessing').agreed,false);
 assert.equal(signupConsentPolicy.operationalReady,false);assert.ok(signupConsentPolicy.unresolved.includes('aiProviderAndProcessing'));
 assert.ok(signupConsentPolicy.sections.every(section=>section.title.ko&&section.title.en));
});
test('storage choices depend on health processing and unchecking processing clears dependents',()=>{
 let choices=changeSignupChoice(emptySignupChoices(),'healthStorage',true);assert.equal(choices.healthStorage,false);
 choices=changeSignupChoice(choices,'healthProcessing',true);choices=changeSignupChoice(choices,'healthStorage',true);choices=changeSignupChoice(choices,'reportStorage',true);
 assert.equal(choices.healthStorage,true);choices=changeSignupChoice(choices,'healthProcessing',false);
 assert.equal(choices.healthStorage,false);assert.equal(choices.reportStorage,false);
 assert.throws(()=>changeSignupChoice(choices,'unknown',true),TypeError);
 assert.throws(()=>buildSignupConsentSelection({...choices,terms:true,account:true,reportStorage:true}),/dependent/);
});
test('chat tools toggle in both directions, preserve intake answers, and cancel pending gates',()=>{
 const ui=mountApp({source:null});
 ui.run('toggleEmergencyHelp()');assert.equal(ui.run('state.emergency.manual'),true);
 ui.run('toggleEmergencyHelp()');assert.equal(ui.run('state.emergency.manual'),false);
 ui.run("state.workspace=createWorkspace();state.intakeStep=1;state.intakeAnswers={'question-1':'option-1'};toggleIntake();toggleIntake();toggleIntake()");
 assert.equal(ui.run('state.workspace.intake'),true);assert.equal(ui.run('state.intakeStep'),1);assert.equal(ui.run("state.intakeAnswers['question-1']"),'option-1');
 ui.run('togglePreviousReport()');assert.equal(ui.run('state.reportImport.open'),true);ui.run('togglePreviousReport()');assert.equal(ui.run('state.reportImport.open'),false);
 ui.run('state.healthConsent.enabled=true;togglePreviousReport()');assert.equal(ui.run('state.healthConsent.pending'),'reportImport');assert.equal(ui.run('state.healthConsent.open'),true);
 ui.run('togglePreviousReport()');assert.equal(ui.run('state.healthConsent.open'),false);assert.equal(ui.run('state.healthConsent.pending'),'');assert.equal(ui.storage.size,0);
});

test('service consent clauses contain concrete choices, purposes, periods and refusal effects',()=>{
 const sections=signupConsentPolicy.sections;
 for(const section of sections){
  assert.match(section.title.ko,/동의합니다/);
  if(section.id!=='terms')for(const key of ['purpose','items','retention','refusal'])assert.ok(section[key].ko.trim());
 }
 const text=JSON.stringify(sections);
 assert.doesNotMatch(text,/검토용|초안|미리보기|확정 전|보관하는 안|Proposed/);
 assert.ok(sections.find(item=>item.id==='terms').details.length>=6);
});
