import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {runEval, readCases, fixturesToMockMap} from '../run_eval.mjs';
import {compareRows} from '../compare.mjs';
import {getConfig} from '../../llm/config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const cases = readCases(path.join(HERE, '..', 'cases', 'draft_v0.jsonl'));
const fixtures = JSON.parse(readFileSync(path.join(HERE, '..', 'fixtures', 'mock_v0.json'), 'utf8'));
// 1차 mock 기대값은 retrieve 기준으로 손으로 계산했다 → 그 테스트는 retrieve로 고정, all 기본값은 따로 검사
const config = getConfig({LLM_PROVIDER: 'mock', LLM_CANDIDATE_MODE: 'retrieve'});

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
  assert.deepEqual([m.profilePrecision.hit, m.profilePrecision.n], [4, 5]);
  assert.deepEqual([m.profileRecall.hit, m.profileRecall.n], [4, 4]);
  assert.deepEqual([m.candidateSentRecall.hit, m.candidateSentRecall.n], [16, 22]);
  assert.deepEqual([m.candidateRecall['R@40'].hit, m.candidateRecall['R@40'].n], [15, 22]);
  assert.equal(m.emergencyMissRate.value, '미측정');
  assert.deepEqual([m.repeatAgreement.hit, m.repeatAgreement.n], [30, 30]);
  // confirm = 정답 포함 증상 사례 15 + 정답 없이 다른 증상을 고른 c01·c08·c27 3 (c07은 no_match)
  assert.equal(r.statusCounts.confirm, 18);
});

test('runEval(mock, all 기본값): 후보를 전부 보내므로 보낸 후보에 정답 22/22, 나머지 지표는 같다', async () => {
  const r = await runEval({cases, fixtures, providerName: 'mock', repeat: 1, config: getConfig({LLM_PROVIDER: 'mock'})});
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
  const r = await runEval({cases: cases.slice(0, 3), fixtures, providerName: 'gemini', repeat: 1, config: getConfig({LLM_PROVIDER: 'gemini'})});
  assert.deepEqual(r.metrics.failuresByReason, {not_implemented: 3});
});

test('compareRows: 두 결과를 나란히', async () => {
  const a = await runEval({cases, fixtures, providerName: 'mock', repeat: 1, config});
  const rows = compareRows(a, a);
  assert.equal(rows[0].지표, '응급 놓친 비율');
  assert.ok(rows.every((row) => row.A === row.B));
});
