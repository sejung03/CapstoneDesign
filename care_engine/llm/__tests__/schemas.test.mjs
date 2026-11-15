import {test} from 'node:test';
import assert from 'node:assert/strict';
import {symptomPickSchema, profileExtractSchema, assertPortableSchema, INTENTS} from '../schemas.mjs';

test('symptomPickSchema: picks.items.enum = 후보 ID(순서 유지·중복 제거), 공통 규칙 통과', () => {
  const s = symptomPickSchema(['D09', 'A01', 'D09']);
  assert.deepEqual(s.properties.picks.items.enum, ['D09', 'A01']);
  assert.deepEqual(s.properties.intent.enum, INTENTS);
  assert.deepEqual(s.required, ['intent', 'status', 'picks']);
  assert.equal(s.additionalProperties, false);
  assert.equal(assertPortableSchema(s), true);
});

test('symptomPickSchema: 요청마다 새 enum(앞 요청과 섞이지 않음)', () => {
  const a = symptomPickSchema(['A01']);
  const b = symptomPickSchema(['B02']);
  assert.deepEqual(a.properties.picks.items.enum, ['A01']);
  assert.deepEqual(b.properties.picks.items.enum, ['B02']);
});

test('symptomPickSchema: 후보가 없으면 오류(빈 enum 금지)', () => {
  assert.throws(() => symptomPickSchema([]));
});

test('profileExtractSchema: 설계 6-2 모양, 공통 규칙 통과', () => {
  const s = profileExtractSchema();
  assert.equal(assertPortableSchema(s), true);
  const item = s.properties.items.items;
  assert.deepEqual(item.required, ['field', 'value', 'messageIndex', 'quote']);
  assert.deepEqual(item.properties.field.enum, ['age', 'allergies', 'medications', 'history']);
  assert.equal(item.properties.messageIndex.type, 'integer');
});

const base = () => ({
  type: 'object',
  properties: {a: {type: 'string'}},
  required: ['a'],
  additionalProperties: false,
});

test('assertPortableSchema: 허용 밖 키워드는 오류', () => {
  for (const kw of ['minItems', 'maxItems', 'pattern', 'maxLength', 'description', 'format', 'anyOf']) {
    const s = base();
    s.properties.a[kw] = kw === 'anyOf' ? [] : 1;
    assert.throws(() => assertPortableSchema(s), new RegExp(kw), kw);
  }
});

test('assertPortableSchema: properties가 모두 required가 아니면 오류', () => {
  const s = base();
  s.properties.b = {type: 'string'};
  assert.throws(() => assertPortableSchema(s), /required/);
});

test('assertPortableSchema: additionalProperties가 false가 아니면 오류', () => {
  const s1 = base(); s1.additionalProperties = true;
  assert.throws(() => assertPortableSchema(s1), /additionalProperties/);
  const s2 = base(); delete s2.additionalProperties;
  assert.throws(() => assertPortableSchema(s2), /additionalProperties/);
});

test('assertPortableSchema: 중첩 객체도 검사', () => {
  const s = profileExtractSchema();
  s.properties.items.items.additionalProperties = true;
  assert.throws(() => assertPortableSchema(s));
  const t = profileExtractSchema();
  t.properties.items.items.required = ['field'];
  assert.throws(() => assertPortableSchema(t));
});

test('assertPortableSchema: enum은 비어 있지 않은 문자열 배열', () => {
  const s = base(); s.properties.a.enum = [];
  assert.throws(() => assertPortableSchema(s));
  const t = base(); t.properties.a.enum = [1, 2];
  assert.throws(() => assertPortableSchema(t));
});
