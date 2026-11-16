// 문진 엔진 경로 시나리오(설계 §10-5)와 가짜 사용자 도우미 simulate(). 네트워크 없음(가짜 LLM).
// engine/__tests__/scenarios.test.mjs와 eval/engine_paths.mjs가 함께 쓴다. 문장은 모두 지어낸 짧은 문장이다.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {runCare} from '../engine/index.mjs';
import {checkResponseContract} from '../engine/contract.mjs';
import {ENGINE_QUESTION_IDS} from '../engine/answers.mjs';
import {loadIntakeData} from '../engine/intake-data.mjs';
import {buildSymptomConfirm} from '../llm/confirm-question.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const data = loadIntakeData();
const ref = data.refData;
const ENGINE_SET = new Set(ENGINE_QUESTION_IDS);
export const CONSENT = Object.freeze({granted: true, provider: 'mock', version: 'test-v1', healthInfo: true});

/** 프론트 약국 시작 문장(파일로 읽음). */
export function pharmacyStarterText() {
  const src = readFileSync(path.resolve(HERE, '../../frontend/care-context.mjs'), 'utf8');
  return src.match(/id:'pharmacy'[^\n]*?text:\{ko:'([^']+)'/)[1];
}

export const TEXT = Object.freeze({
  dict: '기침이 나요',
  noDict: '속이 영 이상하고 불편해요',
  c24: '식은땀이 나고 가슴이 꽉 조이는 느낌이에요',
  med: '먹는 약 때문에 궁금한 게 있어요',
  facilityMiss: '근처에 갈 만한 곳이 궁금해요',
  symptomFacility: '배가 아픈데 문 연 병원 있나요',
  other: '그냥 이야기하고 싶어요',
});

// 답 표: 안전·대상은 "안전" 쪽, 상세는 최소(조건부 문항이 안 열림) 또는 최대(모두 열림)
const SAFE = {Q0: 'no', N1: 'yes', N2: 'yes', N3: 'no', T1: 'self', T2: 'female', T3: 'age_19_64'};
const DETAIL_MIN = {N5: 'no', 'N5-1': 'onset_1_3d', N6: 'yes', N7: 'no', N8: 'no', N9: 'no', N10: 'no', N11: 'no', N12: 'no', N13: 'no', P0: 'no', F2: 'no'};
const DETAIL_MAX = {N5: 'yes', 'N5-1': 'onset_today', N6: 'no', 'N6-1': 'freq_daily', N7: 'yes', 'N7-1': 'onset_1_3d', N8: 'yes', N9: 'yes', N10: 'yes',
  N11: 'yes', 'N11-2': 'better', N12: 'yes', 'N12-1': 'sleep', N13: 'yes', P0: 'yes', P1: 'pain_6', F2: 'no'};
const EMERGENCY_ALL = {E1: 'no', E2: 'yes', E4: 'yes', E5: 'unknown', E6: 'no', E7: 'yes', E8: 'yes', 'E8-1': 'count_2', E9: 'yes', 'E9-1': 'onset_lt1h'};

const confirm = (picks) => ({status: 'confirm', followUp: buildSymptomConfirm(picks, ref, 'ko'), meta: {provider: 'fake', candidateCount: picks.length}});

/** 가짜 LLM(호출 수를 센다). classify는 값 또는 (input)=>값. */
export function makeLlm({classify = {status: 'fallback', reason: 'no_match', meta: {}}, profile = {items: [], meta: {}}, delayMs = 0} = {}) {
  const calls = {classify: 0, profile: 0};
  return {
    calls,
    llm: {
      classifySymptom: async (input) => {
        calls.classify += 1;
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
        return typeof classify === 'function' ? classify(input) : classify;
      },
      extractProfileUpdates: async (input) => {
        calls.profile += 1;
        return typeof profile === 'function' ? profile(input) : profile;
      },
    },
  };
}

/**
 * 가짜 사용자: 응답의 followUp에 답을 골라 다시 요청한다.
 * @param {{name:string, messages:string[], answers:object, skipAt?:string, llm?:object, maxSteps?:number}} script
 *   answers: 질문 ID → 고를 선택지 ID(없으면 첫 선택지). skipAt: 이 질문이 오면 답하지 않고 reason=skip
 * @returns {Promise<object>} 질문 수·엔진 질문 수·결과 종류·응답 기록
 */
export async function simulate(script) {
  const llm = script.llm ?? makeLlm();
  const answers = [];
  const asked = [];
  const responses = [];
  const contractErrors = [];
  const logs = [];
  let reason = 'message';
  let final = null;
  let error = null;
  for (let step = 0; step < (script.maxSteps ?? 60); step += 1) {
    const payload = {reason, locale: 'ko', messages: [...script.messages], followUpAnswers: answers.map((a) => ({...a})),
      profile: {age: '', allergies: '', medications: '', history: ''}};
    const out = await runCare(payload, {consent: CONSENT, requestId: `${script.name}-${step}`, deadlineAt: Date.now() + 5000, ...(script.ctx ?? {})},
      {llm: llm.llm, log: (e) => logs.push(e), ...(script.deps ?? {})});
    if (!out.response) { error = out.error; final = out; break; }
    responses.push({response: out.response, trace: out.trace});
    const check = checkResponseContract(out.response);
    if (!check.ok) contractErrors.push({step, errors: check.errors});
    const f = out.response.followUp;
    if (!f) { final = out; break; }
    if (script.skipAt && f.id === script.skipAt) { reason = 'skip'; continue; }
    const pick = Object.hasOwn(script.answers ?? {}, f.id) ? script.answers[f.id] : f.options[0].id;
    asked.push(f.id);
    const label = {ko: f.label.ko};
    const opt = f.options.find((o) => o.id === pick) ?? f.options[0];
    const i = answers.findIndex((a) => a.questionId === f.id);
    const ans = {questionId: f.id, value: opt.id, label, optionLabel: {ko: opt.label.ko}};
    if (i >= 0) answers[i] = ans; else answers.push(ans);
    reason = 'followup';
  }
  const r = final?.response ?? null;
  const kind = error ? `error:${error}` : !r ? 'unfinished'
    : r.emergency ? 'emergency'
      : r.summary && r.search?.type === 'hospital' ? 'recommend'
        : r.summary && r.search ? 'info+search' : r.search ? 'search' : r.summary ? 'summary' : 'other';
  return {
    name: script.name,
    asked,
    questionCount: asked.length,
    engineQuestionCount: asked.filter((id) => ENGINE_SET.has(id)).length,
    resultKind: kind,
    usedSkip: reason === 'skip',
    final: r,
    finalTrace: final?.trace ?? null,
    responses,
    contractErrors,
    llmCalls: {...llm.calls},
    logs,
  };
}

/** 대표 시나리오(설계 §10-5). expect: 사실 확인 §8 표의 질문 수 범위(비교용, 실패 조건 아님). */
export function scenarios() {
  const s = (name, o) => ({name, ...o});
  return [
    s('pharmacy_keyword', {messages: [pharmacyStarterText()], answers: {}, expect: [0, 0], note: '약국 시작 문장 → 키워드 → search'}),
    s('dict_min', {messages: [TEXT.dict], answers: {...SAFE, SYM_DICT_CONFIRM: 'sym_R05', ...DETAIL_MIN}, expect: [19, 24], note: '사전 경로, 상세 최소'}),
    s('dict_max', {messages: [TEXT.dict], answers: {...SAFE, SYM_DICT_CONFIRM: 'sym_R05', ...DETAIL_MAX}, expect: [19, 24], note: '사전 경로, 상세 최대'}),
    s('dict_skip_after_identify', {messages: [TEXT.dict], answers: {...SAFE, SYM_DICT_CONFIRM: 'sym_R05'}, skipAt: 'N5', expect: [8, 8], note: '증상 확인 직후 skip'}),
    s('llm_confirm', {messages: [TEXT.noDict], answers: {...SAFE, SYM_CONFIRM: 'sym_D01', ...DETAIL_MAX}, llm: makeLlm({classify: confirm(['D01', 'D02'])}), expect: [19, 24], note: '사전 0개 → LLM 후보 확인'}),
    s('c24_dict_partial', {messages: [TEXT.c24], answers: {...SAFE, SYM_DICT_CONFIRM: 'sym_other', SYM_CONFIRM: 'sym_A11', ...DETAIL_MIN},
      llm: makeLlm({classify: confirm(['A11', 'A09'])}), expect: [19, 24], note: '사전이 부수 증상만 → sym_other → LLM'}),
    s('llm_fail', {messages: [TEXT.noDict], answers: {...SAFE, ...DETAIL_MAX}, llm: makeLlm({classify: {status: 'fallback', reason: 'timeout', meta: {error: 'timeout'}}}), expect: [20, 25], note: 'LLM 실패 → SYM_NOT_FOUND → 증상 모름 + F2'}),
    s('llm_none', {messages: [TEXT.noDict], answers: {...SAFE, SYM_CONFIRM: 'sym_none', ...DETAIL_MIN}, llm: makeLlm({classify: confirm(['D01'])}), expect: [20, 25], note: 'LLM 후보 "해당 없음" → 증상 모름'}),
    s('fallback_injury', {messages: [TEXT.noDict], answers: {...SAFE, ...DETAIL_MIN, F2: 'yes'}, llm: makeLlm(), expect: [20, 25], note: '증상 모름 + F2=예 → injury'}),
    s('keyword_symptom_cue', {messages: [TEXT.symptomFacility], answers: {...SAFE, ...DETAIL_MIN}, llm: makeLlm(), expect: [20, 25], note: '증상 단서가 있는 기관 문장 → 문진'}),
    s('med_pharmacy', {messages: [TEXT.med], answers: {...SAFE, MED_CHOICE: 'med_pharmacy'}, llm: makeLlm({classify: {status: 'route', intent: 'medication_question', meta: {}}}), expect: [8, 8], note: '약 의도 → 약국 위치'}),
    s('med_info', {messages: [TEXT.med], answers: {...SAFE, MED_CHOICE: 'med_info'}, llm: makeLlm({classify: {status: 'route', intent: 'medication_question', meta: {}}}), expect: [8, 8], note: '약 의도 → 약 정보 안내'}),
    s('med_symptom', {messages: [TEXT.med], answers: {...SAFE, MED_CHOICE: 'med_symptom', ...DETAIL_MIN}, llm: makeLlm({classify: {status: 'route', intent: 'medication_question', meta: {}}}), expect: [20, 25], note: '약 의도 → 증상·부작용 상담'}),
    s('facility_llm', {messages: [TEXT.facilityMiss], answers: {...SAFE}, llm: makeLlm({classify: {status: 'route', intent: 'facility_search', meta: {}}}), expect: [7, 7], note: '키워드 누락 기관 찾기 → LLM 의도'}),
    s('other_ask_start', {messages: [TEXT.other], answers: {...SAFE, ASK_START: 'find_pharmacy'}, llm: makeLlm({classify: {status: 'route', intent: 'other', meta: {}}}), expect: null, note: 'LLM 의도 other → 시작 질문'}),
    s('no_message_ask_start', {messages: [], answers: {...SAFE, ASK_START: 'find_hospital'}, expect: null, note: '메시지 없음 → 시작 질문'}),
    s('q0_emergency', {messages: [TEXT.dict], answers: {Q0: 'yes', ...EMERGENCY_ALL}, expect: null, note: 'Q0=예 → E 문항 → 119 정리'}),
    s('n1_unknown', {messages: [TEXT.dict], answers: {Q0: 'no', N1: 'unknown'}, expect: null, note: 'N1 모름 → 긴급 안내'}),
    s('child_known', {messages: ['오한이 들어요'], answers: {...SAFE, T1: 'child', T3: 'age_1_12', SYM_DICT_CONFIRM: 'sym_A02', ...DETAIL_MIN}, expect: [19, 24], note: '아이 나이 + 확정 증상 → 소아청소년과'}),
    s('female_adult', {messages: ['오한이 들어요'], answers: {...SAFE, SYM_DICT_CONFIRM: 'sym_A02', ...DETAIL_MIN}, expect: [19, 24], note: '여성 성인(같은 증상, 산부인과 포함 비교용)'}),
    s('child_unknown', {messages: [TEXT.noDict], answers: {...SAFE, T1: 'child', T3: 'age_1_12', ...DETAIL_MIN}, llm: makeLlm(), expect: [20, 25], note: '아이 나이 + 증상 모름 → general'}),
    s('male', {messages: ['오한이 들어요'], answers: {...SAFE, T2: 'male', SYM_DICT_CONFIRM: 'sym_A02', ...DETAIL_MIN}, expect: [19, 24], note: '남성(산부인과 없음)'}),
    s('skip_after_q0', {messages: [TEXT.dict], answers: {Q0: 'no'}, skipAt: 'N1', expect: null, note: 'Q0만 답하고 skip → 안전 미응답 문구'}),
    s('skip_after_t1', {messages: [TEXT.dict], answers: {...SAFE}, skipAt: 'T2', expect: null, note: 'T1까지 답하고 skip'}),
  ];
}

/** 엔진이 묻는 문항 전체 수(고정 질문 수 비교 기준): todo·ui frontend·string·display가 아닌 문항. */
export function fixedQuestionCount() {
  return data.items.filter((it) => !it.todo && it.ui !== 'frontend' && it.type === 'choice').length;
}
