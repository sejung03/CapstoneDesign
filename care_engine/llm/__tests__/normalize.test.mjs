import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeTerm, normalizeInput, tailChars} from '../normalize.mjs';
import {loadRefData} from '../ref-data.mjs';

test('normalizeTerm: 모든 사전 행에서 normalizeTerm(term) === termNorm', () => {
  const ref = loadRefData();
  const bad = ref.synonyms.filter((s) => normalizeTerm(s.term) !== s.termNorm);
  assert.equal(bad.length, 0, `불일치 ${bad.length}행: ${bad.slice(0, 10).map((s) => s.id).join(',')}`);
});

const ch = (n) => String.fromCodePoint(n);

test('normalizeTerm: Python 공백 문자(줄 구분 0x2028 포함)를 모두 지운다', () => {
  const ws = [0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1c, 0x1f, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000];
  for (const n of ws) assert.equal(normalizeTerm(`가${ch(n)}나`), '가나', n.toString(16));
  // Python isspace가 아닌 0x200b(폭 없는 공백)·0xfeff는 남긴다
  assert.equal(normalizeTerm(`가${ch(0x200b)}나`), `가${ch(0x200b)}나`);
});

test('normalizeTerm: NFKC, 소문자, 공백(전각·NBSP·탭 포함) 제거', () => {
  assert.equal(normalizeTerm(' 머리 가\t아파　요 '), '머리가아파요');
  assert.equal(normalizeTerm('ＡＢＣ abc'), 'abcabc');
  assert.equal(normalizeTerm('a b c'), 'abc');
  assert.equal(normalizeTerm('㎎'), 'mg');
  assert.equal(normalizeTerm(null), '');
});

test('normalizeTerm: 문장부호는 지우지 않는다(파이프라인 규칙과 같음)', () => {
  assert.equal(normalizeTerm('통증(부위 불명)'), '통증(부위불명)');
  assert.equal(normalizeTerm('아파요!!'), '아파요!!');
});

test('normalizeInput: 500자 넘으면 마지막 500자', () => {
  const s = 'ㄱ'.repeat(10) + '가'.repeat(500);
  const out = normalizeInput(s);
  assert.equal(Array.from(out).length, 500);
  assert.equal(out, '가'.repeat(500));
  assert.equal(normalizeInput('짧은 글'), '짧은글');
});

test('tailChars: 코드 포인트 기준으로 자른다', () => {
  assert.equal(tailChars('a😀b', 2), '😀b');
});
