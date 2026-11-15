import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildSymptomConfirm, parseSymptomConfirm, checkFollowUpContract} from '../confirm-question.mjs';
import {loadRefData} from '../ref-data.mjs';
import {buildCandidates} from '../candidates.mjs';

const ref = loadRefData();
const eligible = buildCandidates('', ref, {mode: 'all'}).map((c) => c.symptomId);

function assertContract(fu) {
  const r = checkFollowUpContract(fu);
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
}

for (const n of [1, 10, 15]) {
  test(`buildSymptomConfirm: 후보 ${n}개 → 계약 통과, 증상 최대 10개 + 고정 2개`, () => {
    const picks = eligible.slice(0, n);
    const fu = buildSymptomConfirm(picks, ref, 'ko');
    assertContract(fu);
    const k = Math.min(n, 10);
    assert.equal(fu.options.length, k + 2);
    assert.deepEqual(fu.options.slice(0, k).map((o) => o.id), picks.slice(0, k).map((id) => `sym_${id}`));
    assert.deepEqual(fu.options.slice(-2).map((o) => o.id), ['sym_none', 'sym_unsure']);
    assert.equal(fu.id, 'SYM_CONFIRM');
    assert.equal(fu.type, 'singleChoice');
    assert.equal(fu.required, true);
    assert.equal(fu.label.ko, '말씀하신 증상과 가장 가까운 것을 하나 골라 주세요.');
    assert.equal(fu.options[0].label.ko, ref.symptoms.get(picks[0]).nameKo);
  });
}

test('buildSymptomConfirm: LLM 순서 유지(정렬하지 않음)', () => {
  const picks = [eligible[5], eligible[0], eligible[3]];
  const fu = buildSymptomConfirm(picks, ref);
  assertContract(fu);
  assert.deepEqual(fu.options.slice(0, 3).map((o) => o.id), picks.map((p) => `sym_${p}`));
});

test('buildSymptomConfirm: fallback·없는 ID·상위 증상은 선택지에서 빠지고, 남는 것이 없으면 null', () => {
  const fu = buildSymptomConfirm(['K01', 'ZZZ', 'D20', eligible[0]], ref);
  assertContract(fu);
  assert.deepEqual(fu.options.map((o) => o.id), [`sym_${eligible[0]}`, 'sym_none', 'sym_unsure']);
  assert.equal(buildSymptomConfirm(['K01', 'D20'], ref), null);
  assert.equal(buildSymptomConfirm([], ref), null);
});

test('buildSymptomConfirm: 하이픈 있는 ID(D20-01)도 계약 통과', () => {
  const fu = buildSymptomConfirm(['D20-01'], ref);
  assertContract(fu);
  assert.equal(fu.options[0].id, 'sym_D20-01');
});

test('parseSymptomConfirm: 확정·none·unsure·없음', () => {
  const a = (value) => [{questionId: 'SYM_CONFIRM', value, label: {}, optionLabel: {}}];
  assert.deepEqual(parseSymptomConfirm(a(`sym_${eligible[0]}`), ref), {status: 'confirmed', symptomId: eligible[0]});
  assert.deepEqual(parseSymptomConfirm(a('sym_none'), ref), {status: 'fallback', reason: 'none'});
  assert.deepEqual(parseSymptomConfirm(a('sym_unsure'), ref), {status: 'fallback', reason: 'unsure'});
  assert.deepEqual(parseSymptomConfirm([], ref), {status: 'absent'});
  assert.deepEqual(parseSymptomConfirm(undefined, ref), {status: 'absent'});
  assert.deepEqual(parseSymptomConfirm([{questionId: 'other', value: 'sym_A01'}], ref), {status: 'absent'});
  assert.deepEqual(parseSymptomConfirm(a(null), ref), {status: 'absent'});
});

test('parseSymptomConfirm: 없는 ID·fallback 증상·상위 증상 → fallback', () => {
  const a = (value) => [{questionId: 'SYM_CONFIRM', value}];
  for (const v of ['sym_ZZZ', 'sym_K01', 'sym_D20', 'D01', 42]) {
    assert.equal(parseSymptomConfirm(a(v), ref).status, 'fallback', String(v));
  }
});

test('checkFollowUpContract: 위반을 잡는다', () => {
  const ok = {id: 'q', type: 'singleChoice', required: true, label: {ko: '질문'}, options: [{id: 'a', label: {ko: '가'}}]};
  assertContract(ok);
  const bad = [
    {...ok, id: '한글'},
    {...ok, id: 'x'.repeat(81)},
    {...ok, label: {en: 'only en'}},
    {...ok, label: {ko: 'ㄱ'.repeat(301)}},
    {...ok, options: []},
    {...ok, options: Array.from({length: 13}, (_, i) => ({id: `o${i}`, label: {ko: '가'}}))},
    {...ok, options: [{id: 'a', label: {ko: '가'}}, {id: 'a', label: {ko: '나'}}]},
    {...ok, options: [{id: 'a b', label: {ko: '가'}}]},
    {...ok, options: [{id: 'a', label: {ko: ''}}]},
  ];
  for (const b of bad) assert.equal(checkFollowUpContract(b).ok, false, JSON.stringify(b).slice(0, 80));
});
