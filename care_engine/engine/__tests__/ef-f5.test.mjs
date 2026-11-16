// 11/17 EF F5(G7 테스트 빈틈): S1·I1 시뮬레이터 회귀, reason previousReport·intake, 요약 본문 원문 유출,
// 건강정보 추출 시간 초과, 진료과 추천 = DB 함수 전수 대조. 문장은 모두 지어낸 짧은 문장이다.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {simulate, scenarios} from '../../eval/engine_scenarios.mjs';
import {call, fakeLlm, data, ref, SAFE_BASE} from './helpers.mjs';
import {recommend, symptomSexMismatch} from '../recommend.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const scenario = (name) => scenarios().find((s) => s.name === name);

// ---- S1·I1 회귀(시뮬레이터) ----
test('F5 S1 회귀(시뮬레이터): 병원 찾기 문장 7문항 → search, 위험+병원 문장은 Q0부터 → 긴급 안내(search 없음)', async () => {
  const h = await simulate(scenario('hospital_keyword'));
  assert.deepEqual(h.asked, ['Q0', 'N1', 'N2', 'N3', 'T1', 'T2', 'T3']);
  assert.deepEqual(h.final, {search: {type: 'hospital', department: 'orthopedics'}});
  const r = await simulate(scenario('risk_hospital_keyword'));
  assert.deepEqual(r.asked, ['Q0', 'N1', 'N2']);
  assert.equal(r.resultKind, 'emergency');
  assert.equal(r.final.search, undefined);
  assert.equal(r.llmCalls.classify, 0);
});

test('F5 I1 회귀(시뮬레이터): sym_other → LLM 실패 → SYM_NOT_FOUND → N5…, 반복 없음, LLM 분류 1번', async () => {
  const r = await simulate(scenario('i1_other_llm_fail'));
  assert.equal(r.asked.filter((id) => id === 'SYM_NOT_FOUND').length, 1);
  assert.equal(r.asked[r.asked.indexOf('SYM_NOT_FOUND') + 1], 'N5');
  assert.ok(r.asked.includes('F2'));
  assert.equal(r.llmCalls.classify, 1);
  assert.equal(r.resultKind, 'recommend');
});

// ---- reason previousReport·intake ----
const MARK = 'LEAK_SENTINEL_ef5';
const EXTRA = {
  previousReport: {summary: {ko: `이전 분석서 ${MARK}`}, answers: [{questionId: 'Q0', value: 'yes'}]},
  intake: {answers: [{questionId: 'Q0', value: 'yes'}], note: MARK},
};

test('F5: reason previousReport·intake — 내용을 읽지 않고 일반 흐름과 같은 응답, 안전 규칙 먼저', async () => {
  const cases = [
    {messages: ['기침이 나요'], answers: {}},
    {messages: ['기침이 나요'], answers: {Q0: 'no'}},
    {messages: ['속이 영 이상하고 불편해요'], answers: {...SAFE_BASE}},
    {messages: ['기침이 나요'], answers: {...SAFE_BASE, SYM_DICT_CONFIRM: 'sym_R05', N5: 'no'}},
    {messages: ['지금 문 연 약국을 찾고 싶어요'], answers: {}},
  ];
  for (const c of cases) {
    const base = await call({reason: 'followup', ...c, llm: fakeLlm()});
    for (const reason of ['previousReport', 'intake']) {
      const llm = fakeLlm();
      const got = await call({reason, ...c, llm, extra: EXTRA});
      assert.deepEqual(got.out.response, base.out.response, `${reason} ${JSON.stringify(c.answers)}`);
      assert.equal(got.out.trace.reason, reason);
      const seen = JSON.stringify({response: got.out.response, trace: got.out.trace, logs: got.logs, llm: llm.calls.classify.map((i) => i.text)});
      assert.ok(!seen.includes(MARK), `${reason}: 내용이 쓰였음`);
    }
  }
  // 안전 규칙이 먼저: 답에 Q0=예가 있으면(previousReport·intake 내용과 상관없이) 응급
  for (const reason of ['previousReport', 'intake']) {
    const {out} = await call({reason, messages: ['지금 문 연 약국을 찾고 싶어요'], answers: {Q0: 'no', N1: 'no'}, extra: EXTRA});
    assert.equal(out.response.emergency.active, true, reason);
    assert.equal(out.response.search, undefined, reason);
    // 내용의 Q0=예를 답으로 쓰지 않는다: 답이 없으면 응급 아님
    const none = await call({reason, messages: ['기침이 나요'], answers: {}, extra: EXTRA});
    assert.equal(none.out.response.emergency, undefined, reason);
    assert.equal(none.out.response.followUp.id, 'Q0', reason);
  }
});

// ---- 요약 본문 원문 유출 ----
test('F5: 요약·응급·질문 본문에 사용자 원문(표식 문자열)이 없다 — 모든 시나리오', async () => {
  let checked = 0;
  for (const s of scenarios()) {
    const r = await simulate({...s, name: `leak_${s.name}`, messages: s.messages.map((m) => `${m} ${MARK}`)});
    for (const {response} of r.responses) {
      const {profileUpdates, ...rest} = response; // profileUpdates.evidence.quote는 계약상 원문 조각(프론트가 확인)
      assert.ok(!JSON.stringify(rest).includes(MARK), `${s.name}: 응답 본문에 원문`);
      if (response.summary) checked += 1;
    }
  }
  assert.ok(checked >= 15, `요약이 나온 응답 ${checked}개`);
});

// ---- 건강정보 추출 시간 초과 ----
test('F5: 건강정보 추출이 deadline을 넘기면 profileUpdates 없이 정상 완료(기다리지 않음)', async () => {
  const llm = fakeLlm({profile: () => new Promise((resolve) => setTimeout(() => resolve({items: [{id: 'p1', field: 'allergies', value: 'x', evidence: {messageIndex: 0, quote: 'x'}}], meta: {}}), 800))});
  const started = Date.now();
  const {out, calls} = await call({reason: 'skip', messages: ['기침이 나요'], answers: {...SAFE_BASE, SYM_DICT_CONFIRM: 'sym_R05'}, llm, ctx: {deadlineAt: Date.now() + 120}});
  assert.ok(Date.now() - started < 600, '늦은 추출을 기다림');
  assert.equal(calls.profile.length, 1);
  assert.ok(out.response.summary && out.response.search);
  assert.equal(out.response.profileUpdates, undefined);
  assert.equal(out.trace.llm.profile.error, 'timeout');
});

// ---- 진료과 추천 = DB 함수 전수 대조 ----
// data_pipeline/db/migrations/001b_ref_functions.sql의 ref.recommend_departments를 테스트 안에서 그대로 재현한다(파일은 읽기만):
//  p_sex: female|male|unknown 그 밖은 unknown / p_age: null → unknown, <= 18 → child, 그 밖 → adult
//  not sd.fallback 이고 (증상, 성별, 나이대) variant 행이 있으면 그 행들(rank 순), 아니면 fallback 행 1개
const SQL = readFileSync(path.resolve(HERE, '../../../data_pipeline/db/migrations/001b_ref_functions.sql'), 'utf8');
const AGE_OF = {child: 10, adult: 40, unknown: null}; // 설계 §8-1
function dbRecommend(symptomId, pSex, pAge) {
  const sex = ['female', 'male', 'unknown'].includes(pSex) ? pSex : 'unknown';
  const ageBand = pAge === null ? 'unknown' : pAge <= 18 ? 'child' : 'adult';
  const sd = data.symptomDept.get(symptomId);
  if (!sd) return null;
  const rows = sd.fallback ? [] : [...(data.variants.get(`${symptomId}|${sex}|${ageBand}`) ?? [])].sort((a, b) => a.rank - b.rank);
  if (sd.fallback || rows.length === 0) return {fallback: true, depts: []};
  return {fallback: false, depts: rows.map((r) => r.deptId)};
}
/** runCare 완료 단계와 같은 판단: 성별 불일치면 증상 모름(I2), F2 없음. */
function engineRecommend(symptomId, sex, ageBand, {guard = true} = {}) {
  const s = ref.symptoms.get(symptomId);
  const symptom = guard && symptomSexMismatch(s, sex) ? null : s;
  const rec = recommend({symptom, filter: {sex, ageBand}, injuryAnswer: false, data});
  return {fallback: rec.group !== null, depts: rec.departments.map((d) => d.deptId)};
}

test('F5: 진료과 전수 대조 — 증상 197 × 성별 3 × 나이대 3 = 1,773가지, 차이는 I2(성별 불일치 → 모름)만', (t) => {
  // SQL 파일이 재현한 규칙과 같은지 최소한 확인(함수가 바뀌면 이 테스트를 다시 봐야 한다)
  assert.match(SQL, /when p_age <= 18 then 'child'/);
  assert.match(SQL, /and not sd\.fallback/);
  assert.match(SQL, /v\.sex = p\.sex and v\.age_band = p\.age_band/);
  const max = data.appConfig.max_recommendations;
  const ids = [...data.symptomDept.keys()];
  assert.equal(ids.length, 197);
  let total = 0;
  const diffs = [];
  const baselineDiffs = []; // EF 전 엔진(I2 처리 없음)과 DB 함수의 차이 — 검토 기준 63
  const mismatchCases = [];
  for (const id of ids) {
    for (const sex of ['female', 'male', 'unknown']) {
      for (const age of ['child', 'adult', 'unknown']) {
        total += 1;
        const db = dbRecommend(id, sex, AGE_OF[age]);
        const dbView = {fallback: db.fallback, depts: db.depts.slice(0, max)};
        const same = (e) => e.fallback === dbView.fallback && (e.fallback || JSON.stringify(e.depts) === JSON.stringify(dbView.depts));
        const mismatch = symptomSexMismatch(ref.symptoms.get(id), sex);
        if (mismatch) mismatchCases.push(`${id}|${sex}|${age}`);
        if (!same(engineRecommend(id, sex, age))) diffs.push({key: `${id}|${sex}|${age}`, mismatch});
        if (!same(engineRecommend(id, sex, age, {guard: false}))) baselineDiffs.push(`${id}|${sex}|${age}`);
      }
    }
  }
  assert.equal(total, 1773);
  assert.deepEqual(diffs.filter((x) => !x.mismatch), [], 'I2 밖의 차이');
  t.diagnostic(`전수 ${total}, 차이 ${diffs.length}(모두 I2), 성별 불일치 경우 ${mismatchCases.length}, EF 전 차이 ${baselineDiffs.length}`);
  assert.equal(baselineDiffs.length, 63, 'EF 전 차이(검토 기준 63, 시드 v2.1-20261113)');
  // 시드 v2.1-20261113 기준 숫자(보고서에 적은 값). 데이터가 바뀌면 다시 세어 보고서와 함께 고친다.
  //  87 = 여성 제한 후보 증상(W·X 22개) × male × 나이 3 = 66 (이 중 63은 EF 전에도 달랐고, 3은 EF 전에는 우연히 같았다)
  //     + 남성 제한 증상(Y 7개) × female × 나이 3 = 21 (EF 전에는 DB와 같았으나 이제 증상 모름 → general)
  //  성별 불일치 90가지 중 3가지(X20, 상위 증상 → 원래 fallback)는 결과가 같다.
  assert.equal(diffs.length, 87);
  const bySex = (sx) => diffs.filter((x) => x.key.split('|')[1] === sx).length;
  assert.equal(bySex('male'), 66);
  assert.equal(bySex('female'), 21);
  assert.ok(baselineDiffs.every((k) => diffs.some((x) => x.key === k)), 'EF 전 차이 63가지는 모두 I2 경우');
});
