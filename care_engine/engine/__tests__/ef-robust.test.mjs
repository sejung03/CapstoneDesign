// 11/17 EF F4: G1(주입 함수 실패로 예외가 밖으로 나가지 않음), G2(119 안내 문구). 문장은 모두 지어낸 짧은 문장이다.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runCare} from '../index.mjs';
import {EMERGENCY_TEXT, emergencyNotice} from '../templates.mjs';
import {CONSENT, SAFE_BASE, toAnswers, confirmFor} from './helpers.mjs';

const boom = () => { throw new Error('boom'); };
const PAYLOADS = {
  first: {reason: 'message', messages: ['기침이 나요'], followUpAnswers: []},
  identifyLlm: {reason: 'followup', messages: ['속이 영 이상하고 불편해요'], followUpAnswers: toAnswers(SAFE_BASE)},
  completeSelf: {reason: 'skip', messages: ['기침이 나요'], followUpAnswers: toAnswers({...SAFE_BASE, SYM_DICT_CONFIRM: 'sym_R05'})},
  emergency: {reason: 'followup', messages: [], followUpAnswers: toAnswers({Q0: 'yes'})},
  empty: {reason: 'message', messages: []},
};
const throwingProxy = new Proxy({}, {get: boom, has: boom, ownKeys: boom, getOwnPropertyDescriptor: boom});
// 실제 LLM 모듈에 닿지 않게: 모든 경우에 가짜(또는 던지는) llm을 넣는다. deps 전체가 던지는 경우도 llm만은 가짜.
const FAKE_LLM = {classifySymptom: async () => ({status: 'fallback', reason: 'timeout', meta: {}}), extractProfileUpdates: async () => ({items: []})};
const depsProxy = new Proxy({}, {get: (_, k) => (k === 'llm' ? FAKE_LLM : boom()), has: boom, ownKeys: boom, getOwnPropertyDescriptor: boom});

const DEPS = {
  now_throws: {now: boom},
  now_nan: {now: () => Number.NaN},
  now_string: {now: () => 'x'},
  log_throws: {log: boom},
  match_throws: {matchSymptoms: boom},
  refStore_throws: {refStore: boom},
  classify_throws_sync: {llm: {classifySymptom: boom, extractProfileUpdates: async () => ({items: []})}},
  classify_rejects: {llm: {classifySymptom: async () => { throw new Error('x'); }, extractProfileUpdates: boom}},
  classify_garbage: {llm: {classifySymptom: () => 42, extractProfileUpdates: () => 'garbage'}},
  profile_throws: {llm: {classifySymptom: async () => confirmFor(['D01']), extractProfileUpdates: boom}},
  facilityKeywords_bad: {facilityKeywords: {}},
  freeText_bad: {freeTextRules: {rules: [{regexes: null}]}},
  llm_proxy: {llm: throwingProxy},
  deps_proxy: depsProxy,
  all_throw: {now: boom, log: boom, matchSymptoms: boom, llm: {classifySymptom: boom, extractProfileUpdates: boom}},
};

test('F4 G1: 어떤 주입 함수가 실패해도 runCare는 예외를 밖으로 던지지 않는다(응답 또는 오류 코드)', async () => {
  let n = 0;
  for (const [dname, deps] of Object.entries(DEPS)) {
    if (dname !== 'deps_proxy' && !Object.hasOwn(deps, 'llm')) deps.llm = FAKE_LLM;
    for (const [pname, payload] of Object.entries(PAYLOADS)) {
      const ctxs = [{consent: CONSENT, deadlineAt: Date.now() + 2000}, throwingProxy];
      for (const ctx of ctxs) {
        let out;
        await assert.doesNotReject(async () => { out = await runCare(payload, ctx, deps); }, `${dname} / ${pname}`);
        assert.ok(out && typeof out === 'object' && 'trace' in out, `${dname} / ${pname}`);
        assert.ok(out.response || typeof out.error === 'string', `${dname} / ${pname}`);
        n += 1;
      }
    }
  }
  assert.equal(n, Object.keys(DEPS).length * Object.keys(PAYLOADS).length * 2);
});

test('F4 G1: now가 던져도 정상 흐름 그대로(검토 재현: 빈 메시지 → 응답), log가 던져도 응답 정상', async () => {
  const a = await runCare({reason: 'message', messages: []}, {}, {now: boom, llm: FAKE_LLM});
  assert.ok(a.response, a.error);
  const b = await runCare({reason: 'message', messages: ['기침이 나요']}, {}, {log: boom, now: boom, llm: FAKE_LLM});
  assert.equal(b.response.followUp.id, 'Q0');
});

test('F4 G2: emergency_call_119 메시지 끝에 "이 서비스는 진단을 하지 않아요."(1000자 이하)', () => {
  const m = EMERGENCY_TEXT.emergency_call_119.message;
  assert.ok(m.endsWith('이 서비스는 진단을 하지 않아요.'));
  assert.ok(m.length <= 1000);
  // 11/17 RF3: 민감 안내 2개(112·1366)는 지시서 문구대로 '이런 상황에 대한 상담은 하지 않아요'로 끝난다
  for (const k of Object.keys(EMERGENCY_TEXT)) {
    const tail = ['threat_notice_112', 'violence_notice_1366'].includes(k) ? '상담은 하지 않아요' : '진단을 하지 않아요';
    assert.ok(emergencyNotice(k).emergency.message.ko.includes(tail), k);
  }
});

test('F4 G2: search만 있는 응답(약국 지름길·시작 선택 검색)은 바꾸지 않는다(summary 없음)', async () => {
  const kw = await runCare({reason: 'message', messages: ['지금 문 연 약국을 찾고 싶어요']}, {}, {llm: FAKE_LLM});
  assert.deepEqual(Object.keys(kw.response), ['search']);
  const start = await runCare({reason: 'followup', messages: [], followUpAnswers: toAnswers({...SAFE_BASE, ASK_START: 'find_hospital'})}, {}, {llm: FAKE_LLM});
  assert.deepEqual(Object.keys(start.response), ['search']);
});
