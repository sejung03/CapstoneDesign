import {test} from 'node:test';
import assert from 'node:assert/strict';
import {maskPii} from '../pii.mjs';

const zero = {phone: 0, email: 0, rrn: 0, card: 0};

test('휴대폰 번호: 하이픈·공백·점·붙여씀·+82', () => {
  for (const s of ['010-1234-5678', '010 1234 5678', '010.1234.5678', '01012345678', '011-123-4567', '+82 10-1234-5678', '+82-010-1234-5678']) {
    const r = maskPii(`연락처 ${s} 입니다`);
    assert.equal(r.text, '연락처 [전화번호] 입니다', s);
    assert.deepEqual(r.masked, {...zero, phone: 1}, s);
  }
});

test('일반 전화·대표번호', () => {
  for (const s of ['02-123-4567', '031-1234-5678', '033.123.4567', '070 1234 5678', '1588-1234']) {
    assert.equal(maskPii(`번호 ${s}`).text, '번호 [전화번호]', s);
  }
});

test('이메일', () => {
  const r = maskPii('메일은 test.user+a@example.co.kr 로');
  assert.equal(r.text, '메일은 [이메일] 로');
  assert.deepEqual(r.masked, {...zero, email: 1});
});

test('주민등록번호 6-7', () => {
  for (const s of ['900101-1234567', '900101 - 2234567', '9001012234567', '900101 1234567']) {
    const r = maskPii(`주민번호 ${s}`);
    assert.equal(r.text, '주민번호 [주민번호]', s);
    assert.deepEqual(r.masked, {...zero, rrn: 1}, s);
  }
});

test('카드번호 4-4-4-4', () => {
  for (const s of ['1234-5678-9012-3456', '1234 5678 9012 3456', '1234567890123456']) {
    const r = maskPii(`카드 ${s}`);
    assert.equal(r.text, '카드 [카드번호]', s);
    assert.deepEqual(r.masked, {...zero, card: 1}, s);
  }
});

test('나이·약 용량·날짜·기간은 가리지 않는다', () => {
  for (const s of ['저는 32살이에요', '만 40세 남자', '타이레놀 500mg 두 알', '3일 전부터 아파요', '2026-11-15에 다쳤어요', '하루 3번 10ml', '체온 38.5도', '혈압 140/90']) {
    const r = maskPii(s);
    assert.equal(r.text, s, s);
    assert.deepEqual(r.masked, zero, s);
  }
});

test('여러 개가 섞이면 각각 센다', () => {
  const r = maskPii('010-1111-2222, 02-333-4444, a@b.com');
  assert.equal(r.text, '[전화번호], [전화번호], [이메일]');
  assert.deepEqual(r.masked, {...zero, phone: 2, email: 1});
});

test('빈 값', () => {
  assert.deepEqual(maskPii(undefined), {text: '', masked: zero});
});
