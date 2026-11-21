import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadIntakeData} from '../intake-data.mjs';
import {visibleCodes} from '../answers.mjs';
import {evaluateSafety} from '../rules.mjs';
import {nextQuestion, itemToFollowUp, neverAskedItems} from '../flow.mjs';
import {applyMappings, slotEntries} from '../slots.mjs';
import {checkFollowUpContract} from '../../llm/confirm-question.mjs';

const data = loadIntakeData();
const NEVER = ['E3', 'N4', 'N6-2', 'N8-1', 'N9-1', 'N10-1', 'N11-1', 'N13-1', 'P2', 'P3', 'F1', 'F3'];

// 상세 문항까지 "더 묻게 되는" 답(조건부 문항이 모두 열린다)
const OPEN_ALL = {
  Q0: 'no', N1: 'yes', N2: 'yes', N3: 'no', T1: 'self', T2: 'female', T3: 'age_19_64',
  N5: 'yes', 'N5-1': 'onset_today', N6: 'no', 'N6-1': 'freq_daily', N7: 'yes', 'N7-1': 'onset_1_3d',
  N8: 'yes', N9: 'yes', N10: 'yes', N11: 'yes', 'N11-2': 'better', N12: 'yes', 'N12-1': 'sleep', N13: 'yes',
  P0: 'yes', P1: 'pain_5', F2: 'no',
  E1: 'yes', E2: 'yes', E4: 'yes', E5: 'yes', E6: 'no', E7: 'no', E8: 'yes', 'E8-1': 'count_2', E9: 'yes', 'E9-1': 'onset_1_6h',
};

/** 정해진 답으로 끝까지 걸어가며 묻는 순서를 기록한다. identify 자리에서 symptomState를 바꾼다. */
function walk({answers = OPEN_ALL, start = {}, mode = 'normal', after = 'unknown'} = {}) {
  const codes = new Map(Object.entries(start));
  const asked = [];
  let state = 'pending';
  for (let guard = 0; guard < 100; guard += 1) {
    const r = nextQuestion({codes, data, mode, symptomState: state});
    if (r.kind === 'done') return {asked, codes, last: r};
    if (r.kind === 'identify') { asked.push('<identify>'); state = after; continue; }
    asked.push(r.item.linkId);
    assert.ok(r.item.linkId in answers, `답이 준비되지 않은 문항 ${r.item.linkId}`);
    codes.set(r.item.linkId, answers[r.item.linkId]);
  }
  throw new Error('끝나지 않음');
}

test('실제 질문 순서: Q0 → N1~N3 → T1~T3 → 증상 확인 → N5…P1 → F2(증상 모름)', () => {
  const {asked, last} = walk({after: 'unknown'});
  assert.deepEqual(asked, ['Q0', 'N1', 'N2', 'N3', 'T1', 'T2', 'T3', '<identify>',
    'N5', 'N5-1', 'N6', 'N6-1', 'N7', 'N7-1', 'N8', 'N9', 'N10', 'N11', 'N11-2', 'N12', 'N12-1', 'N13', 'P0', 'P1', 'F2']);
  assert.ok(last.skippedItems.includes('N8-1') && last.skippedItems.includes('F3'));
});

test('증상이 정해지면(known) F2는 묻지 않는다', () => {
  const {asked} = walk({after: 'known'});
  assert.ok(!asked.includes('F2'));
  assert.equal(asked.at(-1), 'P1');
});

test('증상 확인 자리는 N4의 order(데이터)로 정한다: T3 미응답이면 T3 먼저', () => {
  const codes = new Map(Object.entries({Q0: 'no', N1: 'yes', N2: 'yes', N3: 'no', T1: 'self', T2: 'male'}));
  assert.equal(nextQuestion({codes, data}).item.linkId, 'T3');
  codes.set('T3', 'unknown');
  assert.equal(nextQuestion({codes, data}).kind, 'identify');
  // 상세 문항에 이미 답이 있어도 증상이 정해지지 않았으면 identify
  codes.set('N5', 'no');
  assert.equal(nextQuestion({codes, data}).kind, 'identify');
});

test('Q0 미응답·Q0=yes이면 증상 확인 자리가 열리지 않는다', () => {
  assert.equal(nextQuestion({codes: new Map(), data}).item.linkId, 'Q0');
  const r = nextQuestion({codes: new Map([['Q0', 'yes']]), data});
  assert.equal(r.kind, 'item');
  assert.equal(r.item.linkId, 'E1');
});

test('응급 모드: E1, E2, E4~E9-1만(E3은 프론트)', () => {
  const {asked} = walk({start: {Q0: 'yes'}, mode: 'emergency'});
  assert.deepEqual(asked, ['E1', 'E2', 'E4', 'E5', 'E6', 'E7', 'E8', 'E8-1', 'E9', 'E9-1']);
  // 응급 모드에서는 Q0=no여도 E 문항만 본다(E가 숨겨지면 묻는 것이 없다)
  assert.equal(nextQuestion({codes: new Map([['Q0', 'no']]), data, mode: 'emergency'}).kind, 'done');
  assert.equal(nextQuestion({codes: new Map(), data, mode: 'stopped'}).kind, 'done');
});

test('엔진이 절대 묻지 않는 문항 12개', () => {
  assert.deepEqual(neverAskedItems(data).sort(), [...NEVER].sort());
  const askedAll = new Set([
    ...walk({after: 'unknown'}).asked, ...walk({after: 'known'}).asked,
    ...walk({after: 'fallback'}).asked, ...walk({start: {Q0: 'yes'}, mode: 'emergency'}).asked,
  ]);
  for (const id of NEVER) assert.ok(!askedAll.has(id), `${id}가 나옴`);
  // 엔진이 묻는 문항 34개가 위 경로에서 모두 나온다
  const askable = data.items.filter((it) => !NEVER.includes(it.linkId)).map((it) => it.linkId);
  assert.equal(askable.length, 34);
  for (const id of askable) assert.ok(askedAll.has(id), `${id}가 안 나옴`);
});

test('보이는 문항만: N1 답이 있어도 Q0=yes면 N1 이후는 나오지 않음', () => {
  const r = nextQuestion({codes: new Map([['Q0', 'yes'], ['N1', 'no']]), data, mode: 'emergency'});
  assert.equal(r.item.flow, 'emergency');
});

test('itemToFollowUp: 묻는 문항 모두 followUp 계약 통과, id = link_id, 선택지 id = code', () => {
  for (const it of data.items.filter((i) => !NEVER.includes(i.linkId))) {
    const f = itemToFollowUp(it, data, 'ko');
    const c = checkFollowUpContract(f);
    assert.ok(c.ok, `${it.linkId}: ${c.errors.join(', ')}`);
    assert.equal(f.type, 'singleChoice');
    assert.equal(f.id, it.linkId);
    assert.equal(typeof f.required, 'boolean');
    assert.deepEqual(f.options.map((o) => o.id), data.optionsById.get(it.linkId).map((o) => o.code));
  }
  const q0 = itemToFollowUp(data.itemById.get('Q0'), data);
  assert.deepEqual(q0, {id: 'Q0', type: 'singleChoice', required: true, label: {ko: '현재 119 신고가 필요하다고 생각되는 응급 상황인가요?'},
    options: [{id: 'yes', label: {ko: '예'}}, {id: 'no', label: {ko: '아니요'}}]});
});

test('applyMappings: filter·report·detail·flow 값과 원래 문항 ID', () => {
  const codes = new Map(Object.entries({Q0: 'no', N1: 'no', T2: 'female', T3: 'age_1_12', 'N5': 'yes', 'N5-1': 'onset_today',
    N6: 'no', 'N6-1': 'freq_daily', N7: 'yes', 'N7-1': 'onset_1_3d', N9: 'no', P0: 'yes', P1: 'pain_7'}));
  const vis = visibleCodes(codes, data);
  const {hits} = evaluateSafety({codes: vis, data});
  const s = applyMappings({codes: vis, ruleHits: hits, data, symptom: {id: 'R05', nameKo: '기침'}});
  assert.deepEqual(s.filter.sex, {value: 'female', question: 'T2'});
  assert.deepEqual(s.filter.age_band, {value: 'child', question: 'T3'});
  assert.deepEqual(s.filter.infant, {value: 'false', question: 'T3'});
  assert.deepEqual(s.report.onset, {value: 'onset_today', question: 'N5-1'});
  assert.deepEqual(slotEntries(s, 'report.notes'), [{value: 'freq_daily', question: 'N6-1'}, {value: 'onset_1_3d', question: 'N7-1'}]);
  assert.deepEqual(s.detail.continuous, {value: 'no', question: 'N6'});
  assert.deepEqual(s.detail.aggravating, {value: 'none', question: 'N9'});
  assert.deepEqual(s.detail.pain_score, {value: 'pain_7', question: 'P1'});
  assert.deepEqual(s.flow.urgent_notice, {value: 'true', question: 'R-N1-CONSCIOUSNESS'});
  assert.deepEqual(s.report.symptom, {value: '기침', question: 'N4', symptomId: 'R05'});
  assert.deepEqual(s.card, {});
});

test('applyMappings: 미응답 filter는 unknown, 증상 모르면 report.symptom 없음, 응급 카드', () => {
  const s = applyMappings({codes: new Map([['Q0', 'no']]), data});
  assert.deepEqual(s.filter.sex, {value: 'unknown', question: null});
  assert.deepEqual(s.filter.age_band, {value: 'unknown', question: null});
  assert.equal(s.report.symptom, undefined);
  const em = new Map(Object.entries({Q0: 'yes', E1: 'no', E8: 'no', E9: 'no'}));
  const s2 = applyMappings({codes: visibleCodes(em, data), ruleHits: [{ruleId: 'R-Q0-EMERGENCY'}], data});
  assert.deepEqual(s2.card, {is_self: {value: 'no', question: 'E1'}, patient_count: {value: 'count_1', question: 'E8'}, onset: {value: 'unknown', question: 'E9'}});
  assert.deepEqual(s2.flow, {emergency_stop: {value: 'true', question: 'R-Q0-EMERGENCY'}});
  // 여러 규칙이 같은 slot에 → 배열
  const s3 = applyMappings({codes: new Map(), ruleHits: [{ruleId: 'R-N1-CONSCIOUSNESS'}, {ruleId: 'R-N3-RED-FLAGS'}], data});
  assert.equal(slotEntries(s3, 'flow.urgent_notice').length, 2);
});
