import {test} from 'node:test';
import assert from 'node:assert/strict';
import {call, fakeLlm, SAFE_BASE} from './helpers.mjs';

const PLAIN = '오늘 갑자기 몸이 이상해요';
const RULE_HIT = '아기가 숨을 안 쉬어요';
const CUE = '누군가 저를 협박해요';

test('LC5: 위험 전용 호출 뒤 완료해도 건강정보 LLM을 다시 부르지 않는다', async () => {
  const llm = fakeLlm();
  const answers = {...SAFE_BASE, SYM_DICT_CONFIRM: 'sym_R05', N5: 'no', 'N5-1': 'onset_1_3d', N6: 'yes', P0: 'no'};
  for (let i = 7; i <= 13; i += 1) answers[`N${i}`] = 'no';
  const {out} = await call({messages: ['기침이 나요'], answers, llm});
  assert.equal(out.trace.phase, 'complete');
  assert.equal(llm.calls.risk.length, 1);
  assert.equal(llm.calls.profile.length + llm.calls.classify.length + llm.calls.combined.length, 0);
});

test('LC5: 미응답 질문 ID로 LLM 위험 확인을 유지하고 skip·두 번 무응답을 처리한다', async () => {
  const answers = {...SAFE_BASE, RISK_CONFIRM_1: null};
  const pending = await call({reason: 'followup', messages: [PLAIN], answers});
  assert.equal(pending.out.response.followUp.id, 'RISK_CONFIRM_1');
  const skip = await call({reason: 'skip', messages: [PLAIN], answers});
  assert.equal(skip.out.response.emergency.active, true);
  assert.equal(skip.out.trace.terminal, false);
  const timeout = await call({reason: 'skip', messages: [PLAIN, '그대로예요', '잘 모르겠어요'], answers});
  assert.equal(timeout.out.response.emergency.active, true);
  assert.equal(timeout.out.response.followUp, undefined);
});

test('LC5: 미응답 민감 질문 ID는 종류 저장 없이 안내를 유지하고 skip·무응답이면 종료한다', async () => {
  const answers = {...SAFE_BASE, SENSITIVE_CHOICE_1: null};
  const llm = fakeLlm();
  const pending = await call({reason: 'followup', messages: [PLAIN], answers, llm});
  assert.equal(pending.out.response.followUp.id, 'SENSITIVE_CHOICE_1');
  assert.deepEqual(pending.out.response.emergency, {active: true});
  for (const input of [{reason: 'skip', messages: [PLAIN]}, {reason: 'message', messages: [PLAIN, '그대로예요', '잘 모르겠어요']}]) {
    const {out} = await call({...input, answers, llm});
    assert.equal(out.trace.terminal, true);
    assert.deepEqual(out.response, {emergency: {active: true}});
  }
  assert.equal(Object.values(llm.calls).flat().length, 0);
  const continued = await call({reason: 'skip', messages: [PLAIN], answers: {...answers, SENSITIVE_CHOICE_1: 'sens_continue'}, llm});
  assert.equal(continued.out.trace.terminal, false);
  assert.equal(continued.out.response.emergency, undefined);
});

test('LC3: LLM emergency는 EMERGENCY_STOP이 아니라 RISK_CONFIRM 뒤 사용자 답으로 처리한다', async () => {
  const llm = fakeLlm({risk: {riskSignal: 'emergency', meta: {attempts: 1}}});
  const first = await call({messages: [PLAIN], llm});
  assert.equal(first.out.response.followUp.id, 'RISK_CONFIRM_1');
  assert.equal(first.out.trace.terminal, false);
  assert.deepEqual(first.out.trace.llm.risk, {called: true, signal: 'emergency'});
  assert.equal(llm.calls.risk.length, 1);

  const yesLlm = fakeLlm();
  const yes = await call({reason: 'followup', messages: [PLAIN], answers: {RISK_CONFIRM_1: 'risk_yes'}, llm: yesLlm});
  assert.equal(yes.out.trace.terminal, true);
  assert.equal(yes.out.response.followUp, undefined);
  assert.equal(yesLlm.calls.risk.length + yesLlm.calls.combined.length, 0);
});

test('LC3: LLM 민감 신호 3종은 민감 안내 선택으로 가며 종류를 trace에 남기지 않는다', async () => {
  for (const signal of ['self_harm', 'threat', 'violence']) {
    const llm = fakeLlm({risk: {riskSignal: signal, meta: {attempts: 1}}});
    const {out} = await call({messages: [PLAIN], llm});
    assert.equal(out.response.followUp.id, 'SENSITIVE_CHOICE_1');
    assert.equal(out.trace.terminal, false);
    assert.deepEqual(out.trace.sensitive, {kind: 'sensitive_referral'});
    assert.ok(!JSON.stringify(out.trace).includes(signal));
  }
});

test('LC3: 규칙 hit·민감 단서·followup에서는 위험 LLM을 부르지 않는다', async () => {
  for (const input of [
    {messages: [RULE_HIT]},
    {messages: [CUE]},
    {reason: 'followup', messages: [PLAIN], answers: {Q0: 'no'}},
  ]) {
    const llm = fakeLlm({risk: {riskSignal: 'emergency', meta: {attempts: 1}}});
    await call({...input, llm});
    assert.equal(llm.calls.risk.length + llm.calls.combined.length, 0);
  }
});

test('LC3: 증상 분류도 필요한 message 요청은 결합 호출 한 번만 한다', async () => {
  const llm = fakeLlm({combined: {status: 'fallback', reason: 'no_match', riskSignal: 'none', meta: {attempts: 1}}});
  const {out} = await call({reason: 'message', messages: [PLAIN], answers: {...SAFE_BASE}, llm});
  assert.equal(out.response.followUp.id, 'SYM_NOT_FOUND');
  assert.equal(llm.calls.combined.length, 1);
  assert.equal(llm.calls.risk.length + llm.calls.classify.length + llm.calls.profile.length, 0);
});

test('LC3: 위험 LLM 오류는 규칙만 쓰는 동작과 같고, 규칙 경보를 낮추지 못한다', async () => {
  const errLlm = fakeLlm({risk: {riskSignal: 'none', meta: {attempts: 1, error: 'timeout'}}});
  const failed = await call({messages: [PLAIN], llm: errLlm});
  assert.equal(failed.out.response.followUp.id, 'Q0');
  assert.deepEqual(failed.out.trace.llm.risk, {called: true, error: 'timeout'});

  const lowering = fakeLlm({risk: {riskSignal: 'none', meta: {attempts: 1}}});
  const rule = await call({messages: [RULE_HIT], llm: lowering});
  assert.equal(rule.out.trace.terminal, true);
  assert.equal(lowering.calls.risk.length + lowering.calls.combined.length, 0);
});
