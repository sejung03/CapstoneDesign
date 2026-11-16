// 문진 엔진 공개 함수 runCare(설계 §2·§4). 상태 없는 함수: 프론트가 매번 보내는 메시지·답만으로 다시 계산한다.
// 예외를 밖으로 던지지 않는다. trace·로그에는 사용자 원문을 넣지 않는다.
import {classifySymptom, extractProfileUpdates} from '../llm/index.mjs';
import {loadIntakeData} from './intake-data.mjs';
import {normalizeAnswers, visibleCodes} from './answers.mjs';
import {evaluateSafety} from './rules.mjs';
import {loadFreeTextRules} from './free-text.mjs';
import {nextQuestion, itemToFollowUp} from './flow.mjs';
import {applyMappings} from './slots.mjs';
import {matchSymptoms as defaultMatchSymptoms} from './dictionary-match.mjs';
import {evaluateFacilityKeywords, loadFacilityKeywords} from './facility-keywords.mjs';
import {identify, resolveFromAnswers, userMessages} from './identify.mjs';
import {recommend} from './recommend.mjs';
import {buildSummary, buildEmergencySummary, buildMedInfoSummary} from './summary.mjs';
import {emergencyNotice, ENGINE_Q, OPT, TEMPLATE_VERSION} from './templates.mjs';
import {checkResponseContract} from './contract.mjs';

export const ENGINE_VERSION = 'care-engine-v1';
export const ENGINE_BUDGET_MS = 7000;
export const SUPPORTED_REASONS = Object.freeze(['message', 'followup', 'skip', 'previousReport', 'intake']);
/** 상담 대상(T1)·다쳐서 생긴 증상(F2). 결과 매핑 slot이 없어 ID로 읽는 예외(설계 §0 1번, §8-1·§8-3). */
const TARGET_ITEM_ID = 'T1';
const INJURY_ITEM_ID = 'F2';
const SAFETY_FLOWS = new Set(['start', 'safety']);
export const ERROR_CODES = Object.freeze(['unsupported_reason', 'aborted', 'data', 'contract', 'internal']);

const noop = () => {};
const PHARMACY_SEARCH = Object.freeze({type: 'pharmacy', department: 'pharmacy'});

function safeLog(log, event) {
  try { log(event); } catch { /* 로그 실패가 응답을 막지 않는다 */ }
}

/** fn(input)을 deadline·signal 안에서 기다린다. 늦거나 실패하면 fallback 값. 예외를 던지지 않는다. */
async function withDeadline(fn, input, {signal, deadlineAt, now}, fallback) {
  const remaining = deadlineAt - now();
  if (signal?.aborted || !(remaining > 0) || typeof fn !== 'function') return {value: fallback, why: signal?.aborted ? 'aborted' : typeof fn !== 'function' ? 'no_llm' : 'timeout'};
  let timer;
  let onAbort;
  try {
    return await Promise.race([
      Promise.resolve().then(() => fn(input)).then((value) => ({value, why: null}), () => ({value: fallback, why: 'exception'})),
      new Promise((resolve) => { timer = setTimeout(() => resolve({value: fallback, why: 'timeout'}), remaining); }),
      new Promise((resolve) => {
        onAbort = () => resolve({value: fallback, why: 'aborted'});
        signal?.addEventListener?.('abort', onAbort, {once: true});
      }),
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onAbort);
  }
}

function resolveData(deps) {
  if (typeof deps.refStore === 'function') return deps.refStore();
  if (deps.refStore && typeof deps.refStore === 'object') return deps.refStore;
  return loadIntakeData();
}

function newTrace(reason) {
  return {
    engineVersion: ENGINE_VERSION,
    templateVersion: TEMPLATE_VERSION,
    dataVersion: null,
    questionnaireVersion: null,
    freeTextVersion: null,
    facilityKeywordsVersion: null,
    reason: SUPPORTED_REASONS.includes(reason) ? reason : 'unsupported',
    phase: null,
    facilityKeyword: null, // 11/17 EF: 키워드 지름길을 본 경우 사유 코드(search·blocked_risk 등), 보지 않았으면 null
    ruleHits: [],
    terminal: false,
    nextQuestionId: null,
    symptom: {id: null, source: null, fallback: null, fallbackGroup: null},
    slots: null,
    skippedItems: [],
    llm: {classify: {called: false}, profile: {called: false}},
    warnings: [],
  };
}

/**
 * @param {object} payload 프론트 요청 그대로(reason, locale, messages, followUpAnswers, profile, search, intake, previousReport)
 * @param {{signal?:AbortSignal, deadlineAt?:number, consent?:object, requestId?:string}} [ctx]
 * @param {{refStore?:object|Function, matchSymptoms?:Function, llm?:{classifySymptom?:Function, extractProfileUpdates?:Function},
 *          freeTextRules?:object, facilityKeywords?:object, log?:Function, now?:Function}} [deps]
 * @returns {Promise<{response:object, trace:object} | {response:null, error:string, trace:object}>}
 */
export async function runCare(payload, ctx = {}, deps = {}) {
  const d = deps && typeof deps === 'object' ? deps : {};
  const now = typeof d.now === 'function' ? d.now : Date.now;
  const log = typeof d.log === 'function' ? d.log : noop;
  const c = ctx && typeof ctx === 'object' ? ctx : {};
  const start = now();
  const reason = payload && typeof payload === 'object' ? payload.reason : undefined;
  const trace = newTrace(reason);
  let out;
  try {
    out = await core(payload, c, d, trace, now, log);
  } catch {
    trace.phase = 'error';
    trace.warnings.push('internal_exception');
    out = {response: null, error: 'internal'};
  }
  safeLog(log, {
    event: 'engine.run',
    requestId: typeof c.requestId === 'string' ? c.requestId : null,
    reason: trace.reason,
    phase: trace.phase,
    ruleHits: [...trace.ruleHits],
    terminal: trace.terminal,
    nextQuestionId: trace.nextQuestionId,
    symptomId: trace.symptom.id,
    symptomSource: trace.symptom.source,
    llmClassify: trace.llm.classify.called ? (trace.llm.classify.status ?? null) : null,
    llmClassifyFallback: trace.llm.classify.fallbackReason ?? null,
    llmProfile: trace.llm.profile.called ? (trace.llm.profile.error ?? 'ok') : null,
    latencyMs: now() - start,
    dataVersion: trace.dataVersion,
    engineVersion: ENGINE_VERSION,
    error: out.error ?? null,
  });
  return out.error ? {response: null, error: out.error, trace} : {response: out.response, trace};
}

async function core(payload, ctx, deps, trace, now, log) {
  const fail = (error, phase = 'error') => { trace.phase = phase; return {response: null, error}; };
  if (!payload || typeof payload !== 'object' || !SUPPORTED_REASONS.includes(payload.reason)) return fail('unsupported_reason');
  const reason = payload.reason;
  const signal = ctx.signal;
  if (signal?.aborted) return fail('aborted');
  const deadlineAt = Math.min(Number.isFinite(ctx.deadlineAt) ? ctx.deadlineAt : Infinity, now() + ENGINE_BUDGET_MS);
  const locale = payload.locale === 'en' ? 'en' : 'ko';

  // 데이터·규칙 파일
  let data;
  let freeTextRules;
  let facilityKeywords;
  try {
    data = resolveData(deps);
    freeTextRules = deps.freeTextRules ?? loadFreeTextRules();
    facilityKeywords = deps.facilityKeywords ?? loadFacilityKeywords();
  } catch {
    trace.warnings.push('data_load_failed');
    return fail('data');
  }
  trace.dataVersion = data.dataVersion;
  trace.questionnaireVersion = data.questionnaire?.version ?? null;
  trace.freeTextVersion = freeTextRules?.version ?? null;
  trace.facilityKeywordsVersion = facilityKeywords?.version ?? null;

  const llm = {
    classifySymptom: deps.llm?.classifySymptom ?? ((input) => classifySymptom(input, {log})),
    extractProfileUpdates: deps.llm?.extractProfileUpdates ?? ((input) => extractProfileUpdates(input, {log})),
  };

  // 0. 입력 정리 (previousReport·intake·profile·search 내용은 v1에서 쓰지 않는다)
  const messages = userMessages(payload.messages);
  const {codes, engine, warnings} = normalizeAnswers(payload.followUpAnswers, data);
  trace.warnings.push(...warnings);
  const vis = visibleCodes(codes, data);

  // 1. 안전 규칙(자유 입력 + 답) — 매 요청 맨 먼저
  const safety = evaluateSafety({codes: vis, messages, data, freeTextRules});
  trace.ruleHits = safety.hits.map((h) => h.ruleId);
  const top = safety.top;

  let symptom = null; // {kind:'symptom'|'unknown', symptomId?, source}
  let llmUsed = false;
  const setSlots = () => {
    const s = symptom?.kind === 'symptom' ? data.refData.symptoms.get(symptom.symptomId) : null;
    trace.slots = applyMappings({codes: vis, ruleHits: safety.hits, data, symptom: s});
    trace.symptom.id = s?.id ?? null;
    trace.symptom.source = symptom?.source ?? null;
    trace.symptom.fallback = symptom ? !s || s.isFallback : null;
    return s;
  };
  const finish = (response, phase) => {
    trace.phase = phase;
    setSlots();
    if (response.followUp) trace.nextQuestionId = response.followUp.id;
    const check = checkResponseContract(response);
    if (!check.ok) {
      trace.warnings.push(`contract:${check.errors.slice(0, 3).join('|')}`);
      trace.nextQuestionId = null;
      return fail('contract');
    }
    if (signal?.aborted) return fail('aborted');
    return {response};
  };

  // 응급(설계 §6): EMERGENCY_STOP, 또는 terminal URGENT_NOTICE → 진료과·search 없음
  let carryEmergency = null;
  if (top) {
    const notice = emergencyNotice(top.messageKey);
    if (notice.warning) trace.warnings.push(`${notice.warning}:${top.ruleId}`);
    if (top.result === 'EMERGENCY_STOP' || top.terminal) {
      trace.terminal = true;
      const response = {emergency: notice.emergency};
      if (top.result === 'EMERGENCY_STOP') {
        const nq = reason === 'skip' ? {kind: 'done', skippedItems: []} : nextQuestion({codes, data, mode: 'emergency'});
        trace.skippedItems = nq.skippedItems;
        if (nq.kind === 'item') response.followUp = itemToFollowUp(nq.item, data, locale);
        else {
          trace.slots = applyMappings({codes: vis, ruleHits: safety.hits, data});
          const s = buildEmergencySummary({slots: trace.slots, data});
          if (s) response.summary = {ko: s};
        }
      }
      return finish(response, 'emergency');
    }
    carryEmergency = notice.emergency; // terminal: false인 URGENT_NOTICE(지금 데이터에는 없음): 안내 + 문진 계속
  }
  const withEmergency = (response) => (carryEmergency ? {...response, emergency: carryEmergency} : response);

  // 2. 시작 선택(엔진 질문 ASK_START·MED_CHOICE)의 답 — 사용자가 명시적으로 고른 것
  if (engine.has(ENGINE_Q.ASK_START)) {
    const v = engine.get(ENGINE_Q.ASK_START);
    if (v === OPT.findHospital) return finish(withEmergency({search: {type: 'hospital'}}), 'start_choice');
    if (v === OPT.findPharmacy) return finish(withEmergency({search: {...PHARMACY_SEARCH}}), 'start_choice');
    trace.warnings.push(`invalid_answer:${ENGINE_Q.ASK_START}`);
  }
  if (engine.has(ENGINE_Q.MED_CHOICE)) {
    const v = engine.get(ENGINE_Q.MED_CHOICE);
    if (v === OPT.medPharmacy) return finish(withEmergency({search: {...PHARMACY_SEARCH}}), 'start_choice');
    if (v === OPT.medInfo) return finish(withEmergency({summary: {ko: buildMedInfoSummary()}, search: {...PHARMACY_SEARCH}}), 'start_choice');
    if (v === OPT.medSymptom) symptom = {kind: 'unknown', source: 'med_symptom'};
    else trace.warnings.push(`invalid_answer:${ENGINE_Q.MED_CHOICE}`);
  }

  // 3. 키워드 기관 찾기(첫 요청 흐름, LLM 없음). 11/17 EF: 약국 찾기 문장만, 위험 단서가 있으면 막는다(사유 코드만 trace)
  const hasAnyAnswer = codes.size > 0 || engine.size > 0;
  if (!hasAnyAnswer && messages.length > 0) {
    const matcher = typeof deps.matchSymptoms === 'function' ? deps.matchSymptoms : defaultMatchSymptoms;
    let dict = [];
    try { dict = matcher(messages.join('\n'), data.refData, {sex: null}) ?? []; } catch { dict = []; }
    const kw = evaluateFacilityKeywords({messages, hasAnyAnswer, dictMatches: dict, data, rules: facilityKeywords});
    trace.facilityKeyword = kw.reason;
    if (kw.search) return finish(withEmergency({search: kw.search}), 'facility_keyword');
  }

  // 증상 상태(답만으로, LLM 없음)
  if (!symptom) {
    const r = resolveFromAnswers(engine, data.refData);
    if (r && r.kind !== 'needLlm') symptom = r;
  }
  const stateOf = () => {
    if (!symptom) return 'pending';
    if (symptom.kind === 'unknown') return 'unknown';
    return data.refData.symptoms.get(symptom.symptomId)?.isFallback ? 'fallback' : 'known';
  };

  // 4~6. 다음 문항(skip이면 묻지 않고 완료)
  if (reason !== 'skip') {
    let nq = nextQuestion({codes, data, mode: 'normal', symptomState: stateOf()});
    if (nq.kind === 'identify') {
      const r = await identify({
        engineAnswers: engine, messages, codes, data,
        deps: {llm, matchSymptoms: deps.matchSymptoms, facilityKeywords},
        ctx: {consent: ctx.consent, signal, deadlineAt, requestId: ctx.requestId ?? null, reason, now},
      });
      if (signal?.aborted) return fail('aborted');
      if (r.llmMeta) { trace.llm.classify = r.llmMeta; llmUsed = true; }
      if (r.kind === 'ask') return finish(withEmergency({followUp: r.followUp}), 'identify');
      if (r.kind === 'search') return finish(withEmergency({search: r.search}), 'identify');
      if (r.kind === 'medInfo') return finish(withEmergency({summary: {ko: buildMedInfoSummary()}, search: {...PHARMACY_SEARCH}}), 'identify');
      symptom = r.kind === 'symptom' ? r : {kind: 'unknown', source: r.source ?? 'unknown'};
      nq = nextQuestion({codes, data, mode: 'normal', symptomState: stateOf()});
    }
    trace.skippedItems = nq.skippedItems;
    if (nq.kind === 'item') return finish(withEmergency({followUp: itemToFollowUp(nq.item, data, locale)}), 'question');
  } else if (!symptom) {
    symptom = {kind: 'unknown', source: 'skip'}; // 증상 확인 전 skip(또는 sym_other 뒤 skip): LLM 부르지 않고 증상 모름
  }

  // 7. 완료: 추천·요약·검색·건강정보 후보
  const symptomObj = setSlots();
  const rec = recommend({
    symptom: symptomObj,
    filter: {sex: trace.slots.filter.sex.value, ageBand: trace.slots.filter.age_band.value},
    injuryAnswer: vis.get(INJURY_ITEM_ID) === 'yes',
    data,
  });
  trace.symptom.fallbackGroup = rec.group;
  const safetyUnanswered = data.items.some((it) => SAFETY_FLOWS.has(it.flow) && !vis.has(it.linkId));
  const summary = buildSummary({slots: trace.slots, codes: vis, symptom: symptomObj, departments: rec.departments, data, safetyUnanswered});
  const response = withEmergency({summary: {ko: summary}, search: rec.search});

  // 건강정보 후보: 상담 대상이 본인일 때만, 요청당 LLM 1번(이미 증상 분류를 불렀으면 건너뜀)
  if (vis.get(TARGET_ITEM_ID) === 'self') {
    if (llmUsed) {
      trace.llm.profile = {called: false, skipped: 'llm_once_per_request'};
    } else {
      const input = {
        messages: Array.isArray(payload.messages) ? payload.messages : [],
        consent: ctx.consent, signal, deadlineAt, requestId: ctx.requestId ?? null, reason,
      };
      const r = await withDeadline(llm.extractProfileUpdates, input, {signal, deadlineAt, now}, {items: []});
      if (signal?.aborted) return fail('aborted');
      const items = Array.isArray(r.value?.items) ? r.value.items : [];
      const metaError = typeof r.value?.meta?.error === 'string' ? r.value.meta.error : null;
      trace.llm.profile = {called: true, itemCount: items.length, fields: items.map((i) => (typeof i?.field === 'string' ? i.field : null)), error: r.why ?? metaError};
      if (items.length > 0) {
        const check = checkResponseContract({profileUpdates: items});
        if (check.ok) response.profileUpdates = items;
        else { trace.warnings.push('profile_updates_invalid'); trace.llm.profile.error = 'invalid'; }
      }
    }
  }
  return finish(response, 'complete');
}
