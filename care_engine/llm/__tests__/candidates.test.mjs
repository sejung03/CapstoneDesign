import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildCandidates, formatCandidatesForPrompt, dice, scoreTerm} from '../candidates.mjs';
import {loadRefData, fallbackSymptomIds} from '../ref-data.mjs';

const ref = loadRefData();
const fallback = new Set(fallbackSymptomIds(ref));

// 작은 가짜 참조 데이터
const toy = {
  dataVersion: 'test',
  symptoms: new Map([
    ['A01', {id: 'A01', nameKo: '두통', sexRestriction: null, isCandidate: true}],
    ['A02', {id: 'A02', nameKo: '복통', sexRestriction: null, isCandidate: true}],
    ['B01', {id: 'B01', nameKo: '생리통', sexRestriction: 'female', isCandidate: true}],
    ['B02', {id: 'B02', nameKo: '음낭 통증', sexRestriction: 'male', isCandidate: true}],
    ['F01', {id: 'F01', nameKo: '대체', sexRestriction: null, isCandidate: false}],
  ]),
  synonyms: [
    {id: 1, symptomId: 'A01', term: '두통', termNorm: '두통'},
    {id: 2, symptomId: 'A01', term: '머리 아픔', termNorm: '머리아픔'},
    {id: 3, symptomId: 'A01', term: '머리가 지끈', termNorm: '머리가지끈'},
    {id: 4, symptomId: 'A01', term: '두통', termNorm: '두통'},
    {id: 5, symptomId: 'A01', term: '골치', termNorm: '골치'},
    {id: 6, symptomId: 'A02', term: '배 아픔', termNorm: '배아픔'},
    {id: 7, symptomId: 'B01', term: '생리 아픔', termNorm: '생리아픔'},
    {id: 8, symptomId: 'B02', term: '음낭 아픔', termNorm: '음낭아픔'},
    {id: 9, symptomId: 'F01', term: '아픔', termNorm: '아픔'},
  ],
};

test('dice: 2-gram, 길이 1은 1-gram', () => {
  assert.equal(dice('머리아픔', '머리아픔'), 1);
  assert.equal(dice('ab', 'cd'), 0);
  assert.equal(dice('가', '가'), 1);
  assert.equal(dice('', '가'), 0);
  assert.ok(Math.abs(dice('머리아픔', '배아픔') - (2 * 1) / (3 + 2)) < 1e-12);
});

test('scoreTerm: 부분 문자열이면 1.0', () => {
  assert.equal(scoreTerm('어제부터머리아픔이심해', '머리아픔'), 1);
});

test('retrieve: 부분 문자열 1.0, 점수 내림차순 → 같으면 ID 오름차순, 점수 0 제외', () => {
  const c = buildCandidates('배 아픔이 있어요', toy);
  assert.deepEqual(c.map((x) => x.symptomId), ['A02', 'A01', 'B01', 'B02']);
  assert.equal(c[0].score, 1);
  // A01·B01·B02 모두 "아픔" 2-gram 하나만 겹침 → 점수가 같으면 ID 순
  assert.ok(c.every((x) => x.score > 0));
  assert.deepEqual(buildCandidates('전혀 다른 말', toy), []);
});

test('retrieve·all 모두 fallback(isCandidate=false) 증상을 넣지 않는다', () => {
  assert.ok(!buildCandidates('아픔', toy).some((x) => x.symptomId === 'F01'));
  assert.ok(!buildCandidates('', toy, {mode: 'all'}).some((x) => x.symptomId === 'F01'));
});

test('sex 필터: female/male이면 다른 성별 증상 제외, null·unknown이면 유지', () => {
  const ids = (sex) => buildCandidates('아픔', toy, {sex}).map((x) => x.symptomId);
  assert.ok(!ids('male').includes('B01'));
  assert.ok(ids('male').includes('B02'));
  assert.ok(!ids('female').includes('B02'));
  assert.ok(ids(null).includes('B01') && ids(null).includes('B02'));
  assert.ok(ids('unknown').includes('B01') && ids('unknown').includes('B02'));
});

test('all: fallback 뺀 전체를 ID 오름차순, score null', () => {
  const c = buildCandidates('무엇이든', toy, {mode: 'all'});
  assert.deepEqual(c, [
    {symptomId: 'A01', score: null}, {symptomId: 'A02', score: null},
    {symptomId: 'B01', score: null}, {symptomId: 'B02', score: null},
  ]);
});

test('k 제한', () => {
  assert.equal(buildCandidates('아픔', toy, {k: 2}).length, 2);
});

test('실제 사전: 결정적(같은 입력 → 같은 결과), fallback 미포함, 최대 k개', () => {
  const a = buildCandidates('머리가 지끈지끈 아프고 속이 메스꺼워요', ref);
  const b = buildCandidates('머리가 지끈지끈 아프고 속이 메스꺼워요', ref);
  assert.deepEqual(a, b);
  assert.ok(a.length > 0 && a.length <= 40);
  assert.ok(a.every((x) => !fallback.has(x.symptomId)));
  const all = buildCandidates('', ref, {mode: 'all'});
  assert.equal(all.length, 197 - fallback.size);
  assert.ok(all.every((x) => !fallback.has(x.symptomId)));
});

test('실제 사전: sex=male이면 female 제한 증상이 없다', () => {
  const all = buildCandidates('', ref, {mode: 'all', sex: 'male'});
  assert.ok(all.every((x) => ref.symptoms.get(x.symptomId).sexRestriction !== 'female'));
});

test('formatCandidatesForPrompt: "ID | name_ko | 동의어 최대 3개", name_ko와 같은 것·중복 건너뜀', () => {
  const out = formatCandidatesForPrompt([{symptomId: 'A01', score: 1}, {symptomId: 'A02', score: 0.5}], toy);
  assert.equal(out, 'A01 | 두통 | 머리 아픔, 머리가 지끈, 골치\nA02 | 복통 | 배 아픔');
});

test('formatCandidatesForPrompt: 동의어가 없으면 "ID | name_ko"', () => {
  const t = {...toy, synonyms: []};
  assert.equal(formatCandidatesForPrompt([{symptomId: 'A01'}], t), 'A01 | 두통');
});
