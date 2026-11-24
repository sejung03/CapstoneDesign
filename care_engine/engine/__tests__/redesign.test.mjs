// 11/18 문진 재설계(통증증상 PQ 메모 반영): 공통 Q0~T3 → 증상 확인 → 증상에 맞춘 상세 3~4개.
// 통증 증상 목록, {symptom} 자리 채우기(언어별), 통증 양상 미리 채우기, 진행(n/전체), 저장한 건강정보 요약.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isPainSymptomName} from '../intake-data.mjs';
import {painQualityFromMessages} from '../pain-quality.mjs';
import {checkResponseContract} from '../contract.mjs';
import {data, SAFE_BASE, call} from './helpers.mjs';

test('통증 증상: 이름의 괄호 밖에 통증 표현이 있는 증상 41개(괄호 안 예시만 있으면 아님)', () => {
  const pain = [...data.painSymptomIds].sort();
  assert.equal(pain.length, 41);
  for (const id of ['N01', 'D01', 'D03', 'L16', 'X02', 'X03', 'A11', 'R21']) assert.ok(pain.includes(id), id);
  for (const id of ['R08', 'X20', 'R05', 'A03', 'N17', 'L29']) assert.ok(!pain.includes(id), id);
  assert.equal(isPainSymptomName('기타 코 증상(코 통증·후비루 등)'), false);
  assert.equal(isPainSymptomName('배란통(생리 사이 통증)'), true);
});

test('통증 양상 미리 채우기: 한 갈래에만 맞을 때만', () => {
  assert.equal(painQualityFromMessages(['발목이 욱신거려요']), 'pq_throbbing');
  assert.equal(painQualityFromMessages(['배가 콕콕 찌르듯이 아파요']), 'pq_stabbing');
  assert.equal(painQualityFromMessages(['어깨가 뻐근하고 결려요']), 'pq_dull');
  assert.equal(painQualityFromMessages(['발이 저리고 화끈거려요']), null); // 두 갈래 → 묻는다
  assert.equal(painQualityFromMessages(['발목이 아파요']), null);
  assert.equal(painQualityFromMessages([]), null);
});

const ANKLE = {...SAFE_BASE, SYM_DICT_CONFIRM: 'sym_L16'};

test('통증 증상 경로: 증상 이름이 들어간 시작 질문(5개 언어) + 진행 1/4, 양상 → 점수 → 악화, 계약 통과', async () => {
  let {out} = await call({reason: 'followup', messages: ['발목이 아파요'], answers: ANKLE});
  const f = out.response.followUp;
  assert.equal(f.id, 'N5-1');
  assert.equal(f.label.ko, '발목 통증·불편 증상은 언제부터 있었나요?');
  assert.deepEqual(Object.keys(f.label).sort(), ['en', 'ko', 'uz', 'vi', 'zh']);
  for (const t of Object.values(f.label)) assert.ok(!t.includes('{symptom}'), t);
  assert.match(f.label.en, /^When did [a-z]/); // 문장 가운데라 첫 글자 소문자
  assert.deepEqual(out.response.progress, {current: 1, total: 4});
  assert.ok(checkResponseContract(out.response).ok);
  ({out} = await call({reason: 'followup', messages: ['발목이 아파요'], answers: {...ANKLE, 'N5-1': 'onset_today'}}));
  assert.equal(out.response.followUp.id, 'P3');
  assert.deepEqual(out.response.progress, {current: 2, total: 4});
  ({out} = await call({reason: 'followup', messages: ['발목이 아파요'], answers: {...ANKLE, 'N5-1': 'onset_today', P3: 'pq_stabbing'}}));
  assert.equal(out.response.followUp.id, 'P1');
  ({out} = await call({reason: 'followup', messages: ['발목이 아파요'], answers: {...ANKLE, 'N5-1': 'onset_today', P3: 'pq_stabbing', P1: 'pain_6'}}));
  assert.equal(out.response.followUp.id, 'N7');
  assert.deepEqual(out.response.progress, {current: 4, total: 4});
  ({out} = await call({reason: 'followup', messages: ['발목이 아파요'], answers: {...ANKLE, 'N5-1': 'onset_today', P3: 'pq_stabbing', P1: 'pain_6', N7: 'no'}}));
  assert.equal(out.trace.phase, 'complete');
  const lines = out.response.summary.ko.split('\n');
  assert.ok(lines.includes('통증: 6점 (0~10)'));
  assert.ok(lines.includes('통증 양상: 찌르듯이·콕콕'));
  assert.ok(!lines.some((l) => l.startsWith('일상생활')));
});

test('통증 양상을 이미 말했으면 P3를 묻지 않고 채운다(진행 전체 수는 그대로), 요약에 나온다', async () => {
  let {out} = await call({reason: 'followup', messages: ['발목이 욱신거려요'], answers: {...ANKLE, 'N5-1': 'onset_today'}});
  assert.equal(out.response.followUp.id, 'P1');
  assert.deepEqual(out.response.progress, {current: 3, total: 4});
  assert.ok(out.trace.prefilled.includes('P3'));
  ({out} = await call({reason: 'followup', messages: ['발목이 욱신거려요'], answers: {...ANKLE, 'N5-1': 'onset_today', P1: 'pain_4', N7: 'no'}}));
  assert.ok(out.response.summary.ko.split('\n').includes('통증 양상: 욱신욱신·지끈지끈'));
});

test('통증이 아닌 증상: 시작 → 불편 정도 → 악화(3개), 증상 모름: 지금 불편한 증상 + F2', async () => {
  let {out} = await call({reason: 'followup', messages: ['기침이 나요'], answers: {...SAFE_BASE, SYM_DICT_CONFIRM: 'sym_R05', 'N5-1': 'onset_1_3d'}});
  assert.equal(out.response.followUp.id, 'N12');
  assert.match(out.response.followUp.label.ko, /^기침 증상 때문에 일상생활이 얼마나 불편한가요\?$/);
  assert.deepEqual(out.response.progress, {current: 2, total: 3});
  ({out} = await call({reason: 'followup', messages: ['그냥 좀 그래요'], answers: {...SAFE_BASE, SYM_RETRY_1: 'sym_continue'}}));
  assert.equal(out.response.followUp.id, 'N5-1');
  assert.equal(out.response.followUp.label.ko, '지금 불편한 증상은 언제부터 있었나요?');
  assert.equal(out.response.followUp.label.en, 'When did your symptoms start?');
  assert.deepEqual(out.response.progress, {current: 1, total: 4});
});

test('저장한 건강정보(약·기존 질환·알레르기)는 본인 상담일 때만 요약에 들어간다', async () => {
  const done = {...SAFE_BASE, SYM_DICT_CONFIRM: 'sym_R05', 'N5-1': 'onset_1_3d', N12: 'impact_little', N7: 'no'};
  const profile = {age: '', allergies: '', medications: '혈압약', history: '고혈압'};
  let {out} = await call({reason: 'followup', messages: ['기침이 나요'], answers: done, extra: {profile}});
  let lines = out.response.summary.ko.split('\n');
  assert.ok(lines.includes('복용 중인 약(저장한 건강정보): 혈압약'));
  assert.ok(lines.includes('기존 질환(저장한 건강정보): 고혈압'));
  assert.ok(lines.some((l) => l.startsWith('저장한 건강정보 말고는')));
  ({out} = await call({reason: 'followup', messages: ['기침이 나요'], answers: {...done, T1: 'child', T3: 'age_1_12'}, extra: {profile}}));
  lines = out.response.summary.ko.split('\n');
  assert.ok(!lines.some((l) => l.includes('저장한 건강정보')));
});

test('계약: progress는 정수 1 ≤ current ≤ total ≤ 20, followUp과 함께만', () => {
  const followUp = {id: 'N7', type: 'singleChoice', required: false, label: {ko: '질문'}, options: [{id: 'yes', label: {ko: '예'}}]};
  assert.ok(checkResponseContract({followUp, progress: {current: 1, total: 3}}).ok);
  for (const progress of [{current: 0, total: 3}, {current: 4, total: 3}, {current: 1}, {current: 1.5, total: 3}, {current: 1, total: 3, x: 1}]) {
    assert.equal(checkResponseContract({followUp, progress}).ok, false, JSON.stringify(progress));
  }
  assert.equal(checkResponseContract({summary: {ko: '요약'}, progress: {current: 1, total: 1}}).ok, false);
});
