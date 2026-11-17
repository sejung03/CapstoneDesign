import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {getConfig} from '../config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

test('getConfig: 환경변수가 없으면 설계 8절 기본값(+L4: 후보 기본값 all)', () => {
  const c = getConfig({});
  assert.equal(c.provider, 'mock');
  assert.equal(c.model, 'mock-v0');
  assert.equal(c.timeoutMs, 4000);
  assert.equal(c.budgetMs, 7000);
  assert.equal(c.retryMinRemainingMs, 3000);
  assert.equal(c.candidateMode, 'all');
  assert.equal(c.candidateK, 40);
  assert.equal(c.maxConcurrency, 2);
  assert.equal(c.reasoningEffort, 'none');
  assert.equal(c.temperature, null);
  assert.equal(c.devConsent, false);
  assert.equal(c.evalBudgetUsd, 2);
  assert.equal(c.modelWarning, null);
  assert.deepEqual({...c.versions}, {
    promptSymptom: 'symptom_v1', promptProfile: 'profile_v1',
    schemaSymptom: 'symptom_pick_v1', schemaProfile: 'profile_extract_v1',
    promptRisk: 'risk_v1', promptSymptomRisk: 'symptom_risk_v1',
    schemaRisk: 'risk_signal_v1', schemaSymptomRisk: 'symptom_risk_v1',
  });
});

test('getConfig: 환경변수 반영, 잘못된 값은 기본값', () => {
  const c = getConfig({LLM_PROVIDER: 'OpenAI', LLM_MODEL: 'model-2026-01-01', LLM_TIMEOUT_MS: '2500', LLM_BUDGET_MS: 'abc', LLM_CANDIDATE_MODE: 'all', LLM_CANDIDATE_K: '-3', LLM_MAX_CONCURRENCY: '1'});
  assert.equal(c.provider, 'openai');
  assert.equal(c.model, 'model-2026-01-01');
  assert.equal(c.timeoutMs, 2500);
  assert.equal(c.budgetMs, 7000);
  assert.equal(c.candidateMode, 'all');
  assert.equal(c.candidateK, 40);
  assert.equal(c.maxConcurrency, 1);
  assert.equal(getConfig({LLM_CANDIDATE_MODE: 'everything'}).candidateMode, 'all');
  assert.equal(getConfig({LLM_CANDIDATE_MODE: 'retrieve'}).candidateMode, 'retrieve');
  assert.equal(getConfig({LLM_PROVIDER: 'gemini'}).model, null);
});

test('config.mjs는 API 키 변수를 읽지 않는다', () => {
  const src = readFileSync(path.join(HERE, '..', 'config.mjs'), 'utf8');
  const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /API_KEY/);
});

test('L4: openai 기본 모델·별칭 경고·추론 강도·temperature·예산', () => {
  assert.equal(getConfig({LLM_PROVIDER: 'openai'}).model, 'gpt-5.4-mini-2026-03-17');
  assert.equal(getConfig({LLM_PROVIDER: 'openai'}).modelWarning, null);
  assert.equal(getConfig({LLM_PROVIDER: 'openai', LLM_MODEL: 'gpt-5.4-mini'}).model, 'gpt-5.4-mini');
  assert.equal(getConfig({LLM_PROVIDER: 'openai', LLM_MODEL: 'gpt-5.4-mini'}).modelWarning, 'model_alias');
  assert.equal(getConfig({LLM_PROVIDER: 'mock', LLM_MODEL: 'x'}).modelWarning, null);
  assert.equal(getConfig({LLM_REASONING_EFFORT: 'LOW'}).reasoningEffort, 'low');
  assert.equal(getConfig({LLM_REASONING_EFFORT: 'extreme'}).reasoningEffort, 'none');
  assert.equal(getConfig({LLM_TEMPERATURE: '0'}).temperature, 0);
  assert.equal(getConfig({LLM_TEMPERATURE: '0.7'}).temperature, 0.7);
  assert.equal(getConfig({LLM_TEMPERATURE: ''}).temperature, null);
  assert.equal(getConfig({LLM_TEMPERATURE: 'abc'}).temperature, null);
  assert.equal(getConfig({LLM_TEMPERATURE: '5'}).temperature, null);
  assert.equal(getConfig({LLM_EVAL_BUDGET_USD: '0.5'}).evalBudgetUsd, 0.5);
  assert.equal(getConfig({LLM_EVAL_BUDGET_USD: '-1'}).evalBudgetUsd, 2);
});

test('L4: 가격표는 공식 표 값, 모르는 모델은 없음', async () => {
  const {MODEL_PRICES_USD_PER_1M} = await import('../config.mjs');
  assert.deepEqual({...MODEL_PRICES_USD_PER_1M['gpt-5.4-mini-2026-03-17']}, {input: 0.75, cachedInput: 0.075, output: 4.50});
  assert.equal(MODEL_PRICES_USD_PER_1M['gpt-5.4-mini'], undefined);
});
