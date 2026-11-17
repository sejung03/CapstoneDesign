import {test} from 'node:test';
import assert from 'node:assert/strict';
import {shouldExtractProfile, hasProfileSignal, profileSignalKinds} from '../profile-trigger.mjs';
import {PROFILE_SIGNAL_PATTERNS} from '../config.mjs';

test('신호어 패턴은 지시서 M3 그대로(종류 4개, 패턴 14개)', () => {
  assert.deepEqual(Object.keys(PROFILE_SIGNAL_PATTERNS), ['age', 'medication', 'allergy', 'history']);
  const src = Object.fromEntries(Object.entries(PROFILE_SIGNAL_PATTERNS).map(([k, v]) => [k, v.map((re) => re.source)]));
  assert.deepEqual(src, {
    age: ['\\d{1,3}\\s*(살|세)', '만\\s*\\d{1,3}\\s*세', '나이'],
    medication: ['약\\s*(을|은|를)?\\s*(먹|복용|처방)', '복용', '먹고\\s*있', '\\S+약\\s*(먹|복용)'],
    allergy: ['알레르기', '알러지'],
    history: ['앓', '진단\\s*(받|을)', '수술\\s*(받|했)', '병력', '기저\\s*질환'],
  });
});

test('양성 예: 패턴마다 true, 종류도 맞다', () => {
  const cases = [
    ['저는 32살이에요', 'age'], ['32 살', 'age'], ['70세 어머니', 'age'], ['만 40세', 'age'], ['만40세', 'age'], ['나이가 많아요', 'age'],
    ['약을 먹었어요', 'medication'], ['약 먹어요', 'medication'], ['약은 복용 안 해요', 'medication'], ['약 처방받았어요', 'medication'],
    ['복용 중', 'medication'], ['비타민 먹고있어요', 'medication'], ['비타민 먹고 있어요', 'medication'], ['혈압약 먹어요', 'medication'], ['당뇨약복용', 'medication'],
    ['땅콩 알레르기', 'allergy'], ['새우 알러지 있어요', 'allergy'],
    ['천식을 앓았어요', 'history'], ['진단받았어요', 'history'], ['진단을 받았어요', 'history'], ['수술했어요', 'history'], ['수술 받았어요', 'history'],
    ['병력이 있어요', 'history'], ['기저질환 있어요', 'history'], ['기저 질환', 'history'],
  ];
  for (const [s, kind] of cases) {
    assert.equal(hasProfileSignal(s), true, s);
    assert.ok(profileSignalKinds(s).includes(kind), `${s} → ${kind}`);
  }
});

test('음성 예(지시서 M3): 인사·약국·세상·약속·수술실은 false', () => {
  for (const s of ['안녕하세요', '약국 어디 있어요', '세상에 너무 아파요', '약속이 있어서', '수술실 앞이에요']) {
    assert.equal(hasProfileSignal(s), false, s);
    assert.deepEqual(profileSignalKinds(s), [], s);
  }
});

test('음성 예(추가): 증상 문장·빈 값', () => {
  for (const s of ['머리가 아파요', '배가 살살 아파요', '세게 부딪혔어요', '진단서 떼러 가요', '', '   ']) {
    assert.equal(hasProfileSignal(s), false, JSON.stringify(s));
  }
  assert.equal(shouldExtractProfile([]), false);
  assert.equal(shouldExtractProfile(undefined), false);
  assert.equal(shouldExtractProfile([null, 3]), false);
});

test('전각 숫자도 NFKC로 맞춘다', () => {
  assert.equal(hasProfileSignal('３２살'), true);
});

test('여러 메시지 중 하나에만 있어도 true', () => {
  assert.equal(shouldExtractProfile(['머리가 아파요', '약을 먹었어요']), true);
  assert.equal(shouldExtractProfile(['머리가 아파요', '안녕하세요']), false);
});
