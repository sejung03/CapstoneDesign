// 11/17 RF3: 민감 안내 3종(109·112·1366) — 상담하지 않고, 내용을 모으지 않고, 바로 연결.
// 문장은 모두 지어낸 짧은 문장이다(방법·수단 없음).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EMERGENCY_TEXT, TEMPLATE_VERSION} from '../templates.mjs';
import {checkResponseContract} from '../contract.mjs';
import {call, fakeLlm, SAFE_BASE} from './helpers.mjs';
import {pharmacyStarterText} from '../../eval/engine_scenarios.mjs';

const MARK = 'LEAK_SENTINEL_rf3';
const CASES = [
  {key: 'crisis_notice_109', text: '요즘 죽고 싶어요'},
  {key: 'threat_notice_112', text: '남편이 저를 죽이겠다고 해요'},
  {key: 'violence_notice_1366', text: '남자친구한테 맞았어요'},
];
const SENSITIVE_IDS = ['FT-SELFHARM-THINK-01', 'FT-THREAT-01', 'FT-VIOLENCE-01'];
const URGENT = '가슴이 쥐어짜듯이 아파요';
const ES = '아기가 숨을 안 쉬어요';

function assertNoTrace(out, logs, text) {
  const seen = JSON.stringify({trace: out.trace, logs});
  for (const id of SENSITIVE_IDS) assert.ok(!seen.includes(id), `trace·로그에 ${id}`);
  for (const k of ['crisis_notice_109', 'threat_notice_112', 'violence_notice_1366']) assert.ok(!seen.includes(k), `trace·로그에 ${k}`);
  assert.ok(!seen.includes(MARK), '표식 문자열');
  assert.ok(!seen.includes(text), '원문');
  assert.ok(!seen.includes('messageIndexes'), '메시지 위치');
}

test('RF3(+RG2): 문구 2개(templates-v4) — 초안 그대로, 길이 제한, 계약 통과, 112·119·1366 안내와 "상담하지 않아요"', () => {
  assert.equal(TEMPLATE_VERSION, 'templates-v4');
  assert.deepEqual(EMERGENCY_TEXT.threat_notice_112, {title: '지금은 안전이 먼저예요',
    message: '누군가 다치거나 위험해질 수 있는 상황으로 보여요. 지금 위험하다면 바로 112에 신고하세요. 다친 사람이 있으면 119에 연락하세요. 이 서비스는 이런 상황에 대한 상담은 하지 않아요.'});
  assert.deepEqual(EMERGENCY_TEXT.violence_notice_1366, {title: '도움받을 수 있는 곳이 있어요',
    message: '여성긴급전화 1366에서 24시간 상담받을 수 있고, 경찰·의료기관 연결도 도와줘요. 가까운 해바라기센터에서는 치료와 상담을 함께 받을 수 있어요. 지금 위험하다면 112, 다쳤다면 119에 연락하세요. 이 서비스는 이런 상황에 대한 상담은 하지 않아요.'});
  for (const k of ['threat_notice_112', 'violence_notice_1366']) {
    const t = EMERGENCY_TEXT[k];
    assert.ok(t.title.length <= 120 && t.message.length <= 1000, k);
    assert.ok(checkResponseContract({emergency: {active: true, title: {ko: t.title}, message: {ko: t.message}}}).ok, k);
    assert.ok(t.message.includes('112') && t.message.includes('119'), k);
  }
  assert.ok(EMERGENCY_TEXT.violence_notice_1366.message.includes('1366'));
  assert.ok(!/해바라기센터[^.]*\d/.test(EMERGENCY_TEXT.violence_notice_1366.message), '해바라기센터 번호 없음');
});

test('RF3: 3종 각각 — emergency만(terminal), followUp·search·진료과·summary·profileUpdates 없음, trace는 {kind} 하나, LLM 0', async () => {
  for (const c of CASES) {
    // 본인 상담 + skip이면 원래 건강정보 추출 LLM이 불리는 자리 — 민감 안내면 부르지 않아야 한다
    for (const req of [{reason: 'message', answers: {}}, {reason: 'skip', answers: {...SAFE_BASE}}, {reason: 'followup', answers: {...SAFE_BASE}}]) {
      const llm = fakeLlm({profile: {items: [{id: 'p1', field: 'allergies', value: 'x', evidence: {messageIndex: 0, quote: 'x'}}], meta: {}}});
      const text = `${c.text} ${MARK}`;
      const {out, calls, logs} = await call({...req, messages: [text], llm});
      assert.deepEqual(Object.keys(out.response), ['emergency'], c.key);
      assert.equal(out.response.emergency.active, true);
      assert.equal(out.response.emergency.message.ko, EMERGENCY_TEXT[c.key].message, c.key);
      assert.equal(out.trace.terminal, true);
      assert.deepEqual(out.trace.sensitive, {kind: 'sensitive_referral'});
      assert.deepEqual(out.trace.ruleHits, []);
      assert.deepEqual(out.trace.warnings, []);
      assert.equal(out.trace.slots, null);
      assert.equal(calls.classify.length + calls.profile.length, 0, `${c.key}: LLM 호출`);
      assertNoTrace(out, logs, c.text);
      assert.ok(!JSON.stringify(out.response).includes(MARK));
    }
  }
});

test('RF3: 약국 시작 문장과 함께 → 민감 안내가 먼저', async () => {
  for (const c of CASES) {
    const {out} = await call({messages: [pharmacyStarterText(), c.text]});
    assert.equal(out.response.search, undefined, c.key);
    assert.equal(out.response.emergency.message.ko, EMERGENCY_TEXT[c.key].message, c.key);
  }
});

test('RF3: urgent 표현과 함께 → 민감 안내, 확인 질문 없음(확인 답이 있어도)', async () => {
  for (const c of CASES) {
    const {out, logs} = await call({messages: [URGENT, c.text]});
    assert.deepEqual(Object.keys(out.response), ['emergency'], c.key);
    assert.equal(out.response.emergency.message.ko, EMERGENCY_TEXT[c.key].message, c.key);
    const yes = await call({reason: 'followup', messages: [URGENT, c.text], answers: {RISK_CONFIRM_2: 'risk_yes'}});
    assert.equal(yes.out.response.emergency.message.ko, EMERGENCY_TEXT[c.key].message, c.key);
    assertNoTrace(out, logs, c.text);
    assert.ok(!JSON.stringify(out.trace).includes('FT-CHEST-01'), '다른 hit 목록도 남기지 않음');
  }
});

test('RF3: EMERGENCY_STOP 표현과 함께 → EMERGENCY_STOP. 이 경우에도 trace에 민감 hit가 남지 않는다', async () => {
  for (const c of CASES) {
    const {out, logs} = await call({messages: [ES, c.text]});
    assert.ok(out.response.emergency.message.ko.startsWith(EMERGENCY_TEXT.freetext_emergency_119.message.split(' 이 서비스는')[0]), c.key);
    assert.deepEqual(out.trace.ruleHits, ['FT-APNEA-01'], c.key);
    assert.equal(out.trace.sensitive, undefined);
    assertNoTrace(out, logs, c.text);
  }
});

test('RF3: 이후 요청에서도 같은 메시지가 남아 있으면 같은 안내(확인 질문 없음, 의도한 동작)', async () => {
  for (const c of CASES) {
    for (const answers of [{Q0: 'no'}, {...SAFE_BASE, RISK_CONFIRM_1: 'risk_no'}]) {
      const {out} = await call({reason: 'followup', messages: [c.text, '배가 살살 아파요'], answers});
      assert.deepEqual(Object.keys(out.response), ['emergency'], c.key);
      assert.equal(out.response.emergency.message.ko, EMERGENCY_TEXT[c.key].message, c.key);
    }
  }
});

test('RF6(검토 I4): 답 기반 EMERGENCY_STOP(Q0=예)은 민감 안내보다 먼저(E 문항 유지), ES 응답에는 함께 걸린 기관 한 문장', async () => {
  const q0 = await call({reason: 'followup', messages: ['배가 살살 아파요', '남편이 저를 죽이겠다고 협박해요'], answers: {Q0: 'yes'}});
  assert.equal(q0.out.response.followUp?.id, 'E1');
  assert.ok(q0.out.response.emergency.message.ko.includes('112'));
  assert.equal(q0.out.trace.sensitive, undefined);
  assert.ok(!JSON.stringify(q0.out.trace).includes('FT-THREAT'));
  const es = await call({messages: ['남편이 또 때렸어요', ES]});
  assert.ok(es.out.response.emergency.message.ko.includes('1366'));
  assert.ok(es.out.response.emergency.message.ko.endsWith('이 서비스는 진단을 하지 않아요.'));
  assert.ok(!JSON.stringify(es.out.trace).includes('FT-VIOLENCE'));
});

test('RF6(검토 S2): 민감 규칙이 놓친 문장이라도 민감 단서가 있으면 LLM(분류·건강정보)을 부르지 않는다', async () => {
  const text = '남편이 요즘 폭력적이에요';
  const llm = fakeLlm();
  const first = await call({messages: [text], llm});
  assert.equal(first.out.trace.sensitive, undefined); // 규칙은 걸리지 않음(문진으로)
  const skip = await call({reason: 'skip', messages: [text], answers: {...SAFE_BASE}, llm});
  assert.ok(skip.out.response.summary);
  const mid = await call({reason: 'followup', messages: [text], answers: {...SAFE_BASE}, llm});
  assert.ok(mid.out.response.followUp || mid.out.response.summary);
  assert.equal(llm.calls.classify.length + llm.calls.profile.length, 0);
  assert.ok(!JSON.stringify(mid.out.trace).includes('폭력'));
});

test('RG2: 1366 문구 — 서비스가 연결해 주는 것처럼 읽히지 않는 표현(본문·덧붙임 문장 같음), 길이 제한', async () => {
  const {REFERRAL_ADDONS, withAddon} = await import('../templates.mjs');
  const body = EMERGENCY_TEXT.violence_notice_1366.message;
  const addon = REFERRAL_ADDONS.violence_notice_1366;
  for (const t of [body, addon]) {
    assert.ok(t.includes('여성긴급전화 1366에서 24시간 상담받을 수 있고, 경찰·의료기관 연결도 도와줘요.'));
    assert.ok(!t.includes('연결해 드려요'));
  }
  assert.ok(body.length <= 1000 && EMERGENCY_TEXT.violence_notice_1366.title.length <= 120);
  // 가장 긴 덧붙임 조합(ES 문구 + 109 + 112 + 1366)도 1000자 이하
  let e = {active: true, title: {ko: EMERGENCY_TEXT.freetext_emergency_119.title}, message: {ko: EMERGENCY_TEXT.freetext_emergency_119.message}};
  for (const k of ['crisis_notice_109', 'threat_notice_112', 'violence_notice_1366']) e = withAddon(e, REFERRAL_ADDONS[k]);
  assert.ok(e.message.ko.length <= 1000);
  assert.ok(checkResponseContract({emergency: e}).ok);
  assert.ok(e.message.ko.endsWith('이 서비스는 진단을 하지 않아요.'));
});
