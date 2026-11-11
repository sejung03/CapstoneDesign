import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversation,appendChat,chatNotes,setChatOpen} from '../chat-model.mjs';
import {renderChat,renderEntry,robotIcon} from '../chat-view.mjs';
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const t=key=>key,icon=()=>'<svg aria-hidden="true"></svg>';
test('처음 대화는 이전 대화나 추가 상태를 전제하지 않는 비어 있는 상태',()=>{
 assert.deepEqual(createConversation(),{messages:[],input:'',open:false});
 const html=renderEntry({chat:createConversation()},t,icon,escape);
 assert.ok(html.includes('chatFirst'));
 assert.ok(html.includes('data-view="explore"'));
 assert.ok(html.includes('id="composer-input"'));
 assert.ok(!html.includes('<nav'));
});
test('접기·다시 열기 시 대화와 작성 중인 메시지 유지',()=>{
 const chat={...createConversation(),messages:[{role:'user',text:'배가 아파요'}],input:'아직 보내지 않은 내용',open:true};
 const closed=setChatOpen(chat,false);
 const reopened=setChatOpen(closed,true);
 assert.equal(closed.open,false);assert.equal(reopened.open,true);
 assert.equal(reopened.input,chat.input);
 assert.deepEqual(reopened.messages,chat.messages);
 assert.equal(chat.open,true);
});
test('메시지 전송 후 초안에서 대화 내용 확인 가능, 기존 객체는 변경하지 않음',()=>{
 const original={...createConversation(),input:' 머리가 아파요 '};
 const result=appendChat(original,original.input);
 assert.equal(result.ok,true);
 assert.equal(result.conversation.input,'');
 assert.equal(chatNotes(result.conversation),'머리가 아파요');
 assert.equal(original.messages.length,0);
 assert.equal(appendChat(result.conversation,'  ').reason,'empty');
});
test('전체 입력량 제한을 초과하면 기존 내용 보존',()=>{
 const original={...createConversation(),messages:[{role:'user',text:'가'.repeat(2000)}]};
 assert.equal(appendChat(original,'나').reason,'limit');
 assert.equal(chatNotes(original).length,2000);
});
test('메시지의 HTML은 실행 가능한 마크업 대신 텍스트로 출력',()=>{
 const chat={...createConversation(),messages:[{role:'user',text:'<img src=x onerror=alert(1)>'}],input:'</textarea><script>alert(1)</script>'};
 const html=renderChat({chat},t,icon,escape);
 assert.ok(html.includes('&lt;img'));
 assert.ok(html.includes('&lt;/textarea&gt;'));
 assert.ok(!html.includes('<script>'));
});
test('일반 화면의 대화는 접기 기능 제공, 첫 진입 대화는 경로 선택 제공',()=>{
 const state={chat:createConversation()};
 assert.ok(renderChat(state,t,icon,escape).includes('id="chat-close"'));
 assert.ok(!renderChat(state,t,icon,escape,{entry:true}).includes('id="chat-close"'));
 assert.ok(robotIcon().includes('<svg'));
});
