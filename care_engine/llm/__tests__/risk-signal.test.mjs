import {test} from 'node:test';
import assert from 'node:assert/strict';
import {detectRiskSignal, classifySymptomWithRisk} from '../index.mjs';
import {getConfig} from '../config.mjs';
import {loadRefData} from '../ref-data.mjs';
import {riskSignalSchema, symptomRiskSchema, RISK_SIGNALS} from '../schemas.mjs';

const consent = {granted: true, provider: 'mock', version: 'test-v1', healthInfo: true};
const text = '오늘 갑자기 많이 아파요';
const config = getConfig({LLM_CANDIDATE_MODE: 'all'});

function providerFor(data) {
  return {name: 'mock', model: 'mock-v0', calls: 0, async generateStructured() { this.calls += 1; return {ok: true, data, meta: {}}; }};
}

test('LC5: 단독·결합 민감 신호 로그는 종류와 증상 후보를 남기지 않는다', async () => {
  const refData = loadRefData();
  const id = [...refData.symptoms.values()].find((s) => s.isCandidate).id;
  for (const risk_signal of ['self_harm', 'threat', 'violence']) {
    for (const combined of [false, true]) {
      const logs = [];
      const provider = providerFor(combined ? {intent: 'symptom', status: 'matched', picks: [id], risk_signal} : {risk_signal});
      const fn = combined ? classifySymptomWithRisk : detectRiskSignal;
      const r = await fn({text, consent}, {provider, config, refData, log: (e) => logs.push(e)});
      assert.equal(r.riskSignal, risk_signal);
      assert.deepEqual(logs, [{kind: 'sensitive_referral'}]);
    }
  }
});

test('LC2: 위험 신호 작은 스키마와 결합 스키마는 허용 값만 받는다', () => {
  assert.deepEqual(riskSignalSchema().properties.risk_signal.enum, RISK_SIGNALS);
  const combined = symptomRiskSchema(['A01']);
  assert.deepEqual(combined.required, ['intent', 'status', 'picks', 'risk_signal']);
  assert.deepEqual(combined.properties.risk_signal.enum, RISK_SIGNALS);
});

test('LC2: detectRiskSignal 정상 값 5종', async () => {
  for (const risk_signal of RISK_SIGNALS) {
    const provider = providerFor({risk_signal});
    const r = await detectRiskSignal({text, consent}, {provider, config});
    assert.equal(r.riskSignal, risk_signal);
    assert.equal(r.meta.error, null);
    assert.equal(provider.calls, 1);
  }
});

test('LC2: 위험 신호 형식 위반은 none과 오류 종류', async () => {
  for (const data of [{risk_signal: 'other'}, {foo: 'emergency'}, null]) {
    const r = await detectRiskSignal({text, consent}, {provider: providerFor(data), config});
    assert.equal(r.riskSignal, 'none');
    assert.ok(['bad_json', 'invalid_risk_signal'].includes(r.meta.error));
  }
});

test('LC2: 시간 초과는 none, 동의 없음은 provider 호출 0회', async () => {
  const slow = {name: 'mock', model: 'slow', calls: 0, async generateStructured() { this.calls += 1; return new Promise(() => {}); }};
  const timed = await detectRiskSignal({text, consent}, {provider: slow, config: {...config, timeoutMs: 20, budgetMs: 30}});
  assert.deepEqual([timed.riskSignal, timed.meta.error], ['none', 'timeout']);
  const unused = providerFor({risk_signal: 'emergency'});
  const denied = await detectRiskSignal({text}, {provider: unused, config});
  assert.deepEqual([denied.riskSignal, denied.meta.error], ['none', 'no_consent']);
  assert.equal(unused.calls, 0);
});

test('LC2: 증상 분류 결합 호출은 한 번에 증상과 risk_signal을 돌려준다', async () => {
  const refData = loadRefData();
  const id = [...refData.symptoms.values()].find((s) => s.isCandidate).id;
  const provider = providerFor({intent: 'symptom', status: 'matched', picks: [id], risk_signal: 'emergency'});
  const r = await classifySymptomWithRisk({text, consent}, {provider, config, refData});
  assert.equal(r.status, 'confirm');
  assert.equal(r.riskSignal, 'emergency');
  assert.equal(provider.calls, 1);
  assert.equal(r.meta.schemaId, 'symptom_risk_v1');
});

test('LC2: 결합 출력의 위험 값만 위반하면 증상 결과는 유지하고 위험은 none', async () => {
  const refData = loadRefData();
  const id = [...refData.symptoms.values()].find((s) => s.isCandidate).id;
  const provider = providerFor({intent: 'symptom', status: 'matched', picks: [id], risk_signal: 'invalid'});
  const r = await classifySymptomWithRisk({text, consent}, {provider, config, refData});
  assert.equal(r.status, 'confirm');
  assert.equal(r.riskSignal, 'none');
  assert.equal(r.meta.riskError, 'invalid_risk_signal');
});
