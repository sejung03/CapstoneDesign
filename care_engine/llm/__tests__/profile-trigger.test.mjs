import {test} from 'node:test';
import assert from 'node:assert/strict';
import {shouldExtractProfile, hasProfileSignal} from '../profile-trigger.mjs';
import {PROFILE_SIGNAL_WORDS} from '../config.mjs';

test('신호어 목록은 설계 6-1 그대로', () => {
  assert.deepEqual([...PROFILE_SIGNAL_WORDS], ['살', '세', '나이', '약', '복용', '먹고 있', '알레르기', '앓', '진단', '수술', '병력']);
});

test('신호어가 하나라도 있으면 true', () => {
  for (const s of ['저는 32살이에요', '만 40세', '혈압약 먹어요', '복용 중', '비타민 먹고있어요', '땅콩 알레르기', '천식을 앓았어요', '진단받았어요', '수술했어요', '병력이 있어요']) {
    assert.equal(shouldExtractProfile([s]), true, s);
  }
});

test('신호어가 없으면 false', () => {
  assert.equal(shouldExtractProfile(['머리가 아파요']), false);
  assert.equal(shouldExtractProfile([]), false);
  assert.equal(shouldExtractProfile(undefined), false);
  assert.equal(shouldExtractProfile([null, 3]), false);
});

test('여러 메시지 중 하나에만 있어도 true', () => {
  assert.equal(shouldExtractProfile(['머리가 아파요', '약을 먹었어요']), true);
  assert.equal(hasProfileSignal('머리가 아파요'), false);
});
