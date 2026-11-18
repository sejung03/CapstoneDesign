// 11/18 LLM 예열(warmSymptomRisk): 고정 문장만 보내고, 성별 3가지를 한 번씩, 실패해도 던지지 않는다.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {warmSymptomRisk, WARMUP_TEXT, WARMUP_SEXES} from '../index.mjs';
import {getConfig} from '../config.mjs';

const fakeProvider = (respond) => {
  const calls = [];
  return {
    calls,
    name: 'openai',
    model: 'gpt-5.4-mini-2026-03-17',
    async generateStructured(req) { calls.push(req); return respond(req); },
  };
};
const okData = {intent: 'symptom', status: 'matched', picks: ['N01'], risk_signal: 'none'};
const config = getConfig({LLM_SYMPTOM_MODE: 'full', LLM_PROVIDER: 'openai'});

test('warmSymptomRisk: mock이면 부르지 않는다', async () => {
  const r = await warmSymptomRisk({config: getConfig({LLM_SYMPTOM_MODE: 'full'})});
  assert.deepEqual(r, {skipped: 'mock', results: []});
});

test('warmSymptomRisk: 성별 3가지를 고정 문장으로 한 번씩, 후보 목록은 성별마다 다르다', async () => {
  const p = fakeProvider(() => ({ok: true, data: okData, meta: {}}));
  const r = await warmSymptomRisk({config, provider: p});
  assert.equal(r.skipped, null);
  assert.deepEqual(r.results.map((x) => [x.sex, x.ok, x.error]), WARMUP_SEXES.map((s) => [s, true, null]));
  assert.equal(p.calls.length, 3);
  for (const req of p.calls) assert.ok(req.user.endsWith(`가장 최근 문장(risk_signal 전용):\n${WARMUP_TEXT}`));
  // 사용자 요청보다 넉넉한 시간 제한(사용자를 기다리게 하지 않으므로)
  assert.ok(p.calls.every((req) => req.timeoutMs > config.timeoutMs));
  const enumSizes = p.calls.map((req) => req.schema.properties.picks.items.enum.length);
  assert.equal(new Set(enumSizes).size, 3);
});

test('warmSymptomRisk: 업체 오류·예외가 나도 던지지 않고 오류 코드만 남긴다', async () => {
  const failing = fakeProvider(() => ({ok: false, error: 'auth', meta: {}}));
  const r = await warmSymptomRisk({config, provider: failing});
  assert.deepEqual(r.results.map((x) => [x.ok, x.error]), [[false, 'auth'], [false, 'auth'], [false, 'auth']]);
  const throwing = fakeProvider(() => { throw new Error('boom'); });
  const r2 = await warmSymptomRisk({config, provider: throwing});
  assert.equal(r2.results.length, 3);
  assert.ok(r2.results.every((x) => x.ok === false));
});

test('warmSymptomRisk: rewrite 모드면 전체 목록 3번 + 고쳐 쓰기 1번(고쳐 쓰기 시간 제한도 넉넉히)', async () => {
  const p = fakeProvider((req) => ({ok: true, data: req.schemaName.startsWith('symptom_rewrite') ? {intent: 'symptom', terms: ['두통'], risk_signal: 'none'} : okData, meta: {}}));
  const r = await warmSymptomRisk({config: getConfig({LLM_PROVIDER: 'openai', LLM_SYMPTOM_MODE: 'rewrite'}), provider: p});
  assert.deepEqual(r.results.map((x) => [x.mode, x.ok]), [['full', true], ['full', true], ['full', true], ['rewrite', true]]);
  assert.deepEqual(p.calls.map((c) => c.schemaName).sort(), ['symptom_rewrite_risk_v1', 'symptom_risk_v1', 'symptom_risk_v1', 'symptom_risk_v1']);
  assert.ok(p.calls.every((c) => c.timeoutMs > 3000));
});
