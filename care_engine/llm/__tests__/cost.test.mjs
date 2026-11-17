import {test} from 'node:test';
import assert from 'node:assert/strict';
import {estimateCostUsd, estimateMaxCostUsd} from '../cost.mjs';
import {getConfig} from '../config.mjs';
import {loadRefData} from '../ref-data.mjs';

const MODEL = 'gpt-5.4-mini-2026-03-17';
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} ≠ ${b}`);

test('estimateCostUsd: 입력(캐시 제외)·캐시 입력·출력, 공식 가격표', () => {
  // 1,000,000 입력 중 400,000 캐시, 출력 100,000(추론 20,000 포함)
  const meta = {model: MODEL, tokens: {input: 1_000_000, cachedInput: 400_000, output: 100_000, reasoning: 20_000}};
  close(estimateCostUsd(meta), 0.6 * 0.75 + 0.4 * 0.075 + 0.1 * 4.50);
});

test('estimateCostUsd: 어댑터 meta(평평한 토큰 필드)도 받는다', () => {
  const meta = {model: MODEL, inputTokens: 2000, cachedInputTokens: 1024, outputTokens: 30, reasoningTokens: 0};
  close(estimateCostUsd(meta), (976 * 0.75 + 1024 * 0.075 + 30 * 4.5) / 1e6);
});

test('estimateCostUsd: 모르는 모델·mock은 null, 토큰 없으면 0', () => {
  assert.equal(estimateCostUsd({model: 'gpt-5.4-mini', tokens: {input: 10}}), null);
  assert.equal(estimateCostUsd({model: 'mock-v0', tokens: {input: 10}}), null);
  assert.equal(estimateCostUsd(null), null);
  assert.equal(estimateCostUsd({model: MODEL, tokens: {input: 0, cachedInput: 0, output: 0, reasoning: 0}}), 0);
  assert.equal(estimateCostUsd({model: MODEL}), 0);
});

test('estimateCostUsd: 캐시가 입력보다 크게 와도 음수가 되지 않는다, 가격표 주입', () => {
  const v = estimateCostUsd({model: 'x', tokens: {input: 100, cachedInput: 500, output: 0}}, {x: {input: 1, cachedInput: 0.1, output: 2}});
  close(v, (100 * 0.1) / 1e6);
});

test('estimateMaxCostUsd: 반복에 비례, 신호어 사례는 추출 호출까지, 모르는 모델은 null', () => {
  const ref = loadRefData();
  const cfg = getConfig({LLM_PROVIDER: 'openai'});
  const one = estimateMaxCostUsd({cases: [{text: '머리가 아파요'}], config: cfg, refData: ref, repeat: 1});
  assert.ok(one > 0);
  close(estimateMaxCostUsd({cases: [{text: '머리가 아파요'}], config: cfg, refData: ref, repeat: 3}), one * 3);
  const withProfile = estimateMaxCostUsd({cases: [{text: '저는 32살이고 머리가 아파요'}], config: cfg, refData: ref});
  assert.ok(withProfile > one);
  assert.equal(estimateMaxCostUsd({cases: [{text: 'x'}], config: getConfig({LLM_PROVIDER: 'openai', LLM_MODEL: 'gpt-5.4-mini'}), refData: ref}), null);
  // all 모드 1건 상한은 대략 몇 센트 이하
  assert.ok(one < 0.05, String(one));
});
