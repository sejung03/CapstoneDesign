import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {getProvider} from '../provider.mjs';
import {getConfig} from '../config.mjs';
import {createMockProvider} from '../providers/mock.mjs';
import {createGeminiProvider} from '../providers/gemini.mjs';
import {LLM_ERRORS, RETRYABLE_ERRORS} from '../errors.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const req = (user, extra = {}) => ({system: 's', user, schema: {}, schemaName: 'symptom_pick_v1', timeoutMs: 1000, ...extra});

test('getProvider: 기본은 mock, 이름으로 고름, 모르는 이름은 오류', () => {
  assert.equal(getProvider({config: getConfig({})}).name, 'mock');
  assert.equal(getProvider({config: getConfig({LLM_PROVIDER: 'gemini', LLM_MODEL: 'gemini-x-001'})}).name, 'gemini');
  assert.equal(getProvider({config: getConfig({LLM_PROVIDER: 'openai'})}).name, 'openai');
  assert.throws(() => getProvider({config: getConfig({LLM_PROVIDER: 'claude'})}), /알 수 없는/);
});

test('getProvider(openai): 설정(모델·추론 강도·temperature)을 어댑터로 넘긴다, 키 없으면 호출 안 함', async () => {
  const p = getProvider({config: getConfig({LLM_PROVIDER: 'openai', LLM_REASONING_EFFORT: 'low', LLM_TEMPERATURE: '0'})});
  assert.equal(p.model, 'gpt-6-luna');
  const body = p.buildBody({system: 's', user: 'u', schema: {}, schemaName: 'n'});
  assert.deepEqual(body.reasoning, {effort: 'low'});
  assert.equal(body.temperature, 0);
  let called = 0;
  const p2 = getProvider({config: getConfig({LLM_PROVIDER: 'openai'}), openaiOptions: {apiKey: '', fetchImpl: async () => { called += 1; }}});
  const r = await p2.generateStructured({system: 's', user: 'u', schema: {}, schemaName: 'n', timeoutMs: 100});
  assert.deepEqual([r.error, called], ['auth', 0]);
});

test('gemini 자리: 항상 not_implemented, 예외 없음', async () => {
  for (const p of [createGeminiProvider({model: 'm'})]) {
    const r = await p.generateStructured(req('x'));
    assert.equal(r.ok, false);
    assert.equal(r.error, 'not_implemented');
    assert.equal(r.meta.provider, p.name);
  }
});

test('gemini 자리: 네트워크 코드(import·fetch 등)가 없다', () => {
  for (const f of ['gemini.mjs']) {
    const src = readFileSync(path.join(HERE, '..', 'providers', f), 'utf8');
    const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assert.doesNotMatch(code, /\bimport\b|\bfetch\b|\brequire\b|http|process\.env/, f);
  }
});

test('errors: not_implemented·no_consent 포함, 재시도는 rate_limit·server·network만', () => {
  for (const e of ['timeout', 'rate_limit', 'server', 'network', 'blocked', 'bad_json', 'aborted', 'not_implemented', 'no_consent']) {
    assert.ok(LLM_ERRORS.includes(e), e);
  }
  assert.deepEqual([...RETRYABLE_ERRORS], ['rate_limit', 'server', 'network']);
});

test('mock: (입력 텍스트 → 응답) 맵, user 끝부분으로 찾고 가장 긴 키 우선', async () => {
  const p = createMockProvider({symptom_pick_v1: {
    '아파요': {data: {v: 1}},
    '머리가 아파요': {data: {v: 2}},
  }});
  assert.deepEqual((await p.generateStructured(req('목록\n\n사용자 문장:\n머리가 아파요'))).data, {v: 2});
  assert.deepEqual((await p.generateStructured(req('아파요'))).data, {v: 1});
  const miss = await p.generateStructured(req('다른 말'));
  assert.equal(miss.error, 'not_implemented');
});

test('mock: schemaName 별 맵과 defaults', async () => {
  const p = createMockProvider({symptom_pick_v1: {a: {data: 1}}}, {defaults: {profile_extract_v1: {data: {items: []}}}});
  assert.deepEqual((await p.generateStructured(req('a', {schemaName: 'profile_extract_v1'}))).data, {items: []});
});

test('mock: 오류 흉내(timeout|rate_limit|server|network|blocked|bad_json)', async () => {
  for (const error of ['timeout', 'rate_limit', 'server', 'network', 'blocked', 'bad_json']) {
    const p = createMockProvider({x: {error}});
    const r = await p.generateStructured(req('x'));
    assert.deepEqual([r.ok, r.error], [false, error]);
  }
});

test('mock: text 원문이 깨진 JSON이면 bad_json', async () => {
  const p = createMockProvider({x: {text: '{"intent": "symptom",'}, y: {text: '{"a":1}'}});
  assert.equal((await p.generateStructured(req('x'))).error, 'bad_json');
  assert.deepEqual((await p.generateStructured(req('y'))).data, {a: 1});
});

test('mock: delayMs가 timeoutMs를 넘으면 timeout', async () => {
  const p = createMockProvider({x: {delayMs: 200, data: {}}});
  const r = await p.generateStructured(req('x', {timeoutMs: 20}));
  assert.equal(r.error, 'timeout');
  const p2 = createMockProvider({x: {delayMs: 5, data: {ok: 1}}});
  assert.equal((await p2.generateStructured(req('x', {timeoutMs: 100}))).ok, true);
});

test('mock: signal abort를 존중', async () => {
  const p = createMockProvider({x: {delayMs: 500, data: {}}});
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 10);
  const r = await p.generateStructured(req('x', {signal: ctrl.signal}));
  assert.equal(r.error, 'aborted');
  const pre = new AbortController(); pre.abort();
  assert.equal((await createMockProvider({x: {data: {}}}).generateStructured(req('x', {signal: pre.signal}))).error, 'aborted');
});

test('mock: 배열 entry는 호출마다 차례로(재시도용)', async () => {
  const p = createMockProvider({x: [{error: 'server'}, {data: {n: 2}}]});
  assert.equal((await p.generateStructured(req('x'))).error, 'server');
  assert.deepEqual((await p.generateStructured(req('x'))).data, {n: 2});
  assert.deepEqual((await p.generateStructured(req('x'))).data, {n: 2});
  assert.equal(p.callCount, 3);
});
