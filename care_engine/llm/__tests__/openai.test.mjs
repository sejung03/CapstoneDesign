// OpenAI 어댑터 테스트. 네트워크를 쓰지 않는다(가짜 fetch 주입).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createOpenAiProvider, mapHttpError} from '../providers/openai.mjs';
import {LLM_ERRORS, RETRYABLE_ERRORS} from '../errors.mjs';

const KEY = 'sk-test-FAKEKEY-0000';
const REQ = {system: '지시', user: '증상 목록:\nA01 | x\n\n사용자 문장:\n머리', schema: {type: 'object'}, schemaName: 'symptom_pick_v1', timeoutMs: 500};
const USAGE = {input_tokens: 1200, input_tokens_details: {cached_tokens: 1024}, output_tokens: 30, output_tokens_details: {reasoning_tokens: 0}};

function jsonResponse(status, body) {
  return {status, ok: status >= 200 && status < 300, text: async () => (typeof body === 'string' ? body : JSON.stringify(body))};
}

/** 호출을 기록하는 가짜 fetch */
function fakeFetch(handler) {
  const calls = [];
  const f = async (url, init) => { calls.push({url, init}); return handler(url, init); };
  f.calls = calls;
  return f;
}

const okBody = (text, extra = {}) => ({
  status: 'completed',
  output: [{type: 'message', content: [{type: 'output_text', text}]}],
  usage: USAGE,
  ...extra,
});

const make = (fetchImpl, opts = {}) => createOpenAiProvider({model: 'gpt-5.4-mini-2026-03-17', apiKey: KEY, fetchImpl, ...opts});

test('정상: output[].content[] output_text를 파싱, meta에 토큰·상태', async () => {
  const f = fakeFetch(() => jsonResponse(200, okBody('{"intent":"symptom","status":"matched","picks":["N01"]}')));
  const r = await make(f).generateStructured(REQ);
  assert.equal(r.ok, true);
  assert.deepEqual(r.data, {intent: 'symptom', status: 'matched', picks: ['N01']});
  assert.equal(r.meta.provider, 'openai');
  assert.equal(r.meta.model, 'gpt-5.4-mini-2026-03-17');
  assert.equal(r.meta.httpStatus, 200);
  assert.deepEqual([r.meta.inputTokens, r.meta.cachedInputTokens, r.meta.outputTokens, r.meta.reasoningTokens], [1200, 1024, 30, 0]);
  assert.ok(Number.isFinite(r.meta.latencyMs));
  assert.equal(f.calls[0].url, 'https://api.openai.com/v1/responses');
  assert.equal(f.calls[0].init.method, 'POST');
});

test('정상: output_text 편의 필드가 있으면 그것을 쓴다, 여러 조각은 이어 붙임', async () => {
  const r1 = await make(fakeFetch(() => jsonResponse(200, {status: 'completed', output_text: '{"a":1}', output: []}))).generateStructured(REQ);
  assert.deepEqual(r1.data, {a: 1});
  const body = {status: 'completed', output: [{type: 'reasoning'}, {type: 'message', content: [{type: 'output_text', text: '{"a":'}, {type: 'output_text', text: '2}'}]}]};
  const r2 = await make(fakeFetch(() => jsonResponse(200, body))).generateStructured(REQ);
  assert.deepEqual(r2.data, {a: 2});
});

test('요청 본문: 형식·store:false·strict:true, temperature 미지정이면 없음, 키는 본문에 없음', async () => {
  const f = fakeFetch(() => jsonResponse(200, okBody('{}')));
  await make(f).generateStructured(REQ);
  const {init} = f.calls[0];
  const body = JSON.parse(init.body);
  assert.deepEqual(body, {
    model: 'gpt-5.4-mini-2026-03-17',
    instructions: '지시',
    input: REQ.user,
    text: {format: {type: 'json_schema', name: 'symptom_pick_v1', schema: {type: 'object'}, strict: true}},
    reasoning: {effort: 'none'},
    max_output_tokens: 400,
    store: false,
  });
  assert.equal('temperature' in body, false);
  assert.ok(!init.body.includes(KEY));
  assert.equal(init.headers.Authorization, `Bearer ${KEY}`);
  assert.equal(init.headers['Content-Type'], 'application/json');
});

test('요청 본문: temperature·reasoningEffort·maxOutputTokens·baseUrl 반영', async () => {
  const f = fakeFetch(() => jsonResponse(200, okBody('{}')));
  await make(f, {temperature: 0, reasoningEffort: 'low', maxOutputTokens: 200, baseUrl: 'http://localhost:9/v1/'}).generateStructured(REQ);
  const body = JSON.parse(f.calls[0].init.body);
  assert.equal(body.temperature, 0);
  assert.deepEqual(body.reasoning, {effort: 'low'});
  assert.equal(body.max_output_tokens, 200);
  assert.equal(f.calls[0].url, 'http://localhost:9/v1/responses');
});

test('refusal → blocked', async () => {
  const body = {status: 'completed', output: [{type: 'message', content: [{type: 'refusal', refusal: '거절'}]}], usage: USAGE};
  const r = await make(fakeFetch(() => jsonResponse(200, body))).generateStructured(REQ);
  assert.deepEqual([r.ok, r.error], [false, 'blocked']);
});

test('incomplete(최대 토큰) → bad_json, content_filter → blocked', async () => {
  const r = await make(fakeFetch(() => jsonResponse(200, okBody('{"intent":', {status: 'incomplete', incomplete_details: {reason: 'max_output_tokens'}})))).generateStructured(REQ);
  assert.deepEqual([r.ok, r.error, r.meta.errorCode], [false, 'bad_json', 'max_output_tokens']);
  assert.equal(r.meta.outputTokens, 30);
  const r2 = await make(fakeFetch(() => jsonResponse(200, okBody('', {status: 'incomplete', incomplete_details: {reason: 'content_filter'}})))).generateStructured(REQ);
  assert.equal(r2.error, 'blocked');
});

test('깨진 JSON → bad_json (응답 본문 자체가 깨져도)', async () => {
  const r = await make(fakeFetch(() => jsonResponse(200, okBody('{"intent": "symptom",')))).generateStructured(REQ);
  assert.deepEqual([r.ok, r.error], [false, 'bad_json']);
  const r2 = await make(fakeFetch(() => jsonResponse(200, '<html>'))).generateStructured(REQ);
  assert.equal(r2.error, 'bad_json');
});

test('HTTP 오류 매핑: 429 quota / 429 일반 / 401 / 403 / 400 / 404 / 422 / 500 / 503', async () => {
  const cases = [
    [429, {error: {code: 'insufficient_quota', type: 'insufficient_quota', message: '비밀 메시지'}}, 'quota'],
    [429, {error: {code: 'rate_limit_exceeded', message: 'x'}}, 'rate_limit'],
    [401, {error: {code: 'invalid_api_key', message: 'x'}}, 'auth'],
    [403, {error: {message: 'x'}}, 'auth'],
    [400, {error: {code: 'unsupported_parameter', param: 'temperature', message: 'x'}}, 'bad_request'],
    [404, {error: {code: 'model_not_found'}}, 'bad_request'],
    [422, 'not json', 'bad_request'],
    [500, {error: {type: 'server_error'}}, 'server'],
    [503, '', 'server'],
  ];
  for (const [status, body, error] of cases) {
    const r = await make(fakeFetch(() => jsonResponse(status, body))).generateStructured(REQ);
    assert.deepEqual([r.ok, r.error, r.meta.httpStatus], [false, error, status], `${status}`);
    assert.ok(!JSON.stringify(r).includes('비밀 메시지'));
  }
  const r = await make(fakeFetch(() => jsonResponse(400, {error: {code: 'unsupported_parameter', param: 'temperature'}}))).generateStructured(REQ);
  assert.deepEqual([r.meta.errorCode, r.meta.errorParam], ['unsupported_parameter', 'temperature']);
  assert.equal(mapHttpError(429, 'insufficient_quota'), 'quota');
});

test('오류 code가 이상한 문자열이면 남기지 않는다', async () => {
  const r = await make(fakeFetch(() => jsonResponse(400, {error: {code: '사용자 문장 머리가 아파요', param: 'a b c'}}))).generateStructured(REQ);
  assert.equal(r.meta.errorCode, undefined);
  assert.equal(r.meta.errorParam, undefined);
});

test('네트워크 예외 → network', async () => {
  const r = await make(async () => { throw new TypeError('fetch failed'); }).generateStructured(REQ);
  assert.deepEqual([r.ok, r.error], [false, 'network']);
});

/** signal을 존중하는 느린 가짜 fetch */
const slowFetch = (ms) => (url, init) => new Promise((resolve, reject) => {
  const t = setTimeout(() => resolve(jsonResponse(200, okBody('{}'))), ms);
  init.signal.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('aborted', 'AbortError')); }, {once: true});
});

test('타임아웃 → timeout', async () => {
  const r = await make(slowFetch(1000)).generateStructured({...REQ, timeoutMs: 20});
  assert.deepEqual([r.ok, r.error], [false, 'timeout']);
});

test('바깥 취소 → aborted (미리 취소된 signal이면 fetch 안 함)', async () => {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 10);
  const r = await make(slowFetch(1000)).generateStructured({...REQ, timeoutMs: 2000, signal: ctrl.signal});
  assert.deepEqual([r.ok, r.error], [false, 'aborted']);
  const pre = new AbortController(); pre.abort();
  const f = fakeFetch(() => jsonResponse(200, okBody('{}')));
  const r2 = await make(f).generateStructured({...REQ, signal: pre.signal});
  assert.equal(r2.error, 'aborted');
  assert.equal(f.calls.length, 0);
});

test('키 없음 → auth, 호출하지 않음', async () => {
  for (const apiKey of [undefined, '', '   ']) {
    const f = fakeFetch(() => jsonResponse(200, okBody('{}')));
    const r = await createOpenAiProvider({model: 'm', apiKey, fetchImpl: f}).generateStructured(REQ);
    assert.deepEqual([r.ok, r.error, r.meta.errorCode], [false, 'auth', 'missing_api_key']);
    assert.equal(f.calls.length, 0);
  }
});

test('fetch가 예외 대신 이상한 값을 줘도 예외를 던지지 않는다', async () => {
  const r = await make(async () => null).generateStructured(REQ);
  assert.equal(r.ok, false);
  const r2 = await make(fakeFetch(() => jsonResponse(200, {status: 'failed', output: []}))).generateStructured(REQ);
  assert.deepEqual([r2.ok, r2.error], [false, 'server']);
});

test('meta·결과에 키·요청 본문이 없다', async () => {
  const f = fakeFetch(() => jsonResponse(500, {error: {message: 'x'}}));
  const r = await make(f).generateStructured(REQ);
  const s = JSON.stringify(r);
  assert.ok(!s.includes(KEY));
  assert.ok(!s.includes('사용자 문장'));
  assert.ok(!s.includes('Bearer'));
});

test('errors: quota·auth·bad_request 추가, 재시도 대상 아님', () => {
  for (const e of ['quota', 'auth', 'bad_request']) {
    assert.ok(LLM_ERRORS.includes(e), e);
    assert.ok(!RETRYABLE_ERRORS.includes(e), e);
  }
});
