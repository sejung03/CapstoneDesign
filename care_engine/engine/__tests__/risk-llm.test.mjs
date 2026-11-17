import {test} from 'node:test';
import assert from 'node:assert/strict';
import {call, fakeLlm, SAFE_BASE} from './helpers.mjs';

const PLAIN = '오늘 갑자기 몸이 이상해요';
const RULE_HIT = '아기가 숨을 안 쉬어요';
const CUE = '누군가 저를 협박해요';

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
