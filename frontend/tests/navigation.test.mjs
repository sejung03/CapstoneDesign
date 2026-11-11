import test from 'node:test';
import assert from 'node:assert/strict';
import {mountApp} from './dom-harness.mjs';
test('입력칸 클릭은 본문 이동·재렌더를 발생시키지 않음',()=>{
 const ui=mountApp();const before=ui.renders;
 ui.document.getElementById('composer-input').click();
 assert.equal(ui.renders,before);
 assert.equal(ui.body.events.get('click')?.length||0,0);
});
test('대화창 열고 닫기를 반복해도 본문 이벤트가 누적되지 않음',()=>{
 const ui=mountApp();
 ui.document.getElementById('skip').click();
 ui.document.getElementById('chat-close').click();
 for(let i=0;i<20;i++){
  const before=ui.renders;
  ui.document.getElementById('chat-open').click();
  assert.equal(ui.renders,before+1);
  const input=ui.document.getElementById('composer-input');
  input.value='작성 중인 내용 '+i;input.click();
  assert.equal(ui.renders,before+1);
  ui.document.getElementById('chat-close').click();
  assert.equal(ui.renders,before+2);
 }
 assert.equal(ui.body.events.get('click')?.length||0,0);
 ui.document.getElementById('chat-open').click();
 assert.equal(ui.document.getElementById('composer-input').value,'작성 중인 내용 19');
});
test('언어·테마 버튼은 한 번 클릭할 때 한 번만 렌더',()=>{
 const ui=mountApp();
 let before=ui.renders;ui.document.getElementById('language').click();assert.equal(ui.renders,before+1);
 before=ui.renders;ui.document.getElementById('theme').click();assert.equal(ui.renders,before+1);
});
