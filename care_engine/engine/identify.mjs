// 증상 확인(설계 §4-2 표 a~f). 상태 없이 매 요청 답과 메시지로 다시 계산한다.
// LLM은 요청당 최대 1번, 증상이 이미 정해진 뒤와 Q0~T3 단계에서는 부르지 않는다(runCare가 이 함수를 그 자리에서만 부름).
import {parseSymptomConfirm, checkFollowUpContract} from '../llm/confirm-question.mjs';
import {ENGINE_Q, OPT, symDictConfirmQuestion, symNotFoundQuestion, askStartQuestion, medChoiceQuestion} from './templates.mjs';
import {matchSymptoms as defaultMatchSymptoms} from './dictionary-match.mjs';
import {buildFacilitySearch} from './facility-keywords.mjs';

/** 사용자 메시지(문자열, 공백만은 제외). */
export function userMessages(messages) {
  return (Array.isArray(messages) ? messages : []).filter((m) => typeof m === 'string' && m.trim() !== '');
}

/** T2 답이 female/male이면 그 값, 아니면 null. 문항 ID 대신 filter.sex 매핑으로 읽는다. */
export function sexFromCodes(codes, data) {
  for (const m of data.mappings) {
    if (m.from === 'answer' && m.slot === 'filter.sex' && codes.get(m.question) === m.when && (m.value === 'female' || m.value === 'male')) return m.value;
  }
  return null;
}

/**
 * LLM 없이 답만으로 정해지는 증상 상태(표 a~c).
 * 11/17 EF(I1): 답이 있는 엔진 질문을 **나중에 나오는 순서**로 본다 — SYM_CONFIRM → SYM_NOT_FOUND → SYM_DICT_CONFIRM.
 * (sym_other → LLM 실패 → SYM_NOT_FOUND 답이 있는데 sym_other를 먼저 보면 같은 질문·LLM 호출이 반복된다.)
 * @returns {{kind:'symptom', symptomId, source} | {kind:'unknown', source} | {kind:'needLlm'} | null}
 */
export function resolveFromAnswers(engineAnswers, refData) {
  // a. SYM_CONFIRM(LLM 후보 확인): 가장 나중에 나오는 질문. 그 결과(증상 또는 모름), LLM 다시 안 부름
  if (engineAnswers.has(ENGINE_Q.SYM_CONFIRM)) {
    const r = parseSymptomConfirm([{questionId: ENGINE_Q.SYM_CONFIRM, value: engineAnswers.get(ENGINE_Q.SYM_CONFIRM)}], refData);
    if (r.status === 'confirmed') return {kind: 'symptom', symptomId: r.symptomId, source: 'llm_confirm'};
    return {kind: 'unknown', source: 'llm_confirm'};
  }
  // c. SYM_NOT_FOUND(LLM 실패 뒤 질문): 증상 모름 확정, LLM 다시 안 부름(sym_other 답이 있어도)
  if (engineAnswers.has(ENGINE_Q.SYM_NOT_FOUND)) return {kind: 'unknown', source: 'not_found'};
  // b. SYM_DICT_CONFIRM(사전 후보 확인): sym_other만 LLM 1번
  if (engineAnswers.has(ENGINE_Q.SYM_DICT_CONFIRM)) {
    const v = engineAnswers.get(ENGINE_Q.SYM_DICT_CONFIRM);
    if (v === OPT.symOther) return {kind: 'needLlm'};
    if (typeof v === 'string' && v.startsWith(OPT.symPrefix)) {
      const s = refData.symptoms.get(v.slice(OPT.symPrefix.length));
      if (s && s.isCandidate) return {kind: 'symptom', symptomId: s.id, source: 'dict_confirm'};
    }
    return {kind: 'unknown', source: 'dict_confirm'}; // sym_unsure·이상한 값
  }
  return null;
}

/** LLM 호출: deadline·signal을 엔진 쪽에서도 지킨다(가짜·실제 함수가 늦게 끝나도 기다리지 않는다). 예외를 던지지 않는다. */
async function callClassify(fn, input, {signal, deadlineAt, now}) {
  const remaining = deadlineAt - now();
  if (signal?.aborted) return {status: 'fallback', reason: 'aborted', meta: null};
  if (!(remaining > 0)) return {status: 'fallback', reason: 'timeout', meta: null};
  let timer;
  let onAbort;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({status: 'fallback', reason: 'timeout', meta: null}), remaining); });
  const aborted = new Promise((resolve) => {
    onAbort = () => resolve({status: 'fallback', reason: 'aborted', meta: null});
    signal?.addEventListener?.('abort', onAbort, {once: true});
  });
  try {
    const call = Promise.resolve().then(() => fn(input)).then(
      (r) => (r && typeof r === 'object' ? r : {status: 'fallback', reason: 'bad_result', meta: null}),
      () => ({status: 'fallback', reason: 'exception', meta: null}),
    );
    return await Promise.race([call, timeout, aborted]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onAbort);
  }
}

/** trace용 LLM 요약(원문 없음). */
function classifyTrace(r) {
  const m = r.meta && typeof r.meta === 'object' ? r.meta : {};
  return {
    called: true,
    status: r.status ?? null,
    fallbackReason: r.status === 'fallback' ? (typeof r.reason === 'string' ? r.reason : null) : null,
    intent: r.status === 'route' ? (typeof r.intent === 'string' ? r.intent : null) : null,
    error: typeof m.error === 'string' ? m.error : null,
    provider: typeof m.provider === 'string' ? m.provider : null,
    model: typeof m.model === 'string' ? m.model : null,
    candidateCount: Number.isFinite(m.candidateCount) ? m.candidateCount : null,
    attempts: Number.isFinite(m.attempts) ? m.attempts : null,
    consentSource: typeof m.consentSource === 'string' ? m.consentSource : null,
  };
}

async function runLlm({messages, codes, data, deps, ctx}) {
  const fn = deps?.llm?.classifySymptom;
  const input = {
    text: messages.join('\n'),
    sex: sexFromCodes(codes, data),
    consent: ctx.consent,
    signal: ctx.signal,
    deadlineAt: ctx.deadlineAt,
    requestId: ctx.requestId ?? null,
    reason: ctx.reason ?? null,
  };
  const r = typeof fn === 'function'
    ? await callClassify(fn, input, {signal: ctx.signal, deadlineAt: ctx.deadlineAt, now: ctx.now})
    : {status: 'fallback', reason: 'no_llm', meta: null};
  const llmMeta = classifyTrace(r);
  if (r.status === 'confirm') {
    if (r.followUp && r.followUp.id === ENGINE_Q.SYM_CONFIRM && checkFollowUpContract(r.followUp).ok) {
      return {kind: 'ask', followUp: r.followUp, llmMeta};
    }
    llmMeta.fallbackReason = 'bad_followup';
    return {kind: 'ask', followUp: symNotFoundQuestion(), llmMeta};
  }
  if (r.status === 'route') {
    if (r.intent === 'facility_search') return {kind: 'search', search: buildFacilitySearch(messages, data, deps.facilityKeywords), llmMeta};
    if (r.intent === 'medication_question') return {kind: 'ask', followUp: medChoiceQuestion(), llmMeta};
    if (r.intent === 'other') return {kind: 'ask', followUp: askStartQuestion(), llmMeta};
  }
  // fallback(시간 초과·오류·후보 없음·동의 없음) → 질문으로 남긴다(다음 요청에서 LLM을 다시 부르지 않게)
  return {kind: 'ask', followUp: symNotFoundQuestion(), llmMeta};
}

/**
 * @param {{engineAnswers:Map, messages:string[], codes:Map, data:object, deps:object, ctx:{consent, signal, deadlineAt, requestId, reason, now}}} input
 * @returns {Promise<
 *   {kind:'symptom', symptomId:string, source:'dict_confirm'|'llm_confirm'} |
 *   {kind:'unknown', source:string, llmMeta?:object} |
 *   {kind:'ask', followUp:object, llmMeta?:object} |
 *   {kind:'search', search:object, llmMeta?:object} |
 *   {kind:'medInfo'}>}
 *   medInfo는 runCare가 MED_CHOICE 답(med_info)을 먼저 처리하므로 여기서는 나오지 않는다(자리만).
 */
export async function identify({engineAnswers, messages, codes, data, deps = {}, ctx = {}}) {
  const msgs = userMessages(messages);
  const fromAnswers = resolveFromAnswers(engineAnswers, data.refData);
  if (fromAnswers && fromAnswers.kind !== 'needLlm') return fromAnswers;
  if (fromAnswers?.kind === 'needLlm') {
    // b. sym_other: 사전이 일부만 맞은 경우. 메시지가 없으면 LLM을 부를 수 없으므로 증상 모름.
    if (msgs.length === 0) return {kind: 'unknown', source: 'dict_confirm'};
    return runLlm({messages: msgs, codes, data, deps, ctx});
  }
  // d. 메시지 없음 → 시작 질문
  if (msgs.length === 0) return {kind: 'ask', followUp: askStartQuestion()};
  // e. 사전 매칭
  const match = typeof deps.matchSymptoms === 'function' ? deps.matchSymptoms : defaultMatchSymptoms;
  let ids = [];
  try { ids = match(msgs.join('\n'), data.refData, {sex: sexFromCodes(codes, data)}) ?? []; } catch { ids = []; }
  const symptoms = (Array.isArray(ids) ? ids : [])
    .map((id) => data.refData.symptoms.get(id))
    .filter((s) => s && s.isCandidate)
    .filter((s, i, arr) => arr.findIndex((x) => x.id === s.id) === i)
    .slice(0, 5);
  if (symptoms.length > 0) return {kind: 'ask', followUp: symDictConfirmQuestion(symptoms)};
  // f. LLM
  return runLlm({messages: msgs, codes, data, deps, ctx});
}
