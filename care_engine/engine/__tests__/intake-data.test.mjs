import {test, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {loadIntakeData, IntakeDataError, DEFAULT_CSV_DIR, parsePgArray} from '../intake-data.mjs';

const data = loadIntakeData();
const temps = [];
after(() => { for (const d of temps) rmSync(d, {recursive: true, force: true}); });

/** 시드를 임시 폴더로 복사하고 파일 하나를 고친다. */
function seedWith(file, edit) {
  const dir = mkdtempSync(path.join(tmpdir(), 'engine-seed-'));
  temps.push(dir);
  cpSync(DEFAULT_CSV_DIR, dir, {recursive: true});
  const p = path.join(dir, file);
  writeFileSync(p, edit(readFileSync(p, 'utf8')), 'utf8');
  return dir;
}

function rejects(file, edit, pattern) {
  const dir = seedWith(file, edit);
  assert.throws(() => loadIntakeData({dir}), (e) => {
    assert.ok(e instanceof IntakeDataError, `IntakeDataError가 아님: ${e}`);
    assert.ok(e.problems.some((p) => pattern.test(p)), `문제 목록에 ${pattern}가 없음: ${e.problems.join(' | ')}`);
    return true;
  });
}

// 11/18 문진 재설계: 상세 문항을 줄임(문항 46 → 27, 선택지 114 → 89, enableWhen 45 → 26, 결과 매핑 54 → 37)
test('개수(11/18 재설계): 문항 27, 선택지 89, enableWhen 26, 안전 규칙 4, 결과 매핑 37, 증상 197', () => {
  assert.equal(data.items.length, 27);
  assert.equal([...data.optionsById.values()].reduce((n, l) => n + l.length, 0), 89);
  assert.equal([...data.enableWhenById.values()].reduce((n, l) => n + l.length, 0), 26);
  assert.equal(data.rules.length, 4);
  assert.equal(data.mappings.length, 37);
  assert.equal(data.refData.symptoms.size, 197);
});

test('버전 하나로 고정, 문진 정보, 캐시', () => {
  assert.equal(data.dataVersion, 'v2.1-20261113');
  assert.equal(data.refData.dataVersion, data.dataVersion);
  assert.deepEqual(data.questionnaire, {id: 'intake-v1', version: 'intake-v1', title: '응급 및 비응급 공통 문진'});
  assert.equal(loadIntakeData(), data);
  assert.deepEqual(data.warnings, []);
});

test('items는 order 순, 규칙은 priority 순, 증상 확인 자리는 데이터에서(report.symptom 매핑)', () => {
  const orders = data.items.map((i) => i.order);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b));
  assert.deepEqual(data.rules.map((r) => r.priority), [10, 20, 30, 40]);
  assert.equal(data.symptomItemId, 'N4');
  assert.equal(data.itemById.get('N4').type, 'string');
});

test('안전 규칙 조건의 Postgres 배열을 배열로 파싱', () => {
  const n1 = data.rules.find((r) => r.ruleId === 'R-N1-CONSCIOUSNESS');
  assert.deepEqual(n1.conditions, [{question: 'N1', operator: 'in', answers: ['no', 'unknown']}]);
  const q0 = data.rules.find((r) => r.ruleId === 'R-Q0-EMERGENCY');
  assert.deepEqual(q0.conditions, [{question: 'Q0', operator: '=', answers: ['yes']}]);
  assert.equal(q0.result, 'EMERGENCY_STOP');
  assert.equal(q0.terminal, true);
  assert.equal(n1.triageCategoryId, 12);
  assert.deepEqual(parsePgArray('{a, "b"}'), ['a', 'b']);
  assert.deepEqual(parsePgArray('{}'), []);
  assert.equal(parsePgArray('a,b'), null);
});

test('선택지·enableWhen·진료과·variant·fallback·app_config', () => {
  assert.deepEqual(data.optionsById.get('T1').map((o) => o.code), ['self', 'child', 'other']);
  assert.equal(data.optionsById.get('N1')[0].displayKo, '예, 괜찮아요');
  assert.deepEqual(data.enableWhenById.get('N5-1'), [{question: 'Q0', operator: '=', answer: 'no'}]); // 11/18: N5를 빼고 N5-1이 시작 시점을 바로 묻는다
  assert.equal(data.itemById.get('P3').engineCondition, 'symptom_is_pain');
  assert.equal(data.itemById.get('N12').engineCondition, 'symptom_not_pain');
  assert.equal(data.itemById.get('Q0').enableBehavior, 'all');
  assert.deepEqual(data.departments.get('internal_medicine'), {deptId: 'internal_medicine', nameKo: '내과', searchKey: 'internal', isGuidable: true, sexOnly: null, maxAge: null});
  const v = data.variants.get('A01|female|adult');
  assert.ok(v.length >= 1 && v[0].rank === 1);
  assert.deepEqual(data.fallbackDepartments.get('general'), ['internal_medicine', 'family_medicine']);
  assert.equal(data.appConfig.max_recommendations, 3);
  assert.deepEqual(data.appConfig.never_recommend, ['emergency_medicine']);
  assert.equal(data.symptomDept.get('A01').fallback, false);
});

test('data_version이 다른 행은 빼고 warnings에 기록', () => {
  const dir = seedWith('questionnaire_answer_option.csv', (t) => `${t.trimEnd()}\nT1,extra_code,9,추가,,v0-other\n`);
  const d = loadIntakeData({dir});
  assert.equal(d.optionsById.get('T1').length, 3);
  assert.ok(d.warnings.some((w) => /questionnaire_answer_option\.csv: data_version 불일치 1행/.test(w)));
});

test('검사 거부: link_id 형식', () => {
  rejects('questionnaire_item.csv', (t) => t.replace('\nP3,intake-v1', '\nP 3,intake-v1'), /link_id 형식/);
});

test('검사 거부: 선택지 code 형식', () => {
  rejects('questionnaire_answer_option.csv', (t) => t.replace('\nT1,self,', '\nT1,se lf,'), /code 형식/);
});

test('검사 거부: 선택지 12개 초과', () => {
  rejects('questionnaire_answer_option.csv', (t) => `${t.trimEnd()}\nP1,pain_11,12,11,,v2.1-20261113\nP1,pain_12,13,12,,v2.1-20261113\n`, /선택지 13개/);
});

test('검사 거부: todo 아닌 choice 문항의 선택지 0개', () => {
  rejects('questionnaire_answer_option.csv', (t) => t.split('\n').filter((l) => !l.startsWith('F2,')).join('\n'), /F2: choice 문항인데 선택지 0개/);
});

test('검사 거부: order 중복', () => {
  rejects('questionnaire_item.csv', (t) => t.replace('\nP3,intake-v1,430,', '\nP3,intake-v1,440,'), /order 440 중복/);
  rejects('questionnaire_item.csv', (t) => t.replace(',symptom_is_pain,', ',symptom_is_sad,'), /engine_condition 'symptom_is_sad'/);
});

test('검사 거부: enableWhen이 뒤 문항을 가리킴', () => {
  rejects('questionnaire_enable_when.csv', (t) => t.replace('\n12,N1,Q0,=,no,', '\n12,N1,T1,=,self,'), /N1: 뒤 문항 'T1'/);
});

test('검사 거부: 지원하지 않는 enableWhen operator', () => {
  rejects('questionnaire_enable_when.csv', (t) => t.replace('\n12,N1,Q0,=,no,', '\n12,N1,Q0,>,no,'), /지원하지 않는 operator '>'/);
});

test('검사 거부: 안전 규칙 조건이 없는 문항·없는 code를 가리킴', () => {
  rejects('safety_rule_condition.csv', (t) => t.replace('\n2,R-N1-CONSCIOUSNESS,N1,', '\n2,R-N1-CONSCIOUSNESS,NX,'), /없는 문항 'NX'/);
  rejects('safety_rule_condition.csv', (t) => t.replace('"{no,unknown}"', '"{no,maybe}"'), /없는 code 'maybe'/);
});

test('검사 거부: 안전 규칙 answers 비어 있음', () => {
  rejects('safety_rule_condition.csv', (t) => t.replace('\n1,R-Q0-EMERGENCY,Q0,=,{yes},', '\n1,R-Q0-EMERGENCY,Q0,=,{},'), /answers 비었거나/);
});

test('검사 거부: 결과 매핑 slot 형식', () => {
  rejects('output_mapping.csv', (t) => t.replace(',card.is_self,', ',card-is-self,'), /slot 형식/);
});

test('검사 거부: 추천에 쓰이는 진료과의 search_key 없음', () => {
  rejects('department.csv', (t) => t.replace(',내과,,,true,,,internal,', ',내과,,,true,,,,'), /internal_medicine'의 search_key 없음/);
});
