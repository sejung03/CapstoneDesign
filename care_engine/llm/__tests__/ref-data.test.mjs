import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadRefData, parseCsv, fallbackSymptomIds} from '../ref-data.mjs';

test('parseCsv: BOM, 따옴표 안 쉼표·줄바꿈, "" 이스케이프, CRLF', () => {
  const text = '﻿a,b,c\r\n1,"x, y","say ""hi"""\r\n2,"line1\nline2",\n';
  assert.deepEqual(parseCsv(text), [
    {a: '1', b: 'x, y', c: 'say "hi"'},
    {a: '2', b: 'line1\nline2', c: ''},
  ]);
});

test('parseCsv: 열 수가 다르면 오류', () => {
  assert.throws(() => parseCsv('a,b\n1,2,3\n'));
});

test('parseCsv: 닫히지 않은 따옴표는 오류', () => {
  assert.throws(() => parseCsv('a\n"open\n'));
});

test('loadRefData: 시드 v2.1-20261113 개수와 버전', () => {
  const ref = loadRefData();
  assert.equal(ref.dataVersion, 'v2.1-20261113');
  assert.equal(ref.symptoms.size, 197);
  assert.equal(ref.synonyms.length, 1173);
  assert.deepEqual(ref.warnings, []);
});

test('loadRefData: 프로세스 안에서 한 번만 읽고 같은 객체를 돌려준다', () => {
  assert.equal(loadRefData(), loadRefData());
});

test('loadRefData: csv 외 source는 아직 미구현', () => {
  assert.throws(() => loadRefData({source: 'supabase'}), /구현하지 않았다/);
});

test('fallback 판정: DB 함수 기준(symptom_department.fallback 또는 variant 없음)', () => {
  const ref = loadRefData();
  assert.deepEqual(fallbackSymptomIds(ref), [
    'A16', 'B04', 'D20', 'D20-04', 'K01', 'K02', 'L04', 'L12', 'R01', 'T04', 'T29', 'X20',
  ]);
  assert.equal(ref.symptoms.get('D20').fallbackReason, 'no_variant');
  assert.equal(ref.symptoms.get('K01').fallbackReason, 'department_fallback');
});

test('is_parent 증상(D20)은 후보 불가, 자식(D20-01)은 후보 가능', () => {
  const ref = loadRefData();
  assert.equal(ref.symptoms.get('D20').isParent, true);
  assert.equal(ref.symptoms.get('D20').isCandidate, false);
  assert.equal(ref.symptoms.get('D20-01').isCandidate, true);
  assert.equal(ref.symptoms.get('D20-01').parentId, 'D20');
});

test('sexRestriction 값은 null | female | male', () => {
  const ref = loadRefData();
  const vals = new Set([...ref.symptoms.values()].map((s) => s.sexRestriction));
  assert.deepEqual([...vals].sort(), ['female', 'male', null].sort());
});

test('동의어는 id 오름차순이고 모든 symptomId가 존재', () => {
  const ref = loadRefData();
  for (let i = 1; i < ref.synonyms.length; i += 1) assert.ok(ref.synonyms[i - 1].id < ref.synonyms[i].id);
  for (const s of ref.synonyms) assert.ok(ref.symptoms.has(s.symptomId));
});
