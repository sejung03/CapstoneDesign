import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateSymptomPick, validateProfileItems} from '../validate.mjs';
import {loadRefData} from '../ref-data.mjs';
import {buildCandidates} from '../candidates.mjs';

const ref = loadRefData();
const eligible = buildCandidates('', ref, {mode: 'all'}).map((c) => c.symptomId);
const cands = eligible.slice(0, 15);

test('validateSymptomPick: 정상', () => {
  const r = validateSymptomPick({intent: 'symptom', status: 'matched', picks: [cands[2], cands[0]]}, cands, ref);
  assert.deepEqual(r, {ok: true, intent: 'symptom', status: 'matched', picks: [cands[2], cands[0]], dropped: {unknownId: 0, duplicate: 0, overLimit: 0}});
});

test('validateSymptomPick: 없는 ID·후보 밖 ID·fallback ID는 버림', () => {
  const outside = eligible[20];
  const r = validateSymptomPick({intent: 'symptom', status: 'matched', picks: ['ZZZ', outside, 'K01', cands[1]]}, [...cands, 'K01'], ref);
  assert.deepEqual(r.picks, [cands[1]]);
  assert.equal(r.dropped.unknownId, 3);
});

test('validateSymptomPick: 중복 제거', () => {
  const r = validateSymptomPick({intent: 'symptom', status: 'matched', picks: [cands[0], cands[1], cands[0]]}, cands, ref);
  assert.deepEqual(r.picks, [cands[0], cands[1]]);
  assert.equal(r.dropped.duplicate, 1);
});

test('validateSymptomPick: 11개 이상이면 앞 10개만', () => {
  const r = validateSymptomPick({intent: 'symptom', status: 'matched', picks: cands.slice(0, 13)}, cands, ref);
  assert.deepEqual(r.picks, cands.slice(0, 10));
  assert.equal(r.dropped.overLimit, 3);
});

test('validateSymptomPick: matched인데 picks 0 → no_match', () => {
  const r = validateSymptomPick({intent: 'symptom', status: 'matched', picks: ['ZZZ']}, cands, ref);
  assert.equal(r.status, 'no_match');
  assert.deepEqual(r.picks, []);
});

test('validateSymptomPick: no_match·unclear면 picks를 쓰지 않는다', () => {
  for (const status of ['no_match', 'unclear']) {
    const r = validateSymptomPick({intent: 'symptom', status, picks: [cands[0]]}, cands, ref);
    assert.equal(r.status, status);
    assert.deepEqual(r.picks, []);
  }
});

test('validateSymptomPick: 형식 깨진 JSON·스키마 위반 → bad_json', () => {
  const bads = [
    '{"intent":"symptom", "status":',
    'null', '[]', 42,
    {intent: 'symptom', status: 'matched'},
    {intent: 'diagnosis', status: 'matched', picks: []},
    {intent: 'symptom', status: 'maybe', picks: []},
    {intent: 'symptom', status: 'matched', picks: 'A01'},
    {intent: 'symptom', status: 'matched', picks: [1]},
    {intent: 'symptom', status: 'matched', picks: [], reason: 'x'},
  ];
  for (const b of bads) {
    const r = validateSymptomPick(b, cands, ref);
    assert.equal(r.ok, false, JSON.stringify(b));
    assert.equal(r.error, 'bad_json');
  }
});

test('validateSymptomPick: JSON 문자열도 받는다', () => {
  const r = validateSymptomPick(JSON.stringify({intent: 'facility_search', status: 'no_match', picks: []}), cands, ref);
  assert.equal(r.ok, true);
  assert.equal(r.intent, 'facility_search');
});

// ---- profile ----
const msgs = ['저는 32살이고 혈압약을 먹고 있어요.', '땅콩 알레르기가 있어요. 머리가 아파요.'];
const item = (o) => ({field: 'medications', value: '혈압약', messageIndex: 0, quote: '혈압약을 먹고 있어요', ...o});

test('validateProfileItems: 정상 → 0.18.0 형식', () => {
  const r = validateProfileItems({items: [
    item({field: 'age', value: '32', quote: '저는 32살이고'}),
    item({}),
    item({field: 'allergies', value: '땅콩', messageIndex: 1, quote: '땅콩 알레르기가 있어요'}),
  ]}, msgs);
  assert.equal(r.ok, true);
  assert.deepEqual(r.items, [
    {id: 'age-1', field: 'age', operation: 'set', value: '32', evidence: {kind: 'message', index: 0, quote: '저는 32살이고'}},
    {id: 'medications-1', field: 'medications', operation: 'set', value: '혈압약', evidence: {kind: 'message', index: 0, quote: '혈압약을 먹고 있어요'}},
    {id: 'allergies-1', field: 'allergies', operation: 'set', value: '땅콩', evidence: {kind: 'message', index: 1, quote: '땅콩 알레르기가 있어요'}},
  ]);
});

test('validateProfileItems: quote가 메시지에 없으면 그 항목만 버림', () => {
  const r = validateProfileItems({items: [item({quote: '당뇨약을 먹고 있어요'}), item({field: 'age', value: '32', quote: '32살'})]}, msgs);
  assert.deepEqual(r.items.map((i) => i.field), ['age']);
  assert.equal(r.dropped.quoteNotFound, 1);
});

test('validateProfileItems: 띄어쓰기만 다른 quote는 버림(프론트가 원문 포함으로 검사)', () => {
  const r = validateProfileItems({items: [item({quote: '혈압약을 먹고있어요'})]}, msgs);
  assert.equal(r.items.length, 0);
  assert.equal(r.dropped.quoteNotFound, 1);
});

test('validateProfileItems: value가 quote에 없으면 버림', () => {
  const r = validateProfileItems({items: [item({value: '고혈압'})]}, msgs);
  assert.equal(r.items.length, 0);
  assert.equal(r.dropped.valueNotInQuote, 1);
});

test('validateProfileItems: age 121·"서른"·quote에 없는 숫자는 버림', () => {
  const m = ['저는 121살이에요', '서른 살이에요', '32살이에요'];
  const r = validateProfileItems({items: [
    {field: 'age', value: '121', messageIndex: 0, quote: '121살'},
  ]}, m);
  assert.equal(r.dropped.ageInvalid, 1);
  const r2 = validateProfileItems({items: [{field: 'age', value: '서른', messageIndex: 1, quote: '서른 살'}]}, m);
  assert.equal(r2.dropped.ageInvalid, 1);
  const r3 = validateProfileItems({items: [{field: 'age', value: '30', messageIndex: 1, quote: '서른 살'}]}, m);
  assert.equal(r3.dropped.valueNotInQuote, 1);
  const r4 = validateProfileItems({items: [{field: 'age', value: '33', messageIndex: 2, quote: '32살'}]}, m);
  assert.equal(r4.dropped.valueNotInQuote, 1);
  for (const x of [r, r2, r3, r4]) assert.deepEqual(x.items, []);
});

test('validateProfileItems: age 0과 120은 통과, 앞 0은 정리', () => {
  const r = validateProfileItems({items: [{field: 'age', value: '120', messageIndex: 0, quote: '120세'}]}, ['저는 120세']);
  assert.equal(r.items[0].value, '120');
  const r2 = validateProfileItems({items: [{field: 'age', value: '0', messageIndex: 0, quote: '0살'}]}, ['아기는 0살']);
  assert.equal(r2.items[0].value, '0');
});

test('validateProfileItems: 공백 value·빈 quote는 버림', () => {
  const r = validateProfileItems({items: [item({value: '   '})]}, msgs);
  assert.equal(r.dropped.valueInvalid, 1);
  const r2 = validateProfileItems({items: [item({quote: ' '})]}, msgs);
  assert.equal(r2.dropped.quoteNotFound, 1);
});

test('validateProfileItems: messageIndex 범위 밖은 버림', () => {
  const r = validateProfileItems({items: [item({messageIndex: 2}), item({field: 'history', messageIndex: -1})]}, msgs);
  assert.equal(r.dropped.indexOutOfRange, 2);
  assert.deepEqual(r.items, []);
});

test('validateProfileItems: field 중복 → 첫 항목만', () => {
  const r = validateProfileItems({items: [item({}), item({value: '혈압약을', quote: '혈압약을 먹고'})]}, msgs);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].evidence.quote, '혈압약을 먹고 있어요');
  assert.equal(r.dropped.duplicateField, 1);
});

test('validateProfileItems: 5개 이상 → 최대 4개(중복 field 제외)', () => {
  const m = ['32살, 땅콩 알레르기, 혈압약 복용, 맹장 수술, 아스피린 복용'];
  const r = validateProfileItems({items: [
    {field: 'age', value: '32', messageIndex: 0, quote: '32살'},
    {field: 'allergies', value: '땅콩', messageIndex: 0, quote: '땅콩 알레르기'},
    {field: 'medications', value: '혈압약', messageIndex: 0, quote: '혈압약 복용'},
    {field: 'history', value: '맹장 수술', messageIndex: 0, quote: '맹장 수술'},
    {field: 'medications', value: '아스피린', messageIndex: 0, quote: '아스피린 복용'},
  ]}, m);
  assert.equal(r.items.length, 4);
  assert.equal(new Set(r.items.map((i) => i.id)).size, 4);
  assert.equal(r.dropped.duplicateField, 1);
});

test('validateProfileItems: 형식 위반 항목만 버리고 나머지는 유지', () => {
  const r = validateProfileItems({items: [
    {field: 'weight', value: '70', messageIndex: 0, quote: '32살'},
    {field: 'age', value: 32, messageIndex: 0, quote: '32살'},
    {field: 'age', value: '32', messageIndex: '0', quote: '32살'},
    item({}),
  ]}, msgs);
  assert.equal(r.dropped.badShape, 3);
  assert.deepEqual(r.items.map((i) => i.field), ['medications']);
});

test('validateProfileItems: 응답 전체가 깨지면 bad_json, items []', () => {
  for (const b of ['{', null, [], {items: 'x'}, {foo: []}, {items: [], extra: 1}]) {
    const r = validateProfileItems(b, msgs);
    assert.equal(r.ok, false);
    assert.equal(r.error, 'bad_json');
    assert.deepEqual(r.items, []);
  }
});

test('validateProfileItems: 결과는 프론트 계약(id 형식·field 중복 없음·value 500자)을 지킨다', () => {
  const r = validateProfileItems({items: [item({}), item({field: 'age', value: '32', quote: '32살'})]}, msgs);
  for (const it of r.items) {
    assert.match(it.id, /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/);
    assert.ok(it.value.trim() && it.value.length <= 500);
    assert.ok(msgs[it.evidence.index].includes(it.evidence.quote));
  }
});
