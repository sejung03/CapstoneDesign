import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadIntakeData} from '../intake-data.mjs';
import {visibleCodes} from '../answers.mjs';
import {evaluateSafety} from '../rules.mjs';
import {nextQuestion, itemToFollowUp, neverAskedItems, detailProgress} from '../flow.mjs';
import {applyMappings, slotEntries} from '../slots.mjs';
import {checkFollowUpContract} from '../../llm/confirm-question.mjs';

const data = loadIntakeData();
// 11/18 재설계: 상세 문항을 줄여 엔진이 묻지 않는 문항은 E3(프론트)·N4·F3(입력)·F1(선택지 미정)만 남았다
const NEVER = ['E3', 'N4', 'F1', 'F3'];

// 상세 문항까지 "더 묻게 되는" 답(조건부 문항이 모두 열린다)
const OPEN_ALL = {
  Q0: 'no', N1: 'yes', N2: 'yes', N3: 'no', T1: 'self', T2: 'female', T3: 'age_19_64',
  'N5-1': 'onset_today', P3: 'pq_stabbing', P1: 'pain_5', N12: 'impact_some', N7: 'yes', F2: 'no',
  E1: 'yes', E2: 'yes', E4: 'yes', E5: 'yes', E6: 'no', E7: 'no', E8: 'yes', 'E8-1': 'count_2', E9: 'yes', 'E9-1': 'onset_1_6h',
};

/** 정해진 답으로 끝까지 걸어가며 묻는 순서를 기록한다. identify 자리에서 symptomState를 바꾼다. */
function walk({answers = OPEN_ALL, start = {}, mode = 'normal', after = 'unknown', pain = false} = {}) {
  const codes = new Map(Object.entries(start));
  const asked = [];
  let state = 'pending';
  for (let guard = 0; guard < 100; guard += 1) {
    const r = nextQuestion({codes, data, mode, symptomState: state, symptomIsPain: pain});
    if (r.kind === 'done') return {asked, codes, last: r};
    if (r.kind === 'identify') { asked.push('<identify>'); state = after; continue; }
    asked.push(r.item.linkId);
    assert.ok(r.item.linkId in answers, `답이 준비되지 않은 문항 ${r.item.linkId}`);
    codes.set(r.item.linkId, answers[r.item.linkId]);
  }
  throw new Error('끝나지 않음');
}

// 11/18 재설계: 증상 확인 뒤 3~4개. 통증이면 언제부터·양상·점수·악화, 아니면 언제부터·불편 정도·악화, 모르면 + F2
const COMMON = ['Q0', 'N1', 'N2', 'N3', 'T1', 'T2', 'T3', '<identify>'];
test('실제 질문 순서(11/18 재설계): 공통 Q0~T3 → 증상 확인 → 증상에 맞춘 상세 3~4개', () => {
  const r = walk({after: 'unknown'});
  assert.deepEqual(r.asked, [...COMMON, 'N5-1', 'N12', 'N7', 'F2']);
  assert.ok(r.last.skippedItems.includes('F3') && r.last.skippedItems.includes('P3') && r.last.skippedItems.includes('P1'));
  assert.deepEqual(walk({after: 'known', pain: false}).asked, [...COMMON, 'N5-1', 'N12', 'N7']);
  assert.deepEqual(walk({after: 'known', pain: true}).asked, [...COMMON, 'N5-1', 'P3', 'P1', 'N7']);
  assert.deepEqual(walk({after: 'fallback', pain: true}).asked, [...COMMON, 'N5-1', 'P3', 'P1', 'N7', 'F2']);
  assert.deepEqual(walk({after: 'fallback', pain: false}).asked, [...COMMON, 'N5-1', 'N12', 'N7', 'F2']);
});

test('증상이 정해지면(known) F2는 묻지 않는다, 증상을 모르면 통증 문항(P3·P1)을 묻지 않는다', () => {
  for (const pain of [true, false]) assert.ok(!walk({after: 'known', pain}).asked.includes('F2'));
  const unknown = walk({after: 'unknown', pain: true}).asked; // 증상 모름은 통증 여부와 상관없이 불편 정도
  assert.ok(!unknown.includes('P3') && !unknown.includes('P1') && unknown.includes('N12'));
});

test('detailProgress(11/18): 상세 문항의 n번째/전체, 상세가 아니면 null, 답·미리 채움과 상관없이 전체 수는 그대로', () => {
  const base = {Q0: 'no', N1: 'yes', N2: 'yes', N3: 'no', T1: 'self', T2: 'female', T3: 'age_19_64'};
  const at = (itemId, extra = {}, symptomState = 'known', symptomIsPain = true) =>
    detailProgress({itemId, codes: new Map(Object.entries({...base, ...extra})), data, symptomState, symptomIsPain});
  assert.deepEqual(at('N5-1'), {current: 1, total: 4});
  assert.deepEqual(at('P1', {'N5-1': 'onset_today', P3: 'pq_dull'}), {current: 3, total: 4});
  assert.deepEqual(at('N7', {}, 'known', false), {current: 3, total: 3});
  assert.deepEqual(at('F2', {}, 'unknown', false), {current: 4, total: 4});
  assert.equal(at('T3'), null);
  assert.equal(at('P3', {}, 'known', false), null); // 통증이 아니면 P3는 계획에 없음
});

test('증상 확인 자리는 N4의 order(데이터)로 정한다: T3 미응답이면 T3 먼저', () => {
  const codes = new Map(Object.entries({Q0: 'no', N1: 'yes', N2: 'yes', N3: 'no', T1: 'self', T2: 'male'}));
  assert.equal(nextQuestion({codes, data}).item.linkId, 'T3');
  codes.set('T3', 'unknown');
  assert.equal(nextQuestion({codes, data}).kind, 'identify');
  // 상세 문항에 이미 답이 있어도 증상이 정해지지 않았으면 identify
  codes.set('N5-1', 'onset_today');
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

test('엔진이 절대 묻지 않는 문항 4개(11/18 재설계)', () => {
  assert.deepEqual(neverAskedItems(data).sort(), [...NEVER].sort());
  const askedAll = new Set([
    ...walk({after: 'unknown'}).asked, ...walk({after: 'known'}).asked, ...walk({after: 'known', pain: true}).asked,
    ...walk({after: 'fallback'}).asked, ...walk({start: {Q0: 'yes'}, mode: 'emergency'}).asked,
  ]);
  for (const id of NEVER) assert.ok(!askedAll.has(id), `${id}가 나옴`);
  // 엔진이 묻는 문항 23개가 위 경로에서 모두 나온다(11/18 재설계 전 34개)
  const askable = data.items.filter((it) => !NEVER.includes(it.linkId)).map((it) => it.linkId);
  assert.equal(askable.length, 23);
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
  const codes = new Map(Object.entries({Q0: 'no', N1: 'no', T2: 'female', T3: 'age_1_12', 'N5-1': 'onset_today',
    N7: 'yes', N12: 'impact_some', P3: 'pq_dull', P1: 'pain_7'}));
  const vis = visibleCodes(codes, data);
  const {hits} = evaluateSafety({codes: vis, data});
  const s = applyMappings({codes: vis, ruleHits: hits, data, symptom: {id: 'R05', nameKo: '기침'}});
  assert.deepEqual(s.filter.sex, {value: 'female', question: 'T2'});
  assert.deepEqual(s.filter.age_band, {value: 'child', question: 'T3'});
  assert.deepEqual(s.filter.infant, {value: 'false', question: 'T3'});
  assert.deepEqual(s.report.onset, {value: 'onset_today', question: 'N5-1'});
  assert.deepEqual(slotEntries(s, 'report.notes'), []);
  assert.deepEqual(s.detail.worsening, {value: 'yes', question: 'N7'});
  assert.deepEqual(s.detail.daily_impact, {value: 'impact_some', question: 'N12'});
  assert.deepEqual(s.detail.pain_quality, {value: 'pq_dull', question: 'P3'});
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
