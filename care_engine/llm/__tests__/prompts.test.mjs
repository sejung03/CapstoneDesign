import {test} from 'node:test';
import assert from 'node:assert/strict';
import symptomPrompt from '../prompts/symptom_v1.mjs';
import profilePrompt from '../prompts/profile_v1.mjs';

test('symptom_v1: id·system·buildUser', () => {
  assert.equal(symptomPrompt.id, 'symptom_v1');
  assert.match(symptomPrompt.system, /목록에 있는 ID만 고른다/);
  assert.match(symptomPrompt.system, /응급 여부는 판단하지 않는다/);
  const u = symptomPrompt.buildUser({text: '가짜 문장', candidatesText: 'A01 | 두통'});
  assert.equal(u, '증상 목록:\nA01 | 두통\n\n사용자 문장:\n가짜 문장');
  assert.ok(u.endsWith('\n가짜 문장'));
});

test('profile_v1: id·system·buildUser(메시지 번호 유지)', () => {
  assert.equal(profilePrompt.id, 'profile_v1');
  assert.match(profilePrompt.system, /증상에서 약·질환을 추론하지 않는다/);
  const u = profilePrompt.buildUser({messages: [{index: 0, text: '첫 문장'}, {index: 2, text: '셋째 문장'}]});
  assert.equal(u, '메시지 0:\n첫 문장\n\n메시지 2:\n셋째 문장');
});

test('프롬프트에 ICPC 원문·영어 증상명이 없다', () => {
  for (const s of [symptomPrompt.system, profilePrompt.system]) assert.doesNotMatch(s, /ICPC/i);
});
