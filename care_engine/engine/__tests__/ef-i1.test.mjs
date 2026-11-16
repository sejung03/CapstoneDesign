// 11/17 EF F2(I1): 엔진 질문 답의 우선순위 SYM_CONFIRM > SYM_NOT_FOUND > SYM_DICT_CONFIRM.
// 엔진 질문 답 조합 전부 × 가짜 LLM 결과 × 메시지 종류로 경로를 끝까지 돌려
// (a) 이미 답한 질문(엔진 질문 포함)이 다시 나오지 않고 (b) 증상 분류 LLM 호출이 경로 전체에서 최대 1번인지 본다.
// 문장은 모두 지어낸 짧은 문장이다.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runCare} from '../index.mjs';
import {resolveFromAnswers} from '../identify.mjs';
import {ENGINE_QUESTION_IDS} from '../answers.mjs';
import {CONSENT, confirmFor, ref} from './helpers.mjs';
import {simulate, makeLlm, TEXT} from '../../eval/engine_scenarios.mjs';

const ENGINE_SET = new Set(ENGINE_QUESTION_IDS);
// 건강정보 추출(본인일 때만)이 섞이지 않게 상담 대상은 '다른 사람'
const BASE = {Q0: 'no', N1: 'yes', N2: 'yes', N3: 'no', T1: 'other', T2: 'female', T3: 'age_19_64'};
const DETAIL = {N5: 'no', 'N5-1': 'onset_1_3d', N6: 'yes', N7: 'no', N8: 'no', N9: 'no', N10: 'no', N11: 'no', N12: 'no', N13: 'no', P0: 'no', F2: 'no'};

const VALUES = {
  SYM_CONFIRM: [undefined, 'sym_A11', 'sym_none', 'sym_unsure', 'sym_ZZZ'],
  SYM_NOT_FOUND: [undefined, 'sym_continue', 'bogus'],
  SYM_DICT_CONFIRM: [undefined, 'sym_A09', 'sym_other', 'sym_unsure', 'sym_ZZZ'],
};
const LLMS = {
  fallback: {status: 'fallback', reason: 'timeout', meta: {error: 'timeout'}},
  confirm: confirmFor(['A11', 'A09']),
  other: {status: 'route', intent: 'other', meta: {}},
  medication: {status: 'route', intent: 'medication_question', meta: {}},
  facility: {status: 'route', intent: 'facility_search', meta: {}},
};
const MESSAGES = {c24: TEXT.c24, noDict: TEXT.noDict};

function combos() {
  const out = [];
  for (const a of VALUES.SYM_CONFIRM) for (const b of VALUES.SYM_NOT_FOUND) for (const c of VALUES.SYM_DICT_CONFIRM) {
    const o = {};
    if (a !== undefined) o.SYM_CONFIRM = a;
    if (b !== undefined) o.SYM_NOT_FOUND = b;
    if (c !== undefined) o.SYM_DICT_CONFIRM = c;
    out.push(o);
  }
  return out;
}

/** 시작 답에서 끝까지(가짜 사용자: DETAIL 또는 첫 선택지). */
async function runPath(start, message, classify) {
  const llm = makeLlm({classify});
  const answers = new Map(Object.entries(start));
  const asked = [];
  let reason = 'message';
  for (let step = 0; step < 40; step += 1) {
    const payload = {reason, locale: 'ko', messages: [message], followUpAnswers: [...answers].map(([questionId, value]) => ({questionId, value}))};
    const out = await runCare(payload, {consent: CONSENT, deadlineAt: Date.now() + 5000}, {llm: llm.llm});
    assert.ok(out.response, `error ${out.error}`);
    const f = out.response.followUp;
    if (!f) return {asked, llm: llm.calls, final: out};
    assert.ok(!answers.has(f.id), `이미 답한 질문이 다시 나옴: ${f.id} (시작 ${JSON.stringify(start)})`);
    asked.push(f.id);
    answers.set(f.id, Object.hasOwn(DETAIL, f.id) ? DETAIL[f.id] : f.options[0].id);
    reason = 'followup';
  }
  assert.fail('경로가 끝나지 않음');
}

test('F2 I1: resolveFromAnswers 우선순위 SYM_CONFIRM > SYM_NOT_FOUND > SYM_DICT_CONFIRM', () => {
  const r = (o) => resolveFromAnswers(new Map(Object.entries(o)), ref);
  assert.deepEqual(r({SYM_DICT_CONFIRM: 'sym_other', SYM_NOT_FOUND: 'sym_continue'}), {kind: 'unknown', source: 'not_found'});
  assert.deepEqual(r({SYM_DICT_CONFIRM: 'sym_other', SYM_CONFIRM: 'sym_A11'}), {kind: 'symptom', symptomId: 'A11', source: 'llm_confirm'});
  assert.deepEqual(r({SYM_DICT_CONFIRM: 'sym_A09', SYM_NOT_FOUND: 'sym_continue', SYM_CONFIRM: 'sym_none'}), {kind: 'unknown', source: 'llm_confirm'});
  assert.deepEqual(r({SYM_DICT_CONFIRM: 'sym_A09', SYM_NOT_FOUND: 'sym_continue'}), {kind: 'unknown', source: 'not_found'});
  assert.deepEqual(r({SYM_DICT_CONFIRM: 'sym_other'}), {kind: 'needLlm'});
  assert.deepEqual(r({SYM_DICT_CONFIRM: 'sym_A09'}), {kind: 'symptom', symptomId: 'A09', source: 'dict_confirm'});
  assert.equal(r({}), null);
});

test('F2 I1: 엔진 질문 답 조합 전부(5×3×5) × LLM 결과 5종 × 메시지 2종 — 같은 질문 재등장 없음, 분류 LLM 경로 전체 최대 1번', async () => {
  let paths = 0;
  for (const combo of combos()) {
    for (const [lname, classify] of Object.entries(LLMS)) {
      for (const [mname, message] of Object.entries(MESSAGES)) {
        const r = await runPath({...BASE, ...combo}, message, classify);
        const where = `${JSON.stringify(combo)} / ${lname} / ${mname}`;
        assert.ok(r.llm.classify <= 1, `분류 LLM ${r.llm.classify}번: ${where}`);
        assert.equal(r.llm.profile, 0, where);
        // 엔진 질문 답이 이미 있어 증상이 정해진 조합은 LLM을 부르지 않는다
        const decided = combo.SYM_CONFIRM !== undefined || combo.SYM_NOT_FOUND !== undefined
          || (combo.SYM_DICT_CONFIRM !== undefined && combo.SYM_DICT_CONFIRM !== 'sym_other');
        if (decided) assert.equal(r.llm.classify, 0, `증상이 정해졌는데 LLM 호출: ${where}`);
        // 같은 엔진 질문이 경로에서 두 번 나오지 않는다
        const engineAsked = r.asked.filter((id) => ENGINE_SET.has(id));
        assert.equal(new Set(engineAsked).size, engineAsked.length, `엔진 질문 반복: ${where}`);
        paths += 1;
      }
    }
  }
  assert.equal(paths, 75 * 5 * 2);
});

test('F2 I1: 시뮬레이터 — sym_other → LLM 실패 → SYM_NOT_FOUND 답 → 다음 질문 N5 … 끝까지(LLM 1번)', async () => {
  const r = await simulate({name: 'i1_regression', messages: [TEXT.c24],
    answers: {...BASE, T1: 'self', SYM_DICT_CONFIRM: 'sym_other', ...DETAIL},
    llm: makeLlm({classify: LLMS.fallback})});
  const i = r.asked.indexOf('SYM_NOT_FOUND');
  assert.deepEqual(r.asked.slice(0, i + 1), ['Q0', 'N1', 'N2', 'N3', 'T1', 'T2', 'T3', 'SYM_DICT_CONFIRM', 'SYM_NOT_FOUND']);
  assert.equal(r.asked[i + 1], 'N5');
  assert.equal(r.asked.filter((id) => id === 'SYM_NOT_FOUND').length, 1);
  assert.equal(r.llmCalls.classify, 1);
  assert.equal(r.resultKind, 'recommend');
  assert.equal(r.finalTrace.symptom.source, 'not_found');
  assert.equal(r.contractErrors.length, 0);
});
