import test from 'node:test';
import assert from 'node:assert/strict';
import {mountApp} from './dom-harness.mjs';
import {reportSource,reportText,cleanReport,reportFieldKeys} from '../report.mjs';
import {startServer} from '../server.mjs';
function openReport(){const ui=mountApp();ui.run("state.view='report';state.draft.symptom='두통';state.profile.allergies='페니실린';render()");return ui;}
test('Report shows unknown data explicitly and includes only user conversation, without inferred clinical content',()=>{
 const values=reportSource({profile:{},draft:{symptom:'머리 아픔'},chat:{messages:[{role:'user',text:'어제부터'},{role:'assistant',text:'진단 추정'}]}},k=>k);
 assert.equal(values.notes,'어제부터');assert.equal(values.symptom,'머리 아픔');
 const text=reportText(values);assert.match(text,/복용 중인 약\n미입력/);assert.doesNotMatch(text,/진단 추정/);
});
test('Report edit persists across rerender and navigation, saves independently, and cancels later changes',()=>{
 const ui=openReport();ui.document.getElementById('report-edit').click();
 ui.document.getElementById('report-symptom').value='수정한 증상';
 ui.document.getElementById('theme').click();
 assert.equal(ui.document.getElementById('report-symptom').value,'수정한 증상');
 ui.run("navigate('explore');navigate('report')");
 assert.equal(ui.document.getElementById('report-symptom').value,'수정한 증상');
 ui.document.getElementById('report-editor').emit('submit');
 assert.equal(ui.run('state.draft.symptom'),'두통');
 assert.equal(ui.run('state.report.saved.symptom'),'수정한 증상');
 assert.equal(ui.storage.has('medical-report'),false);
 ui.document.getElementById('report-edit').click();
 ui.document.getElementById('report-symptom').value='취소할 증상';
 ui.document.getElementById('report-cancel').click();
 assert.equal(ui.run('state.report.saved.symptom'),'수정한 증상');
});
test('Changed source never clobbers saved report; reload clears only report changes',()=>{
 const ui=openReport();ui.document.getElementById('report-edit').click();
 ui.document.getElementById('report-editor').emit('submit');
 ui.run("state.draft.symptom='새 원본';render()");
 assert.match(ui.app.innerHTML,/report-source-notice/);assert.equal(ui.run('state.report.saved.symptom'),'');assert.equal(ui.run('state.report.saved.notes'),'기타 사항: 두통');
 ui.document.getElementById('report-edit').click();ui.document.getElementById('report-editor').emit('submit');
 assert.match(ui.app.innerHTML,/report-source-notice/);
 ui.document.getElementById('report-reset').click();
 assert.equal(ui.run('state.report.saved'),null);assert.equal(ui.run('state.draft.symptom'),'새 원본');assert.equal(ui.run('state.profile.allergies'),'페니실린');
});
test('Report text remains escaped after editing and preview output actions require saving',()=>{
 const ui=openReport();ui.document.getElementById('report-edit').click();
 assert.match(ui.app.innerHTML,/id="report-print"[^>]*disabled/);
 ui.document.getElementById('report-symptom').value='<img src=x onerror=alert(1)>';
 ui.document.getElementById('report-editor').emit('submit');
 assert.match(ui.app.innerHTML,/&lt;img src=x/);assert.doesNotMatch(ui.app.innerHTML,/<img src=x/);
});
test('Print uses browser print and copy exports saved report text; clipboard failure is visible',async()=>{
 const ui=openReport();ui.run("window.print=()=>{window.printed=true};globalThis.navigator={clipboard:{writeText:async text=>{window.copied=text}}}");
 ui.document.getElementById('report-print').click();assert.equal(ui.run('window.printed'),true);
 ui.document.getElementById('report-copy').click();await new Promise(resolve=>setImmediate(resolve));
 assert.match(ui.run('window.copied'),/主要症状|주요 증상/);assert.match(ui.run('window.copied'),/두통/);
 ui.run("navigator.clipboard.writeText=async()=>{throw new Error('blocked')}");
 ui.document.getElementById('report-copy').click();await new Promise(resolve=>setImmediate(resolve));
 assert.match(ui.document.getElementById('toast').textContent,/복사하지 못/);
});
test('Report browser module is served without exposing server modules',async()=>{
 const server=await startServer({port:0,log(){}});
 try{const url='http://127.0.0.1:'+server.address().port;assert.equal((await fetch(url+'/report.mjs')).status,200);assert.equal((await fetch(url+'/public-data-server.mjs')).status,404);}
 finally{await new Promise(resolve=>server.close(resolve));}
});

test('name fields are excluded from the unified report model, text export and PDF document content',()=>{
 assert.equal(reportFieldKeys.includes('nickname'),false);
 const value=cleanReport({nickname:'private identity',age:'adult',allergies:'test allergy'});
 assert.equal(value.nickname,undefined);
 assert.doesNotMatch(reportText({...value,nickname:'private identity'},'ko'),/private identity|이름 또는 별칭/);
 const ui=openReport();assert.equal(ui.document.getElementById('report-nickname'),null);assert.doesNotMatch(ui.app.innerHTML,/report-field-nickname/);
});
