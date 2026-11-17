import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runRiskLlmEval, normalizeRiskKey} from './risk_llm_eval.mjs';
import {getConfig} from '../llm/config.mjs';

const config = getConfig({LLM_PROVIDER: 'openai', LLM_MODEL: 'gpt-5.4-mini-2026-03-17'});
const provider = (risk_signal) => ({
  name: 'openai', model: config.model,
  async generateStructured() { return {ok: true, data: {risk_signal}, meta: {inputTokens: 100, cachedInputTokens: 0, outputTokens: 10, reasoningTokens: 0}}; },
});

test('LC4 평가: 규칙 hit는 LLM을 부르지 않고, 규칙 miss만 합친 결과·비용을 낸다', async () => {
  const cases = [
    {id: 't1', text: '아기가 숨을 안 쉬어요', expect_key: 'freetext_emergency_119'},
    {id: 't2', text: '오늘 갑자기 몸이 이상해요', expect_key: 'freetext_urgent'},
    {id: 't3', text: '목이 조금 불편해요', expect: 'none'},
  ];
  const r = await runRiskLlmEval({cases, config, providerFactory: (c) => provider(c.id === 't2' ? 'emergency' : 'none')});
  assert.equal(r.actualCalls, 2);
  assert.equal(r.rows[0].ruleOnly, 'emergency_stop');
  assert.equal(r.rows[1].combined, 'emergency');
  assert.equal(r.rows[2].combined, 'none');
  assert.ok(r.costUsd > 0 && r.costUsd < 1);
  assert.equal(r.stoppedBy, null);
});

test('LC4 평가 라벨 정규화', () => {
  assert.equal(normalizeRiskKey('119'), 'emergency_stop');
  assert.equal(normalizeRiskKey('응급실'), 'emergency');
  assert.equal(normalizeRiskKey('1366'), 'violence');
  assert.equal(normalizeRiskKey('해당 없음'), 'none');
});

test('LCR1 평가: --no-llm은 provider를 만들지 않고 규칙+강한 단서 결과와 단서 오탐 수를 낸다', async () => {
  const cases = [
    {id: 'n1', text: '백신 맞았어요', expect: 'none'},
    {id: 'n2', text: '회사에서 추행이 있었어요', expect: 'none'},
    {id: 'n3', text: '아기가 숨을 안 쉬어요', expect_key: 'freetext_emergency_119'},
  ];
  const r = await runRiskLlmEval({cases, noLlm: true, providerFactory: () => { throw new Error('호출 금지'); }});
  assert.equal(r.actualCalls, 0);
  assert.equal(r.costUsd, 0);
  assert.equal(r.rows[0].ruleCue, 'none');
  assert.equal(r.rows[1].ruleCue, 'violence');
  assert.equal(r.rows[1].ruleCueEscape, true);
  assert.equal(r.cueFalsePositive, 1);
  assert.equal(r.ruleCue.falsePositiveEscape, 1);
});

test('LC5 평가: ambiguous·라벨 미상 사례는 본 표에서 빼고 따로 센다', async () => {
  const cases = [
    {id: 'a1', text: '백신 맞았어요', expect: 'none'},
    {id: 'a2', text: '회사에서 추행이 있었어요', expect_key: 'none', category: 'ambiguous'},
    {id: 'a3', text: '목이 조금 불편해요', expect_key: '알수없음'},
  ];
  const r = await runRiskLlmEval({cases, noLlm: true});
  assert.equal(r.ambiguous, 1);
  assert.equal(r.unknownLabel, 1);
  assert.equal(r.ruleCue.total, 1);
  assert.equal(r.ambiguousFlagged.ruleCue, 1);
  assert.equal(r.ambiguousFlagged.ruleOnly, 0);
});

test('LC5 평가: 대안 정답이 쉼표로 이어진 문자열이어도 나눠 읽는다', async () => {
  const r = await runRiskLlmEval({cases: [{id: 'b1', text: '목이 조금 불편해요', expect_key: 'threat_notice_112', expect_key_alt: 'threat_notice_112,violence_notice_1366'}], noLlm: true});
  assert.deepEqual(r.rows[0].expected.sort(), ['threat', 'violence']);
  assert.equal(r.unknownLabel, 0);
});
