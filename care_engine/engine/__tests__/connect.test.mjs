// 11/17 프론트 연결: 내 정보 나이로 T3 채우기, Supabase 표(REST JSON)로 같은 데이터 만들기, LLM이 엔진 데이터를 쓰기.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {parseCsv, DEFAULT_CSV_DIR, toCsvRow, JSONB_COLUMNS} from '../../llm/ref-data.mjs';
import {loadIntakeDataFromRows, IntakeDataError} from '../intake-data.mjs';
import {ageBandCode} from '../constants.mjs';
import {call, data, CONSENT} from './helpers.mjs';

const BEFORE_T3 = {Q0: 'no', N1: 'yes', N2: 'yes', N3: 'no', T1: 'self', T2: 'female'};
const profile = (age) => ({profile: {age, allergies: '', medications: '', history: ''}});

test('연결: 본인 상담이면 내 정보 만 나이로 T3를 채우고 T3를 묻지 않는다(값은 trace에 없음)', async () => {
  const asked = await call({reason: 'followup', messages: ['기침이 나요'], answers: BEFORE_T3});
  assert.equal(asked.out.response.followUp.id, 'T3');
  const filled = await call({reason: 'followup', messages: ['기침이 나요'], answers: BEFORE_T3, extra: profile('34')});
  assert.notEqual(filled.out.response.followUp?.id, 'T3');
  assert.deepEqual(filled.out.trace.prefilled, ['T3']);
  assert.ok(!JSON.stringify(filled.out.trace).includes('34'));
});

test('연결: 본인이 아니거나, T3 답이 있거나, 나이가 숫자가 아니면 채우지 않는다', async () => {
  for (const [answers, age] of [[{...BEFORE_T3, T1: 'child'}, '34'], [{...BEFORE_T3, T3: 'age_65plus'}, '34'], [BEFORE_T3, '서른'], [BEFORE_T3, '200'], [BEFORE_T3, '']]) {
    const {out} = await call({reason: 'followup', messages: ['기침이 나요'], answers, extra: profile(age)});
    assert.deepEqual(out.trace.prefilled, [], `${answers.T1} ${age}`);
  }
});

test('연결: 나이 → T3 구간은 시드 선택지와 같다', () => {
  assert.deepEqual([0, 1, 12, 13, 18, 19, 64, 65, 120].map(ageBandCode),
    ['age_lt1', 'age_1_12', 'age_1_12', 'age_13_18', 'age_13_18', 'age_19_64', 'age_19_64', 'age_65plus', 'age_65plus']);
  assert.equal(ageBandCode(-1), null);
  assert.equal(ageBandCode(121), null);
  const codes = data.optionsById.get('T3').map((o) => o.code);
  for (const c of ['age_lt1', 'age_1_12', 'age_13_18', 'age_19_64', 'age_65plus']) assert.ok(codes.includes(c), c);
});

test('연결: toCsvRow — DB 값을 CSV 문자열 형식으로', () => {
  assert.deepEqual(toCsvRow({a: null, b: true, c: false, d: 3, e: ['x', 'y'], f: [1, 2], g: {k: 1}, h: 'z'}),
    {a: '', b: 'true', c: 'false', d: '3', e: '{x,y}', f: '{1,2}', g: '{"k":1}', h: 'z'});
  assert.deepEqual(toCsvRow({value: ['S12', 'S13']}, ['value']), {value: '["S12","S13"]'});
  assert.deepEqual(toCsvRow({value: 18}, ['value']), {value: '18'});
});

/** 시드 CSV를 Supabase REST가 돌려주는 JSON 형식(불리언·숫자·배열·jsonb)으로 바꾼 표. */
function restLikeTables() {
  const files = ['data_version', 'questionnaire', 'questionnaire_item', 'questionnaire_answer_option', 'questionnaire_enable_when',
    'safety_rule', 'safety_rule_condition', 'output_mapping', 'department', 'symptom', 'symptom_department',
    'symptom_department_variant', 'symptom_synonym', 'fallback_department', 'app_config'];
  const tables = {};
  for (const f of files) {
    const rows = parseCsv(readFileSync(path.join(DEFAULT_CSV_DIR, `${f}.csv`), 'utf8'));
    tables[f] = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => {
      if ((JSONB_COLUMNS[f] ?? []).includes(k)) return [k, JSON.parse(v)];
      if (v === '') return [k, null];
      if (v === 'true' || v === 'false') return [k, v === 'true'];
      if (/^\{.*\}$/.test(v)) return [k, v.slice(1, -1) === '' ? [] : v.slice(1, -1).split(',')];
      return [k, v];
    })));
  }
  return tables;
}

test('연결: Supabase 표 형식으로 만든 데이터가 CSV 데이터와 같다(source만 다름)', () => {
  const fromRows = loadIntakeDataFromRows(restLikeTables());
  assert.equal(fromRows.source, 'supabase');
  assert.equal(fromRows.refData.source, 'supabase');
  const strip = (d) => ({...d, source: null, refData: {...d.refData, source: null}});
  assert.deepStrictEqual(strip(fromRows), strip(data));
});

test('연결: 표가 빠지면 IntakeDataError(엔진은 error:data)', () => {
  const t = restLikeTables();
  delete t.safety_rule;
  assert.throws(() => loadIntakeDataFromRows(t), IntakeDataError);
});

test('연결: 엔진이 넘긴 데이터(refStore)를 LLM 증상 분류도 쓴다', async () => {
  // 후보 증상을 5개만 남긴 데이터를 넘기면 LLM 후보 수도 5개여야 한다(전에는 LLM이 CSV를 따로 읽어 178개)
  let kept = 0;
  const symptoms = new Map([...data.refData.symptoms].map(([id, s]) => [id, s.isCandidate && kept++ >= 5 ? {...s, isCandidate: false} : s]));
  const marked = {...data, refData: {...data.refData, symptoms}};
  const {out} = await call({reason: 'followup', messages: ['몸이 좀 이상한 느낌이에요'], answers: {...BEFORE_T3, T3: 'age_19_64'},
    llm: {calls: {}, llm: undefined}, deps: {refStore: marked}, ctx: {consent: CONSENT}});
  assert.equal(out.trace.llm.classify.called, true);
  assert.equal(out.trace.llm.classify.candidateCount, 5);
});
