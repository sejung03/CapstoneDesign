// 11/17 RF2: 위험 표현 확인 질문(RISK_CONFIRM_<n>, 검토 I7 중간안). 문장은 모두 지어낸 짧은 문장이다.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runCare} from '../index.mjs';
import {EMERGENCY_TEXT, SUMMARY} from '../templates.mjs';
import {resolveRiskConfirm} from '../risk-confirm.mjs';
import {CONSENT, fakeLlm, toAnswers} from './helpers.mjs';

const URGENT = '가슴이 쥐어짜듯이 아파요'; // FT-CHEST-01(freetext_urgent)
const URGENT2 = '갑자기 한쪽 팔에 힘이 없어요'; // FT-STROKE-01
const ES = '아기가 숨을 안 쉬어요'; // FT-APNEA-01(EMERGENCY_STOP)
const PLAIN = '배가 살살 아파요';
const SAFE = {Q0: 'no', N1: 'yes', N2: 'yes', N3: 'no', T1: 'other', T2: 'female', T3: 'age_19_64'};
const DETAIL = {N5: 'no', 'N5-1': 'onset_1_3d', N6: 'yes', N7: 'no', N8: 'no', N9: 'no', N10: 'no', N11: 'no', N12: 'no', N13: 'no', P0: 'no', F2: 'no'};

async function run(messages, answers = {}, reason = 'followup', llm = fakeLlm()) {
  const out = await runCare({reason, locale: 'ko', messages, followUpAnswers: toAnswers(answers)},
    {consent: CONSENT, deadlineAt: Date.now() + 3000}, {llm: llm.llm});
  assert.ok(out.response, out.error);
  return {...out, calls: llm.calls};
}

/** 가짜 사용자: RISK_CONFIRM_*에는 riskPick, 그 밖은 SAFE·DETAIL 또는 첫 선택지. 메시지는 단계별로 추가 가능. */
async function path(messages, {riskPick = 'risk_no', classify} = {}) {
  const llm = fakeLlm(classify ? {classify} : {});
  const answers = {};
  const responses = [];
  const asked = [];
  for (let step = 0; step < 45; step += 1) {
    const r = await run(messages, answers, step === 0 ? 'message' : 'followup', llm);
    responses.push(r.response);
    const f = r.response.followUp;
    if (!f) return {responses, asked, final: r.response, trace: r.trace, calls: llm.calls};
    assert.ok(!Object.hasOwn(answers, f.id), `같은 질문 반복: ${f.id}`);
    asked.push(f.id);
    answers[f.id] = f.id.startsWith('RISK_CONFIRM_') ? riskPick : (SAFE[f.id] ?? DETAIL[f.id] ?? f.options[0].id);
  }
  assert.fail('경로가 끝나지 않음');
}

test('RF2: 첫 걸림 → 응급 안내(문진 계속형) + RISK_CONFIRM_1, 진료과·search 없음, LLM 0', async () => {
  const r = await run([URGENT], {}, 'message');
  assert.deepEqual(Object.keys(r.response).sort(), ['emergency', 'followUp']);
  assert.equal(r.response.emergency.active, true);
  assert.equal(r.response.emergency.message.ko, EMERGENCY_TEXT.freetext_urgent.message);
  assert.equal(r.response.followUp.id, 'RISK_CONFIRM_1');
  assert.deepEqual(r.response.followUp.options.map((o) => o.id), ['risk_yes', 'risk_no', 'risk_unsure']);
  assert.deepEqual(r.response.followUp.options.map((o) => o.label.ko), ['예, 오늘 있었어요', '아니요 (예전 일이거나 실제 일이 아니에요)', '잘 모르겠어요']);
  assert.equal(r.response.followUp.label.ko, '앞에서 말씀하신 일이 오늘 실제로 있었던 일인가요? (본인이나 함께 있는 분에게, 지금은 괜찮아졌어도)');
  assert.equal(r.trace.terminal, false);
  assert.deepEqual(r.trace.riskConfirm, {state: 'pending', asks: 1});
  assert.equal(r.calls.classify.length + r.calls.profile.length, 0);
});

test('RF2: 예 → terminal 응급 안내만(진료과·search·질문 없음), 이후 요청에서도 유지', async () => {
  const r = await run([URGENT], {RISK_CONFIRM_1: 'risk_yes'});
  assert.deepEqual(Object.keys(r.response), ['emergency']);
  assert.equal(r.trace.terminal, true);
  const later = await run([URGENT], {RISK_CONFIRM_1: 'risk_yes', ...SAFE});
  assert.deepEqual(Object.keys(later.response), ['emergency']);
});

test('RF2: 아니요 → 응급 안내 해제(active:false), N1~N3를 평소대로 묻고 진료과까지 도달', async () => {
  const p = await path([URGENT], {riskPick: 'risk_no'});
  assert.equal(p.asked[0], 'RISK_CONFIRM_1');
  for (const id of ['Q0', 'N1', 'N2', 'N3']) assert.ok(p.asked.includes(id), id);
  assert.ok(p.final.summary && p.final.search?.type === 'hospital', '진료과 안내');
  for (const resp of p.responses.slice(1)) assert.ok(!resp.emergency?.active, '아니요 뒤 응급 안내 없음');
  assert.equal(p.final.emergency?.active, false);
  assert.ok(!p.final.summary.ko.startsWith(SUMMARY.riskUnconfirmed));
});

test('RF2: 잘 모르겠어요 → 이후 모든 응답에 응급 안내(문진 계속형), 진료과 도달, 요약 첫 줄 경고', async () => {
  const p = await path([URGENT], {riskPick: 'risk_unsure'});
  for (const resp of p.responses) assert.equal(resp.emergency?.active, true);
  assert.ok(p.final.search?.type === 'hospital');
  assert.equal(p.final.summary.ko.split('\n')[0], SUMMARY.riskUnconfirmed);
  assert.equal(p.trace.riskConfirm.state, 'unsure');
});

test('RF2: 답 없이 메시지만 2번 → 질문 2번(RISK_CONFIRM_1, _2) 뒤 잘 모르겠어요로 처리, 무한 반복 없음', async () => {
  const a = await run([URGENT], {}, 'message');
  assert.equal(a.response.followUp.id, 'RISK_CONFIRM_1');
  const b = await run([URGENT, '그냥 궁금해서 물어봤어요'], {}, 'message');
  assert.equal(b.response.followUp.id, 'RISK_CONFIRM_2');
  assert.equal(b.trace.riskConfirm.asks, 2);
  const c = await run([URGENT, '그냥 궁금해서 물어봤어요', '다른 얘기를 하고 싶어요'], {}, 'message');
  assert.notEqual(c.response.followUp?.id?.startsWith('RISK_CONFIRM_'), true);
  assert.equal(c.response.followUp.id, 'Q0');
  assert.equal(c.response.emergency.active, true);
  assert.equal(c.trace.riskConfirm.state, 'unsure');
});

test('RF2: 아니요 뒤 새 메시지에 다른 urgent 표현 → 새 확인 질문(RISK_CONFIRM_2). 같은 표현이 다시 나와도 새로 묻는다', async () => {
  const r = await run([URGENT, URGENT2], {RISK_CONFIRM_1: 'risk_no', Q0: 'no'});
  assert.equal(r.response.followUp.id, 'RISK_CONFIRM_2');
  assert.equal(r.response.emergency.active, true);
  const same = await run([URGENT, URGENT], {RISK_CONFIRM_1: 'risk_no', Q0: 'no'});
  assert.equal(same.response.followUp.id, 'RISK_CONFIRM_2');
  // 새 질문에도 아니요 → 다시 문진 계속
  const both = await run([URGENT, URGENT2], {RISK_CONFIRM_1: 'risk_no', RISK_CONFIRM_2: 'risk_no', Q0: 'no'});
  assert.equal(both.response.followUp.id, 'N1');
});

test('RF2: 아니요 뒤 EMERGENCY_STOP 표현 → 바로 EMERGENCY_STOP(확인 답과 무관), EMERGENCY_STOP에는 확인 질문이 없고 유지', async () => {
  const r = await run([URGENT, ES], {RISK_CONFIRM_1: 'risk_no', Q0: 'no'});
  assert.deepEqual(Object.keys(r.response), ['emergency']);
  assert.equal(r.response.emergency.message.ko, EMERGENCY_TEXT.freetext_emergency_119.message);
  const es = await run([ES], {}, 'message');
  assert.deepEqual(Object.keys(es.response), ['emergency']);
  const esLater = await run([ES], {RISK_CONFIRM_1: 'risk_no', ...SAFE});
  assert.deepEqual(Object.keys(esLater.response), ['emergency']);
  assert.equal(esLater.trace.riskConfirm, undefined);
});

test('RF2: 검토 I7 재현 — 부정 표현 + 배 아픔, 오탐 + 두통이 "아니요" 뒤 진료과까지 간다', async () => {
  for (const msgs of [['숨을 못 쉬는 건 아니에요', PLAIN], ['마스크 때문에 숨을 못 쉬겠어', '머리가 지끈해요']]) {
    const p = await path(msgs, {riskPick: 'risk_no'});
    assert.equal(p.asked[0], 'RISK_CONFIRM_2', msgs.join('/'));
    assert.ok(p.final.search?.type === 'hospital', msgs.join('/'));
  }
});

test('RG1: 확인 전 skip → 잘 모르겠어요로 봄(응급 안내 유지 + 추천, 요약 첫 줄 경고). 잘 모르겠어요 + skip도 같음', async () => {
  // 11/17 RG1: RF 판단 #2(확인 전 skip = 예)를 바꿈 — 답하지 않은 것은 '잘 모르겠어요'(두 번 무응답과 같은 처리)
  const s = await run([URGENT], {Q0: 'no'}, 'skip');
  assert.equal(s.response.emergency.active, true);
  assert.equal(s.response.emergency.message.ko, EMERGENCY_TEXT.freetext_urgent.message);
  assert.equal(s.response.search.type, 'hospital');
  assert.equal(s.response.summary.ko.split('\n')[0], SUMMARY.riskUnconfirmed);
  assert.equal(s.trace.terminal, false);
  assert.equal(s.trace.riskConfirm.state, 'unsure');
  const u = await run([URGENT], {Q0: 'no', RISK_CONFIRM_1: 'risk_unsure'}, 'skip');
  assert.equal(u.response.emergency.active, true);
  assert.ok(u.response.summary.ko.startsWith(SUMMARY.riskUnconfirmed));
  assert.equal(u.response.search.type, 'hospital');
});

test('RF2: resolveRiskConfirm — 덮는 답 중 가장 보수적인 것, 범위 밖 n은 무시, 이상한 값은 미응답', async () => {
  const h = (idx) => [{source: 'free_text', messageKey: 'freetext_urgent', messageIndexes: idx}];
  assert.equal(resolveRiskConfirm({hits: h([0]), riskConfirms: [{n: 1, value: 'risk_no'}, {n: 2, value: 'risk_yes'}], messageCount: 2}).state, 'yes');
  assert.equal(resolveRiskConfirm({hits: h([0]), riskConfirms: [{n: 1, value: 'risk_no'}, {n: 2, value: 'risk_unsure'}], messageCount: 2}).state, 'unsure');
  assert.equal(resolveRiskConfirm({hits: h([0]), riskConfirms: [{n: 5, value: 'risk_no'}], messageCount: 1}).state, 'pending');
  assert.equal(resolveRiskConfirm({hits: [], riskConfirms: [], messageCount: 1}).state, 'none');
  const bad = await run([URGENT], {RISK_CONFIRM_1: 'whatever'});
  assert.equal(bad.response.followUp.id, 'RISK_CONFIRM_1');
  assert.ok(bad.trace.warnings.includes('invalid_answer:RISK_CONFIRM'));
});

test('RF6(검토 I3): 무응답으로 잘 모르겠어요가 된 뒤 새 urgent 표현 → 새 확인 질문(RISK_CONFIRM_<L>)', async () => {
  const r = await run([URGENT, PLAIN, PLAIN, URGENT2], {}, 'message');
  assert.equal(r.response.followUp.id, 'RISK_CONFIRM_4');
  assert.equal(r.trace.riskConfirm.state, 'pending');
  // 새 질문의 답(아니요)은 앞의 무응답 hit까지 덮는다
  const no = await run([URGENT, PLAIN, PLAIN, URGENT2], {RISK_CONFIRM_4: 'risk_no', Q0: 'no'});
  assert.equal(no.response.followUp.id, 'N1');
});

test('RG1: 지나간 사건 규칙(경련·실신·토혈)에 아니요 → 경고 없이 추천(RF 판단 #11 삭제), 예 → terminal 그대로', async () => {
  // 11/17 RG1: 질문 기준이 '오늘'이 되어 오늘 있었던 일은 '예'로 온다. 그래서 '아니요'(예전 일)에 경고를 붙이지 않는다
  for (const m of ['작년에 아이가 경기를 일으켰어요', '예전에 피를 토했어요', '몇 달 전에 엄마가 쓰러졌어요']) {
    const p = await path([m], {riskPick: 'risk_no'});
    assert.ok(p.final.search?.type === 'hospital', m);
    assert.ok(!p.final.summary.ko.includes(SUMMARY.riskUnconfirmed), m);
    const yes = await run([m], {RISK_CONFIRM_1: 'risk_yes'});
    assert.deepEqual(Object.keys(yes.response), ['emergency'], m);
    assert.equal(yes.trace.terminal, true, m);
  }
});
