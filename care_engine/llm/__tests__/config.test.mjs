import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {getConfig} from '../config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

test('getConfig: 환경변수가 없으면 설계 8절 기본값', () => {
  const c = getConfig({});
  assert.equal(c.provider, 'mock');
  assert.equal(c.model, 'mock-v0');
  assert.equal(c.timeoutMs, 4000);
  assert.equal(c.budgetMs, 7000);
  assert.equal(c.retryMinRemainingMs, 3000);
  assert.equal(c.candidateMode, 'retrieve');
  assert.equal(c.candidateK, 40);
  assert.equal(c.maxConcurrency, 2);
  assert.deepEqual({...c.versions}, {
    promptSymptom: 'symptom_v1', promptProfile: 'profile_v1',
    schemaSymptom: 'symptom_pick_v1', schemaProfile: 'profile_extract_v1',
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
  assert.equal(getConfig({LLM_CANDIDATE_MODE: 'everything'}).candidateMode, 'retrieve');
  assert.equal(getConfig({LLM_PROVIDER: 'gemini'}).model, null);
});

test('config.mjs는 API 키 변수를 읽지 않는다', () => {
  const src = readFileSync(path.join(HERE, '..', 'config.mjs'), 'utf8');
  const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /API_KEY/);
});
