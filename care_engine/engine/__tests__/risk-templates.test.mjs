// 11/17 R3: 자유 입력 위험 표현 문구 3개(templates-v2). 길이 제한, 지시서 초안과 같은지, 109 문구의 안전 요소.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EMERGENCY_TEXT, emergencyNotice, TEMPLATE_VERSION} from '../templates.mjs';
import {checkResponseContract} from '../contract.mjs';
import {loadFreeTextRules} from '../free-text.mjs';

const KEYS = ['freetext_emergency_119', 'freetext_urgent', 'crisis_notice_109'];

test('R3: 문구 3개 — title ≤ 120자, message ≤ 1000자, 계약 통과, 진단 아님 문장', () => {
  assert.equal(TEMPLATE_VERSION, 'templates-v3');
  for (const k of KEYS) {
    const t = EMERGENCY_TEXT[k];
    assert.ok(t, k);
    assert.ok(t.title.length > 0 && t.title.length <= 120, k);
    assert.ok(t.message.length > 0 && t.message.length <= 1000, k);
    assert.ok(t.message.endsWith('이 서비스는 진단을 하지 않아요.'), k);
    const n = emergencyNotice(k);
    assert.equal(n.warning, null, k);
    assert.ok(checkResponseContract({emergency: n.emergency}).ok, k);
  }
});

test('R3: 지시서 초안 그대로', () => {
  assert.deepEqual(EMERGENCY_TEXT.freetext_emergency_119, {title: '지금 119에 연락하세요', message: '생명이 위험할 수 있는 상황으로 보여요. 바로 119에 전화하세요. 이 서비스는 진단을 하지 않아요.'});
  assert.deepEqual(EMERGENCY_TEXT.freetext_urgent, {title: '바로 도움이 필요할 수 있어요', message: '응급 진료가 필요할 수 있는 증상으로 보여요. 119에 연락하거나 가까운 응급실로 가세요. 이 서비스는 진단을 하지 않아요.'});
  assert.deepEqual(EMERGENCY_TEXT.crisis_notice_109, {title: '혼자 견디지 않아도 돼요', message: '지금 많이 힘드신 것 같아요. 자살예방 상담전화 109에서 24시간 이야기를 들어 드려요. 지금 위험한 상황이라면 바로 119에 연락하세요. 이 서비스는 진단을 하지 않아요.'});
});

test('R3: 109 문구 — 109·24시간·지금 위험하면 119가 들어 있고, 방법·수단 단어가 없다', () => {
  const m = EMERGENCY_TEXT.crisis_notice_109.message;
  for (const must of ['109', '24시간', '119']) assert.ok(m.includes(must), must);
  for (const bad of ['방법', '약', '칼', '줄', '높은', '뛰어', '목을']) assert.ok(!m.includes(bad), bad);
});

test('R3: 규칙 파일의 모든 message_key에 문구가 있다(모르는 키 경고 없음)', () => {
  const rules = loadFreeTextRules();
  for (const r of rules.rules) assert.equal(emergencyNotice(r.messageKey).warning, null, r.ruleId);
  assert.deepEqual([...new Set(rules.rules.map((r) => r.messageKey))].sort(), [...KEYS, 'threat_notice_112', 'violence_notice_1366'].sort());
});
