import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {runEval, readCases, fixturesToMockMap, EVAL_STOP_ERRORS} from '../run_eval.mjs';
import {compareRows} from '../compare.mjs';
import {getConfig} from '../../llm/config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const cases = readCases(path.join(HERE, '..', 'cases', 'draft_v0.jsonl'));
const fixtures = JSON.parse(readFileSync(path.join(HERE, '..', 'fixtures', 'mock_v0.json'), 'utf8'));
// 1차 mock 기대값은 retrieve 기준으로 손으로 계산했다 → 그 테스트는 retrieve로 고정, all 기본값은 따로 검사
const config = getConfig({LLM_SYMPTOM_MODE: 'full', LLM_PROVIDER: 'mock', LLM_CANDIDATE_MODE: 'retrieve'});

test('draft_v0: 30개, 구성 개수, 형식', () => {
  assert.equal(cases.length, 30);
  const g = {};
  for (const c of cases) g[c.group] = (g[c.group] ?? 0) + 1;
  assert.deepEqual(g, {paraphrase: 12, dictionary: 3, facility: 4, medication: 2, chitchat: 2, emergency: 3, profile: 3, other_person: 1});
  for (const c of cases) {
    assert.equal(c.label_status, 'draft_single');
    for (const k of ['id', 'text', 'gold_symptoms', 'gold_intent', 'gold_emergency', 'gold_profile']) assert.ok(k in c, `${c.id} ${k}`);
  }
  assert.equal(new Set(cases.map((c) => c.id)).size, 30);
});

test('mock_v0: 구성(정답 포함 20, 정답 없음 4, 형식 위반 2, timeout 2, 엉뚱한 ID 2)', () => {
  const d = {};
  for (const c of cases) d[fixtures.cases[c.id].design] = (d[fixtures.cases[c.id].design] ?? 0) + 1;
  assert.deepEqual(d, {correct: 20, no_correct: 4, format_violation: 2, timeout: 2, wrong_id: 2});
});

test('fixturesToMockMap: 키는 사례 문장, case id는 들어가지 않는다', () => {
  const m = fixturesToMockMap(cases, fixtures);
  const keys = Object.keys(m.symptom_pick_v1);
  assert.equal(keys.length, 30);
  assert.ok(keys.every((k) => !/^c\d+$/.test(k)));
});

test('runEval(mock): 지표가 fixture 설계대로 나온다', async () => {
  const r = await runEval({cases, fixtures, providerName: 'mock', repeat: 3, config});
  const m = r.metrics;
  assert.deepEqual([m.failureRate.hit, m.failureRate.n], [4, 30]);
  assert.deepEqual(m.failuresByReason, {timeout: 2, bad_json: 2});
  assert.deepEqual([m.recallAt10.hit, m.recallAt10.n], [15, 22]);
  assert.deepEqual([m.top1.hit, m.top1.n], [14, 22]);
  assert.deepEqual([m.noMatchAccuracy.hit, m.noMatchAccuracy.n], [8, 8]);
  assert.deepEqual([m.intentAccuracy.hit, m.intentAccuracy.n], [26, 30]);
  // L4 M3(신호어 패턴): c30(다른 사람 이야기)은 더는 보내지 않아 잘못 뽑힌 1개가 사라짐(1차 4/5 → 3/3),
  // c29('수술을 받았고')는 지시서 패턴 '수술\s*(받|했)'에 조사가 없어 보내지 않음(1차 4/4 → 3/4)
  assert.deepEqual([m.profilePrecision.hit, m.profilePrecision.n], [3, 3]);
  assert.deepEqual([m.profileRecall.hit, m.profileRecall.n], [3, 4]);
  assert.equal(m.profileCalls, 2);
  // 11/18 일상 표현 사전(동의어 1173 → 1598)으로 retrieve 후보가 정답을 더 잘 담는다(16·15 → 21·21)
  assert.deepEqual([m.candidateSentRecall.hit, m.candidateSentRecall.n], [21, 22]);
  assert.deepEqual([m.candidateRecall['R@40'].hit, m.candidateRecall['R@40'].n], [21, 22]);
  assert.equal(m.emergencyMissRate.value, '미측정');
  assert.deepEqual([m.repeatAgreement.hit, m.repeatAgreement.n], [30, 30]);
  // confirm = 정답 포함 증상 사례 15 + 정답 없이 다른 증상을 고른 c01·c08·c27 3 (c07은 no_match)
  assert.equal(r.statusCounts.confirm, 18);
});

test('runEval(mock, all 기본값): 후보를 전부 보내므로 보낸 후보에 정답 22/22, 나머지 지표는 같다', async () => {
  const r = await runEval({cases, fixtures, providerName: 'mock', repeat: 1, config: getConfig({LLM_SYMPTOM_MODE: 'full', LLM_PROVIDER: 'mock'})});
  const m = r.metrics;
  assert.equal(r.candidateMode, 'all');
  assert.deepEqual([m.candidateSentRecall.hit, m.candidateSentRecall.n], [22, 22]);
  assert.deepEqual([m.recallAt10.hit, m.top1.hit, m.noMatchAccuracy.hit, m.intentAccuracy.hit, m.failureRate.hit], [15, 14, 8, 26, 4]);
});

test('runEval 결과에 사례 원문·profile 값이 없다', async () => {
  const r = await runEval({cases, fixtures, providerName: 'mock', repeat: 1, config});
  const s = JSON.stringify(r);
  for (const c of cases) assert.ok(!s.includes(c.text), c.id);
  for (const w of ['울렁', '페니실린', '당뇨약', '맹장', '혈압약']) assert.ok(!s.includes(w), w);
});

test('runEval(gemini 자리): 모두 not_implemented 실패, 네트워크 없음', async () => {
  const r = await runEval({cases: cases.slice(0, 3), fixtures, providerName: 'gemini', repeat: 1, config: getConfig({LLM_SYMPTOM_MODE: 'full', LLM_PROVIDER: 'gemini'})});
  assert.deepEqual(r.metrics.failuresByReason, {not_implemented: 3});
});

test('compareRows: 두 결과를 나란히', async () => {
  const a = await runEval({cases, fixtures, providerName: 'mock', repeat: 1, config});
  const rows = compareRows(a, a);
  assert.equal(rows[0].지표, '응급 놓친 비율');
  assert.ok(rows.every((row) => row.A === row.B));
});

// ── L4 M4: 비용·예산·멈춤 ──
const PRICES = {'spy-model': {input: 1, cachedInput: 0.1, output: 2}};
/** 호출마다 토큰을 돌려주는 가짜 provider(네트워크 없음). 1회 = 입력 100,000 → $0.1 */
function spyFactory({error = null} = {}) {
  let calls = 0;
  const factory = () => ({
    name: 'mock', model: 'spy-model',
    async generateStructured(req) {
      calls += 1;
      const meta = {inputTokens: 100_000, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0};
      if (error) return {ok: false, error, meta: {...meta, httpStatus: 429, errorCode: 'insufficient_quota'}};
      if (req.schemaName === 'profile_extract_v1') return {ok: true, data: {items: []}, meta};
      return {ok: true, data: {intent: 'symptom', status: 'no_match', picks: []}, meta};
    },
  });
  factory.calls = () => calls;
  return factory;
}

test('runEval: 사례별 비용·토큰·캐시 비율·설정 값을 결과에 남긴다', async () => {
  const f = spyFactory();
  const sub = cases.filter((c) => ['c01', 'c02'].includes(c.id));
  const r = await runEval({cases: sub, providerName: 'mock', repeat: 2, config, prices: PRICES, providerFactory: f, budgetUsd: 100});
  // 사례당 증상 분류 1회 × 반복 2 (신호어 없음) = $0.2
  assert.deepEqual(r.cases.map((c) => c.costUsd), [0.2, 0.2]);
  assert.equal(r.costUsd.total, 0.4);
  assert.equal(r.costUsd.perCase, 0.2);
  assert.deepEqual(r.tokens, {input: 400_000, cachedInput: 0, output: 0, reasoning: 0});
  assert.equal(r.cacheInputRatio, 0);
  assert.equal(r.candidateMode, 'retrieve');
  assert.equal(r.model, config.model);
  assert.equal(r.consentSource, 'request');
  assert.deepEqual([r.stoppedByBudget, r.stoppedByError], [false, null]);
});

test('runEval: 누적 비용이 예산을 넘으면 남은 사례를 실행하지 않는다', async () => {
  const f = spyFactory();
  const r = await runEval({cases: cases.slice(0, 10), providerName: 'mock', repeat: 1, config, prices: PRICES, providerFactory: f, budgetUsd: 0.25});
  // 사례당 $0.1(c01~c10은 신호어 없음) → 3번째 사례 뒤 $0.3 > $0.25
  assert.equal(r.stoppedByBudget, true);
  assert.equal(r.caseCount, 3);
  assert.equal(r.casesPlanned, 10);
  assert.equal(f.calls(), 3);
});

test('runEval: 가격을 모르면 비용 null(예산으로 멈추지 않음)', async () => {
  const r = await runEval({cases: cases.slice(0, 2), fixtures, providerName: 'mock', repeat: 1, config, budgetUsd: 0});
  assert.equal(r.costUsd.total, null);
  assert.equal(r.stoppedByBudget, false);
  assert.equal(r.caseCount, 2);
});

test('runEval: quota·auth·bad_request가 나면 그 자리에서 멈춘다(재시도 없음)', async () => {
  assert.deepEqual([...EVAL_STOP_ERRORS], ['auth', 'quota', 'bad_request']);
  const f = spyFactory({error: 'quota'});
  const r = await runEval({cases: cases.slice(0, 5), providerName: 'mock', repeat: 2, config, prices: PRICES, providerFactory: f, budgetUsd: 100});
  assert.equal(r.stoppedByError, 'quota');
  assert.equal(r.caseCount, 1);
  assert.equal(r.cases[0].runs, 1);
  assert.equal(f.calls(), 1);
  assert.deepEqual(r.cases[0].providerError, {httpStatus: 429, code: 'insufficient_quota', param: null});
});

test('runEval: LLM_DEV_CONSENT=true면 consent 없이 개발용 동의 경로', async () => {
  const f = spyFactory();
  const cfg = getConfig({LLM_SYMPTOM_MODE: 'full', LLM_PROVIDER: 'mock', LLM_DEV_CONSENT: 'true'});
  const r = await runEval({cases: cases.slice(0, 1), providerName: 'mock', repeat: 1, config: cfg, prices: PRICES, providerFactory: f, budgetUsd: 100});
  assert.equal(r.consentSource, 'dev');
  assert.equal(f.calls(), 1);
});
