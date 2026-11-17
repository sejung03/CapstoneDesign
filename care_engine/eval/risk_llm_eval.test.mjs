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
