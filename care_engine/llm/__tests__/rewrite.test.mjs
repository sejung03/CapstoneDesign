// 11/18 절충 1(LLM_SYMPTOM_MODE=rewrite): 고쳐 쓰기 → 사전 재검색 → 못 찾으면 전체 목록 호출.
// 가짜 업체로 길마다 확인한다: 찾음(1회), 못 찾음·형식 오류·시간 초과(→ 전체 목록), 인증 오류(멈춤), 의도, 위험 신호, 로그 누출.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classifySymptomWithRisk, classifySymptom} from '../index.mjs';
import {getConfig} from '../config.mjs';
import {loadRefData} from '../ref-data.mjs';
import {checkFollowUpContract} from '../confirm-question.mjs';
import rewritePrompt from '../prompts/symptom_rewrite_v1.mjs';
import rewriteRiskPrompt from '../prompts/symptom_rewrite_risk_v1.mjs';

const ref = loadRefData();
const config = getConfig({LLM_PROVIDER: 'openai', LLM_SYMPTOM_MODE: 'rewrite', LLM_REWRITE_TIMEOUT_MS: '200'});
const consent = {granted: true, provider: 'openai', version: 'test-v1', healthInfo: true};
const TEXT = '운동하다 다리 아래쪽 관절이 홱 돌아갔어요 표지QZ9';
const FULL_OK = {ok: true, data: {intent: 'symptom', status: 'matched', picks: ['L16'], risk_signal: 'none'}, meta: {inputTokens: 5800}};

/** schemaName별 응답(값 또는 함수). 호출 기록을 남긴다. */
function fakeProvider(by) {
  const calls = [];
  return {
    calls,
    name: 'openai',
    model: 'gpt-5.4-mini-2026-03-17',
    async generateStructured(req) {
      calls.push(req.schemaName);
      const r = by[req.schemaName];
      if (r === undefined) return {ok: false, error: 'server', meta: {}};
      return typeof r === 'function' ? r(req) : r;
    },
  };
}
const rw = (data, inputTokens = 300) => ({ok: true, data, meta: {inputTokens}});
const run = (provider, extra = {}) => {
  const logs = [];
  return classifySymptomWithRisk({text: TEXT, consent, requestId: 't', reason: 'test', ...extra},
    {provider, refData: ref, config, log: (e) => logs.push(e)}).then((r) => ({r, logs}));
};
const pickIds = (r) => r.followUp.options.map((o) => o.id).filter((id) => /^sym_[A-Z]/.test(id));

test('rewrite 찾음: 고쳐 쓴 표현이 사전에 맞으면 호출 1번, 전체 목록 호출 없음, 확인 질문 계약 통과', async () => {
  const p = fakeProvider({symptom_rewrite_risk_v1: rw({intent: 'symptom', terms: ['발목 통증', '발목 삠'], risk_signal: 'none'})});
  const {r, logs} = await run(p);
  assert.deepEqual(p.calls, ['symptom_rewrite_risk_v1']);
  assert.equal(r.status, 'confirm');
  assert.ok(pickIds(r).includes('sym_L16'));
  assert.ok(checkFollowUpContract(r.followUp).ok);
  assert.equal(r.meta.symptomPath, 'rewrite_hit');
  assert.equal(r.meta.tokens.input, 300);
  assert.equal(r.riskSignal, 'none');
  // 원문·고쳐 쓴 표현이 로그에 없다
  const all = JSON.stringify(logs);
  for (const s of ['표지QZ9', '발목 삠', '발목 통증']) assert.ok(!all.includes(s), s);
  assert.equal(logs[0].symptomPath, 'rewrite_hit');
});

test('rewrite 못 찾음·빈 표현·형식 오류 → 원래 문장으로 전체 목록 호출(호출 2번, 토큰 합산)', async () => {
  for (const [name, rwRes, path] of [
    ['사전에 없는 표현', rw({intent: 'symptom', terms: ['없는표현ZZ'], risk_signal: 'none'}), 'rewrite_miss'],
    ['빈 표현', rw({intent: 'symptom', terms: [], risk_signal: 'none'}), 'rewrite_miss'],
    ['형식 오류', rw({intent: 'symptom', picks: []}), 'rewrite_bad'],
  ]) {
    const p = fakeProvider({symptom_rewrite_risk_v1: rwRes, symptom_risk_v1: FULL_OK});
    const {r} = await run(p);
    assert.deepEqual(p.calls, ['symptom_rewrite_risk_v1', 'symptom_risk_v1'], name);
    assert.equal(r.status, 'confirm', name);
    assert.deepEqual(pickIds(r), ['sym_L16'], name);
    assert.equal(r.meta.symptomPath, path, name);
    assert.equal(r.meta.attempts, 2, name);
    assert.equal(r.meta.tokens.input, (path === 'rewrite_bad' || path === 'rewrite_miss' ? 300 : 0) + 5800, name);
  }
});

test('rewrite 시간 초과·서버 오류 → 전체 목록 호출로 넘어감, 인증·잔액 오류는 바로 멈춤', async () => {
  const slow = () => new Promise((res) => setTimeout(() => res(rw({intent: 'symptom', terms: ['발목 통증'], risk_signal: 'none'})), 600));
  let p = fakeProvider({symptom_rewrite_risk_v1: slow, symptom_risk_v1: FULL_OK});
  let {r} = await run(p);
  assert.deepEqual(p.calls, ['symptom_rewrite_risk_v1', 'symptom_risk_v1']);
  assert.equal(r.status, 'confirm');
  assert.equal(r.meta.symptomPath, 'rewrite_fail');
  for (const error of ['auth', 'quota']) {
    p = fakeProvider({symptom_rewrite_risk_v1: {ok: false, error, meta: {}}, symptom_risk_v1: FULL_OK});
    ({r} = await run(p));
    assert.deepEqual(p.calls, ['symptom_rewrite_risk_v1'], error);
    assert.equal(r.status, 'fallback', error);
    assert.equal(r.meta.error, error, error);
  }
});

test('rewrite 의도: 증상이 아니면 그 자리에서 route(호출 1번)', async () => {
  const p = fakeProvider({symptom_rewrite_risk_v1: rw({intent: 'facility_search', terms: [], risk_signal: 'none'})});
  const {r} = await run(p);
  assert.deepEqual(p.calls, ['symptom_rewrite_risk_v1']);
  assert.equal(r.status, 'route');
  assert.equal(r.intent, 'facility_search');
  assert.equal(r.meta.symptomPath, 'rewrite_route');
});

test('위험 신호: 고쳐 쓰기가 낸 신호는 전체 목록 호출이 none이거나 실패해도 남는다', async () => {
  const rwEm = rw({intent: 'symptom', terms: ['없는표현ZZ'], risk_signal: 'emergency'});
  let p = fakeProvider({symptom_rewrite_risk_v1: rwEm, symptom_risk_v1: FULL_OK});
  let {r} = await run(p);
  assert.equal(r.riskSignal, 'emergency');
  p = fakeProvider({symptom_rewrite_risk_v1: rwEm, symptom_risk_v1: {ok: false, error: 'server', meta: {}}});
  ({r} = await run(p));
  assert.equal(r.status, 'fallback');
  assert.equal(r.riskSignal, 'emergency');
  // 찾음 경로에서도 그대로
  p = fakeProvider({symptom_rewrite_risk_v1: rw({intent: 'symptom', terms: ['발목 통증'], risk_signal: 'emergency'})});
  ({r} = await run(p));
  assert.equal(r.status, 'confirm');
  assert.equal(r.riskSignal, 'emergency');
  // 위험 신호 값이 이상하면 none + riskError
  p = fakeProvider({symptom_rewrite_risk_v1: rw({intent: 'symptom', terms: ['발목 통증'], risk_signal: 'weird'})});
  ({r} = await run(p));
  assert.equal(r.riskSignal, 'none');
  assert.equal(r.meta.riskError, 'invalid_risk_signal');
});

test('rewrite: 위험 신호 없는 classifySymptom도 같은 길(스키마 symptom_rewrite_v1), full 모드는 고쳐 쓰기를 부르지 않는다', async () => {
  const p = fakeProvider({symptom_rewrite_v1: rw({intent: 'symptom', terms: ['발목 통증']})});
  const r = await classifySymptom({text: TEXT, consent}, {provider: p, refData: ref, config});
  assert.deepEqual(p.calls, ['symptom_rewrite_v1']);
  assert.equal(r.status, 'confirm');
  const full = fakeProvider({symptom_risk_v1: FULL_OK});
  const r2 = await classifySymptomWithRisk({text: TEXT, consent}, {provider: full, refData: ref, config: getConfig({LLM_PROVIDER: 'openai', LLM_SYMPTOM_MODE: 'full'})});
  assert.deepEqual(full.calls, ['symptom_risk_v1']);
  assert.equal(r2.meta.symptomPath, 'full');
});

test('rewrite 프롬프트: 의료 경계 문구, 증상 목록 없음, 위험 정의 포함', () => {
  for (const s of [rewritePrompt.system, rewriteRiskPrompt.system]) {
    assert.match(s, /진단·치료·약 권고를 하지 않는다/);
    assert.match(s, /응급 여부는 판단하지 않는다/);
    assert.match(s, /사용자가 말하지 않은 증상을 지어내지 않는다/);
    assert.match(s, /- other: 인사·감사·잡담/);
  }
  assert.match(rewriteRiskPrompt.system, /risk_signal/);
  const u = rewriteRiskPrompt.buildUser({text: '가짜 문장', riskText: '마지막 문장'});
  assert.ok(!u.includes('증상 목록'));
  assert.ok(u.endsWith('가장 최근 문장(risk_signal 전용):\n마지막 문장'));
});

test('rewrite 찾음은 SYM_REWRITE_CONFIRM(다른 증상이에요 포함), forceFull이면 고쳐 쓰기 없이 전체 목록만', async () => {
  const p = fakeProvider({symptom_rewrite_risk_v1: rw({intent: 'symptom', terms: ['발목 통증'], risk_signal: 'none'}), symptom_risk_v1: FULL_OK});
  let {r} = await run(p);
  assert.equal(r.followUp.id, 'SYM_REWRITE_CONFIRM');
  assert.deepEqual(r.followUp.options.slice(-2).map((o) => o.id), ['sym_other', 'sym_unsure']);
  p.calls.length = 0;
  ({r} = await run(p, {forceFull: true}));
  assert.deepEqual(p.calls, ['symptom_risk_v1']);
  assert.equal(r.followUp.id, 'SYM_CONFIRM');
  assert.equal(r.meta.symptomPath, 'full');
});
