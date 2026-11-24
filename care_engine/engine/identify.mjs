// 증상 확인(설계 §4-2 표 a~f). 상태 없이 매 요청 답과 메시지로 다시 계산한다.
// LLM은 요청당 최대 1번, 증상이 이미 정해진 뒤와 Q0~T3 단계에서는 부르지 않는다(runCare가 이 함수를 그 자리에서만 부름).
import {parseSymptomConfirm, checkFollowUpContract} from '../llm/confirm-question.mjs';
import {ENGINE_Q, OPT, symDictConfirmQuestion, symNotFoundQuestion, askStartQuestion, medChoiceQuestion, symRetryQuestion, symAreaPickQuestion} from './templates.mjs';
import {matchSymptoms as defaultMatchSymptoms} from './dictionary-match.mjs';
import {buildFacilitySearch} from './facility-keywords.mjs';
import {SYMPTOM_AREAS, AREA_BY_ID, areaSymptoms} from './symptom-areas.mjs';
import {SYM_RETRY_PREFIX} from './constants.mjs';
import {SYM_RETRY_KEY} from './answers.mjs';

/** 11/18 되묻기 답({n, value}, value null = 아직 답 없음) 또는 null. */
export function symRetryOf(engineAnswers) {
  const r = engineAnswers?.get?.(SYM_RETRY_KEY);
  return r && typeof r === 'object' && Number.isInteger(r.n) ? r : null;
}
/** 11/18 되묻기 질문(n = 그때까지의 사용자 메시지 수). */
export function retryQuestion(n) {
  return symRetryQuestion(`${SYM_RETRY_PREFIX}${n}`, SYMPTOM_AREAS);
}

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
 * 11/18 되묻기: SYM_AREA_PICK(부위의 증상 고르기) → SYM_RETRY_<n>(답이 있을 때만)를 SYM_CONFIRM 다음에 본다.
 *   SYM_RETRY 답이 부위면 {kind:'areaPick', followUp}(아직 증상 미정, 부위 증상 고르기 질문을 낸다).
 * @param {{sex?:'female'|'male'|null}} [opts] 부위 증상 목록의 성별 거르기
 * @returns {{kind:'symptom', symptomId, source} | {kind:'unknown', source} | {kind:'needLlm'} | {kind:'areaPick', followUp} | null}
 */
export function resolveFromAnswers(engineAnswers, refData, {sex = null} = {}) {
  // a. SYM_CONFIRM(LLM 후보 확인): 가장 나중에 나오는 질문. 그 결과(증상 또는 모름), LLM 다시 안 부름
  if (engineAnswers.has(ENGINE_Q.SYM_CONFIRM)) {
    const r = parseSymptomConfirm([{questionId: ENGINE_Q.SYM_CONFIRM, value: engineAnswers.get(ENGINE_Q.SYM_CONFIRM)}], refData);
    if (r.status === 'confirmed') return {kind: 'symptom', symptomId: r.symptomId, source: 'llm_confirm'};
    return {kind: 'unknown', source: 'llm_confirm'};
  }
  // a2. 11/18 SYM_AREA_PICK(되묻기에서 고른 부위의 증상): 증상 또는 '여기 없어요' → 모름
  if (engineAnswers.has(ENGINE_Q.SYM_AREA_PICK)) {
    const v = engineAnswers.get(ENGINE_Q.SYM_AREA_PICK);
    if (typeof v === 'string' && v.startsWith(OPT.symPrefix)) {
      const s = refData.symptoms.get(v.slice(OPT.symPrefix.length));
      if (s && s.isCandidate) return {kind: 'symptom', symptomId: s.id, source: 'area_pick'};
    }
    return {kind: 'unknown', source: 'area_pick'};
  }
  // a3. 11/18 SYM_RETRY_<n>에 답(버튼)이 있으면: '잘 모르겠어요' → 모름, 부위 → 부위 증상 고르기. 답이 없으면(null) 여기서 보지 않는다
  const retry = symRetryOf(engineAnswers);
  if (retry && retry.value !== null) {
    if (retry.value === OPT.symContinue) return {kind: 'unknown', source: 'retry_skip'};
    const list = AREA_BY_ID.has(retry.value) ? areaSymptoms(retry.value, refData, {sex}) : [];
    if (list.length > 0) return {kind: 'areaPick', followUp: symAreaPickQuestion(list)};
    return {kind: 'unknown', source: 'retry'};
  }
  // a4. 11/18 절충 1 SYM_REWRITE_CONFIRM(고쳐 쓰기 → 사전 후보 확인): 증상 → 확정, '다른 증상이에요' → 원래 문장으로 전체 목록 LLM 1번(forceFull)
  //   SYM_NOT_FOUND·SYM_RETRY 답이 있으면 그쪽이 나중 질문이라 위에서 먼저 끝난다.
  if (engineAnswers.has(ENGINE_Q.SYM_REWRITE_CONFIRM) && !engineAnswers.has(ENGINE_Q.SYM_NOT_FOUND)) {
    const v = engineAnswers.get(ENGINE_Q.SYM_REWRITE_CONFIRM);
    if (v === OPT.symOther) return {kind: 'needLlm', forceFull: true};
    if (typeof v === 'string' && v.startsWith(OPT.symPrefix)) {
      const s = refData.symptoms.get(v.slice(OPT.symPrefix.length));
      if (s && s.isCandidate) return {kind: 'symptom', symptomId: s.id, source: 'rewrite_confirm'};
    }
    return {kind: 'unknown', source: 'rewrite_confirm'};
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

/** 11/18: failQuestion — LLM이 증상을 못 찾았을 때 낼 질문(첫 실패면 되묻기, 되묻기 뒤 또 실패면 SYM_NOT_FOUND). */
async function runLlm({messages, codes, data, deps, ctx, preclassified = null, failQuestion = symNotFoundQuestion, forceFull = false}) {
  const fn = deps?.llm?.classifySymptom;
  const input = {
    text: messages.join('\n'),
    sex: sexFromCodes(codes, data),
    consent: ctx.consent,
    signal: ctx.signal,
    deadlineAt: ctx.deadlineAt,
    requestId: ctx.requestId ?? null,
    reason: ctx.reason ?? null,
    ...(forceFull ? {forceFull: true} : {}),
  };
  const r = preclassified && typeof preclassified === 'object' ? preclassified : typeof fn === 'function'
    ? await callClassify(fn, input, {signal: ctx.signal, deadlineAt: ctx.deadlineAt, now: ctx.now})
    : {status: 'fallback', reason: 'no_llm', meta: null};
  const llmMeta = classifyTrace(r);
  if (r.status === 'confirm') {
    // 11/18 절충 1: 고쳐 쓰기 경로의 확인 질문(SYM_REWRITE_CONFIRM)도 받는다. 단 이미 '다른 증상이에요'를 고른 뒤(forceFull)에는 SYM_CONFIRM만
    const okIds = forceFull ? [ENGINE_Q.SYM_CONFIRM] : [ENGINE_Q.SYM_CONFIRM, ENGINE_Q.SYM_REWRITE_CONFIRM];
    if (r.followUp && okIds.includes(r.followUp.id) && checkFollowUpContract(r.followUp).ok) {
      return {kind: 'ask', followUp: r.followUp, llmMeta};
    }
    llmMeta.fallbackReason = 'bad_followup';
    return {kind: 'ask', followUp: failQuestion(), llmMeta};
  }
  if (r.status === 'route') {
    if (r.intent === 'facility_search') return {kind: 'search', search: buildFacilitySearch(messages, data, deps.facilityKeywords), llmMeta};
    if (r.intent === 'medication_question') return {kind: 'ask', followUp: medChoiceQuestion(), llmMeta};
    if (r.intent === 'other') return {kind: 'ask', followUp: askStartQuestion(), llmMeta};
  }
  // fallback(시간 초과·오류·후보 없음·동의 없음) → 질문으로 남긴다(다음 요청에서 LLM을 다시 부르지 않게)
  // 11/18: 첫 실패는 되묻기(SYM_RETRY_<n>), 되묻기 뒤 사용자가 더 적었는데도 못 찾으면 SYM_NOT_FOUND
  return {kind: 'ask', followUp: failQuestion(), llmMeta};
}

/**
 * @param {{engineAnswers:Map, messages:string[], codes:Map, data:object, deps:object, ctx:{consent, signal, deadlineAt, requestId, reason, now},
 *          noLlm?:boolean}} input
 *   codes: **보이는 답만**(visibleCodes, 11/17 EF G4 — 성별 필터를 숨겨진 답에서 읽지 않게).
 *   noLlm: 11/17 EF G3 — 시작 선택(검색 답)을 무시하고 정상 흐름으로 온 경우. LLM을 부르지 않고(이미 한 번 불렸거나
 *          부르면 같은 시작 질문이 다시 나올 수 있다) 사전 확인 질문 또는 증상 모름(source 'start_choice')으로 간다.
 * @returns {Promise<
 *   {kind:'symptom', symptomId:string, source:'dict_confirm'|'llm_confirm'} |
 *   {kind:'unknown', source:string, llmMeta?:object} |
 *   {kind:'ask', followUp:object, llmMeta?:object} |
 *   {kind:'search', search:object, llmMeta?:object} |
 *   {kind:'medInfo'}>}
 *   medInfo는 runCare가 MED_CHOICE 답(med_info)을 먼저 처리하므로 여기서는 나오지 않는다(자리만).
 */
export async function identify({engineAnswers, messages, codes, data, deps = {}, ctx = {}, noLlm = false, preclassified = null}) {
  const msgs = userMessages(messages);
  const fromAnswers = resolveFromAnswers(engineAnswers, data.refData, {sex: sexFromCodes(codes, data)});
  if (fromAnswers?.kind === 'areaPick') return {kind: 'ask', followUp: fromAnswers.followUp};
  if (fromAnswers && fromAnswers.kind !== 'needLlm') return fromAnswers;
  // 11/18 되묻기: 답 없는 SYM_RETRY_<n>이 있으면 이미 한 번 되물은 것.
  //   사용자가 더 적지 않았으면(메시지 수 <= n) LLM을 다시 부르지 않고 같은 질문을 다시 낸다.
  //   더 적었으면 아래에서 사전·LLM을 한 번 더 시도하고, 그래도 못 찾으면 SYM_NOT_FOUND(증상 모름).
  const retry = symRetryOf(engineAnswers);
  const pendingRetry = retry && retry.value === null ? retry : null;
  if (pendingRetry && msgs.length <= pendingRetry.n) return {kind: 'ask', followUp: retryQuestion(pendingRetry.n)};
  const failQuestion = pendingRetry ? symNotFoundQuestion : () => retryQuestion(msgs.length);
  if (fromAnswers?.kind === 'needLlm') {
    // b. sym_other: 사전이 일부만 맞은 경우. 메시지가 없으면 LLM을 부를 수 없으므로 증상 모름.
    if (msgs.length === 0) return {kind: 'unknown', source: 'dict_confirm'};
    if (noLlm) return {kind: 'unknown', source: typeof noLlm === 'string' ? noLlm : 'start_choice'};
    return runLlm({messages: msgs, codes, data, deps, ctx, preclassified, failQuestion, forceFull: fromAnswers.forceFull === true});
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
  // f. LLM (시작 선택을 무시하고 온 경우는 부르지 않고 증상 모름)
  if (noLlm) return {kind: 'unknown', source: typeof noLlm === 'string' ? noLlm : 'start_choice'};
  return runLlm({messages: msgs, codes, data, deps, ctx, preclassified, failQuestion});
}
