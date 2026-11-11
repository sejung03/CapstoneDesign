import test from 'node:test';
import assert from 'node:assert/strict';
import {mountApp} from './dom-harness.mjs';
test('unified exports use applied health information and preserve consultation edits without using unsaved profile drafts',()=>{
 const ui=mountApp({source:null});
 ui.run("state.profile.allergies='최신 알레르기';state.profile.medications='현재 약';state.profileDraft.allergies='아직 적용하지 않은 내용';state.report.saved={age:'옛 연령',allergies:'옛 알레르기',medications:'옛 약',notes:'직접 편집한 상담 메모',symptom:'편집한 증상'};");
 assert.equal(ui.run('unifiedReportValues(state,t).allergies'),'최신 알레르기');assert.equal(ui.run('unifiedReportValues(state,t).medications'),'현재 약');assert.equal(ui.run('unifiedReportValues(state,t).notes'),'직접 편집한 상담 메모');assert.equal(ui.run('unifiedReportValues(state,t).symptom'),'편집한 증상');
 assert.equal(ui.run('state.report.saved.allergies'),'옛 알레르기');assert.equal(ui.run('state.profileDraft.allergies'),'아직 적용하지 않은 내용');assert.equal(ui.storage.size,0);
});
