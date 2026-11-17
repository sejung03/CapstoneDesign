import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {loadIntakeData} from '../intake-data.mjs';
import {normalizeAnswers, isVisible, visibleCodes} from '../answers.mjs';
import {evaluateSafety} from '../rules.mjs';
import {compileFreeTextRules, loadFreeTextRules, matchFreeText, FreeTextRuleError} from '../free-text.mjs';

const data = loadIntakeData();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const testRules = loadFreeTextRules(path.join(HERE, 'fixtures', 'free_text_test.json'));

const ans = (obj) => Object.entries(obj).map(([questionId, value]) => ({questionId, value}));
const norm = (obj) => normalizeAnswers(ans(obj), data);
function safety(obj, messages = [], freeTextRules = null) {
  const {codes} = norm(obj);
  return evaluateSafety({codes: visibleCodes(codes, data), messages, data, freeTextRules});
}
const hitIds = (r) => r.hits.map((h) => h.ruleId);

test('normalizeAnswers: 같은 질문은 마지막 것, null은 미응답, 없는 code는 버리고 경고(값 없음)', () => {
  const r = normalizeAnswers([
    {questionId: 'Q0', value: 'yes'}, {questionId: 'Q0', value: 'no'},
    {questionId: 'N1', value: 'maybe-secret'},
    {questionId: 'N2', value: 'no'}, {questionId: 'N2', value: null},
    {questionId: 'SYM_DICT_CONFIRM', value: 'sym_R05'},
    {questionId: 'MED_CHOICE', value: 'med_info'},
    {questionId: 'WHATEVER', value: 'x'},
    {questionId: 'bad id!', value: 'x'},
    null, {value: 'x'},
  ], data);
  assert.deepEqual([...r.codes], [['Q0', 'no']]);
  assert.deepEqual([...r.engine], [['SYM_DICT_CONFIRM', 'sym_R05'], ['MED_CHOICE', 'med_info']]);
  assert.deepEqual(r.warnings, ['invalid_answer:N1', 'unknown_question:WHATEVER', 'unknown_question']);
  assert.ok(!JSON.stringify(r.warnings).includes('maybe-secret'));
  assert.deepEqual(normalizeAnswers(undefined, data).codes.size, 0);
});

test('enableWhen "=": Q0=no일 때만 N1이 보임, 답이 없으면 거짓', () => {
  assert.equal(isVisible('N1', new Map(), data), false);
  assert.equal(isVisible('N1', new Map([['Q0', 'no']]), data), true);
  assert.equal(isVisible('N1', new Map([['Q0', 'yes']]), data), false);
  assert.equal(isVisible('Q0', new Map(), data), true);
});

test('enableWhen "exists": N5에 답이 있으면 N5-1이 보임', () => {
  assert.equal(isVisible('N5-1', new Map([['Q0', 'no']]), data), false);
  assert.equal(isVisible('N5-1', new Map([['Q0', 'no'], ['N5', 'yes']]), data), true);
  assert.equal(isVisible('N5-1', new Map([['Q0', 'no'], ['N5', 'no']]), data), true);
  // 가리킨 N5가 숨겨지면(Q0=yes) 답이 있어도 없는 것으로 본다
  assert.equal(isVisible('N5-1', new Map([['Q0', 'yes'], ['N5', 'yes']]), data), false);
});

test('enableWhen "!=": 가리킨 문항이 숨겨지거나 답이 없으면 거짓 (합성 데이터)', () => {
  const fake = {
    itemById: new Map([['A', {linkId: 'A', enableBehavior: 'all'}], ['B', {linkId: 'B', enableBehavior: 'all'}], ['C', {linkId: 'C', enableBehavior: 'any'}]]),
    enableWhenById: new Map([
      ['B', [{question: 'A', operator: '!=', answer: 'x'}]],
      ['C', [{question: 'A', operator: '=', answer: 'x'}, {question: 'B', operator: 'exists', answer: true}]],
    ]),
  };
  assert.equal(isVisible('B', new Map(), fake), false);
  assert.equal(isVisible('B', new Map([['A', 'x']]), fake), false);
  assert.equal(isVisible('B', new Map([['A', 'y']]), fake), true);
  // enable_behavior any
  assert.equal(isVisible('C', new Map([['A', 'x']]), fake), true);
  assert.equal(isVisible('C', new Map([['A', 'y'], ['B', 'z']]), fake), true);
  assert.equal(isVisible('C', new Map([['A', 'y']]), fake), false);
});

test('visibleCodes: 숨겨진 문항의 답은 뺀다', () => {
  const {codes} = norm({Q0: 'yes', N1: 'no', E1: 'yes'});
  assert.deepEqual([...visibleCodes(codes, data)], [['Q0', 'yes'], ['E1', 'yes']]);
});

test('R-Q0-EMERGENCY: Q0=yes 걸림, no 안 걸림, 미응답 안 걸림', () => {
  assert.deepEqual(hitIds(safety({Q0: 'yes'})), ['R-Q0-EMERGENCY']);
  assert.equal(safety({Q0: 'yes'}).top.result, 'EMERGENCY_STOP');
  assert.deepEqual(hitIds(safety({Q0: 'no'})), []);
  assert.deepEqual(hitIds(safety({})), []);
});

for (const [q, rule, risky, safe] of [
  ['N1', 'R-N1-CONSCIOUSNESS', ['no', 'unknown'], 'yes'],
  ['N2', 'R-N2-BREATHING', ['no', 'unknown'], 'yes'],
  ['N3', 'R-N3-RED-FLAGS', ['yes', 'unknown'], 'no'],
]) {
  test(`${rule}: 위험 답·unknown 걸림, 안전 답·미응답 안 걸림, 숨겨지면 무시`, () => {
    for (const v of risky) {
      const r = safety({Q0: 'no', [q]: v});
      assert.deepEqual(hitIds(r), [rule], `${q}=${v}`);
      assert.equal(r.top.result, 'URGENT_NOTICE');
      assert.equal(r.top.terminal, true);
    }
    assert.deepEqual(hitIds(safety({Q0: 'no', [q]: safe})), []);
    assert.deepEqual(hitIds(safety({Q0: 'no'})), []);
    // Q0=yes이면 N 문항은 숨겨지므로 그 답은 무시(Q0 규칙만)
    assert.deepEqual(hitIds(safety({Q0: 'yes', [q]: risky[0]})), ['R-Q0-EMERGENCY']);
    // Q0 미응답이면 숨겨짐
    assert.deepEqual(hitIds(safety({[q]: risky[0]})), []);
  });
}

test('여러 개 걸리면 priority가 가장 작은 것이 top, 걸린 규칙은 모두 hits', () => {
  const r = safety({Q0: 'no', N1: 'unknown', N2: 'no', N3: 'yes'});
  assert.deepEqual(hitIds(r), ['R-N1-CONSCIOUSNESS', 'R-N2-BREATHING', 'R-N3-RED-FLAGS']);
  assert.equal(r.top.ruleId, 'R-N1-CONSCIOUSNESS');
  const r2 = safety({Q0: 'no', N2: 'unknown', N3: 'unknown'});
  assert.equal(r2.top.ruleId, 'R-N2-BREATHING');
});

test('자유 입력 규칙(테스트 전용): 정규화 후 검사, 답 규칙보다 먼저(priority 작음), rule_id만', () => {
  const r = safety({Q0: 'no', N1: 'no'}, ['테스트 위험 표현이 있어요'], testRules);
  assert.deepEqual(hitIds(r), ['FT-TEST-STOP', 'R-N1-CONSCIOUSNESS']);
  assert.equal(r.top.ruleId, 'FT-TEST-STOP');
  assert.equal(r.top.source, 'free_text');
  assert.ok(!JSON.stringify(r).includes('있어요'));
  assert.deepEqual(hitIds(safety({}, ['아무 문제 없는 문장'], testRules)), []);
  assert.deepEqual(matchFreeText(['ＴＥＳＴ', '테스트 주의 표현'], testRules), ['FT-TEST-NOTICE']);
});

test('기본 자유 입력 규칙 파일: 형식 통과, 위험 표현 사전 v1(11/17 R: 40개, RF3: 42개), 테스트 단어는 걸리지 않음', () => {
  const def = loadFreeTextRules();
  assert.equal(def.version, 'free-text-v1');
  assert.equal(def.rules.length, 42);
  assert.deepEqual(matchFreeText(['테스트위험표현'], def), []);
});

test('자유 입력 규칙 형식 검사: rule_id·priority·patterns·필수 필드', () => {
  const base = {rule_id: 'FT-X', priority: 5, patterns: ['a'], result: 'EMERGENCY_STOP', terminal: true, message_key: 'k', evidence: {source: 'test_only'}}; // 11/17 RF3: source는 허용 목록(EVIDENCE_SOURCES) 값만
  assert.doesNotThrow(() => compileFreeTextRules({version: 'v', rules: [base]}));
  const bad = [
    {rule_id: 'R-X'}, {priority: 10}, {priority: 0}, {patterns: []}, {patterns: ['(']},
    {result: 'OK'}, {terminal: undefined}, {message_key: ''}, {evidence: undefined},
  ];
  for (const patch of bad) {
    assert.throws(() => compileFreeTextRules({version: 'v', rules: [{...base, ...patch}]}), FreeTextRuleError, JSON.stringify(patch));
  }
  assert.throws(() => compileFreeTextRules({version: 'v', rules: [base, base]}), /중복/);
  assert.throws(() => compileFreeTextRules({rules: []}), /version/);
});
