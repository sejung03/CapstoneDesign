// 문진 엔진 공개 함수 runCare(설계 §2·§4). 상태 없는 함수: 프론트가 매번 보내는 메시지·답만으로 다시 계산한다.
// 예외를 밖으로 던지지 않는다. trace·로그에는 사용자 원문을 넣지 않는다.
import {classifySymptom, extractProfileUpdates} from '../llm/index.mjs';
import {loadIntakeData} from './intake-data.mjs';
import {normalizeAnswers, visibleCodes} from './answers.mjs';
import {evaluateSafety, safetyCheckItemIds} from './rules.mjs';
import {loadFreeTextRules} from './free-text.mjs';
import {nextQuestion, itemToFollowUp} from './flow.mjs';
import {applyMappings} from './slots.mjs';
import {matchSymptoms as defaultMatchSymptoms} from './dictionary-match.mjs';
import {evaluateFacilityKeywords, loadFacilityKeywords, messageCues} from './facility-keywords.mjs';
import {identify, resolveFromAnswers, userMessages} from './identify.mjs';
import {recommend, symptomSexMismatch} from './recommend.mjs';
import {buildSummary, buildEmergencySummary, buildMedInfoSummary} from './summary.mjs';
import {emergencyNotice, withAddon, REFERRAL_ADDONS, riskConfirmQuestion, ENGINE_Q, OPT, TEMPLATE_VERSION} from './templates.mjs';
import {resolveRiskConfirm} from './risk-confirm.mjs';
import {RISK_CONFIRM_KEY, SENSITIVE_KEYS, SENSITIVE_CUE_RE} from './constants.mjs';
import {normalizeTerm} from '../llm/normalize.mjs';
import {stripNoise} from './free-text.mjs';

const CRISIS_KEY = 'crisis_notice_109';
import {checkResponseContract} from './contract.mjs';
import {TARGET_ITEM_ID, TARGET_SELF, INJURY_ITEM_ID, INJURY_YES} from './constants.mjs';

export const ENGINE_VERSION = 'care-engine-v1';
export const ENGINE_BUDGET_MS = 7000;
export const SUPPORTED_REASONS = Object.freeze(['message', 'followup', 'skip', 'previousReport', 'intake']);
/** 11/17 EF warning 코드(값 없이 코드만). */
export const WARNING_SYMPTOM_SEX_MISMATCH = 'symptom_sex_mismatch';
export const WARNING_START_CHOICE_OVERRIDDEN = 'start_choice_overridden';
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
/** 11/17 EF(G1): 주입한 now가 던지거나 숫자가 아니면 Date.now()로 대신한다. */
function safeNowOf(fn) {
  if (typeof fn !== 'function') return Date.now;
  return () => {
    try {
      const t = fn();
      return Number.isFinite(t) ? t : Date.now();
    } catch {
      return Date.now();
    }
  };
}

/** 11/17 EF(G1): 주입한 log가 던져도 무시한다(LLM 모듈에 넘기는 log도 이것). */
function safeLogOf(fn) {
  if (typeof fn !== 'function') return noop;
  return (event) => safeLog(fn, event);
}

/** deps·ctx 필드를 읽다가 getter가 던져도 undefined로 본다. */
function readField(obj, key) {
  try { return obj?.[key]; } catch { return undefined; }
}

const DEP_FIELDS = Object.freeze(['refStore', 'matchSymptoms', 'llm', 'freeTextRules', 'facilityKeywords']);
function readAll(d) {
  const out = {};
  for (const k of DEP_FIELDS) {
    const v = readField(d, k);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export async function runCare(payload, ctx = {}, deps = {}) {
  // 11/17 EF(G1): 주입 함수(now·log 등) 실패로 예외가 밖으로 나가지 않게 모두 감싼다.
  let d = {};
  let c = {};
  try { if (deps && typeof deps === 'object') d = deps; } catch { d = {}; }
  try { if (ctx && typeof ctx === 'object') c = ctx; } catch { c = {}; }
  const now = safeNowOf(readField(d, 'now'));
  const log = safeLogOf(readField(d, 'log'));
  const start = now();
  const reason = readField(payload, 'reason');
  const trace = newTrace(reason);
  let out;
  try {
    out = await core(payload, c, {...readAll(d), now, log}, trace, now, log);
  } catch {
    trace.phase = 'error';
    trace.warnings.push('internal_exception');
    out = {response: null, error: 'internal'};
  }
  let requestId = null;
  try { requestId = typeof c.requestId === 'string' ? c.requestId : null; } catch { requestId = null; }
  safeLog(log, {
    event: 'engine.run',
    requestId,
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
  const {codes, engine, warnings, riskConfirms} = normalizeAnswers(payload.followUpAnswers, data);
  trace.warnings.push(...warnings);
  const vis = visibleCodes(codes, data);

  // 1. 안전 규칙(자유 입력 + 답) — 매 요청 맨 먼저
  const safety = evaluateSafety({codes: vis, messages, data, freeTextRules});
  // 11/17 RF3: 민감 안내 hit(109·112·1366)는 다른 규칙과 함께 걸려도 trace·로그에 남기지 않는다
  const isSensitive = (h) => SENSITIVE_KEYS.includes(h.messageKey);
  trace.ruleHits = safety.hits.filter((h) => !isSensitive(h)).map((h) => h.ruleId);
  // 11/17 RF2: freetext_urgent hit는 확인 질문(RISK_CONFIRM_<n>)의 답으로 거른다. '예'일 때만 지금처럼 terminal
  const risk = resolveRiskConfirm({hits: safety.hits, riskConfirms, messageCount: messages.length, reason});
  if (risk.state !== 'none') trace.riskConfirm = {state: risk.state, asks: risk.asks};
  const isUrgentFree = (h) => h.source === 'free_text' && h.messageKey === RISK_CONFIRM_KEY;
  let top = safety.hits.find((h) => !isUrgentFree(h) || risk.state === 'yes') ?? null;
  // 11/17 RF6(검토 I4): 답 기반 EMERGENCY_STOP(Q0=예 등)은 민감 안내보다 먼저(지시서: EMERGENCY_STOP이 가장 먼저)
  const answerStop = safety.hits.find((h) => h.source === 'answer' && h.result === 'EMERGENCY_STOP');
  if (top && isSensitive(top) && answerStop) top = answerStop;
  // 11/17 RF6(검토 S2): 민감 단서가 있으면(규칙이 놓친 경우 포함) 이 요청에서 LLM을 부르지 않는다
  const sensitiveCue = messages.some((m) => { const t = normalizeTerm(m); return SENSITIVE_CUE_RE.test(t) || SENSITIVE_CUE_RE.test(stripNoise(t)); });

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
  // 11/17 RF3: 민감 안내가 가장 앞서면 기관 안내만 내고 끝낸다. 질문·진료과·search·summary·profileUpdates 없음, LLM 호출 없음.
  // trace에는 {kind:'sensitive_referral'}만 남긴다(rule_id·message_key·메시지 위치·패턴·다른 hit 목록 없음).
  if (top && isSensitive(top)) {
    const response = {emergency: emergencyNotice(top.messageKey).emergency};
    const check = checkResponseContract(response);
    if (!check.ok) return fail('contract');
    if (signal?.aborted) return fail('aborted');
    for (const k of ['ruleHits', 'warnings', 'skippedItems']) trace[k] = [];
    delete trace.riskConfirm;
    trace.slots = null;
    trace.terminal = true;
    trace.sensitive = {kind: 'sensitive_referral'};
    trace.phase = 'sensitive_referral';
    return {response};
  }
  if (top) {
    const notice = emergencyNotice(top.messageKey);
    if (notice.warning) trace.warnings.push(`${notice.warning}:${top.ruleId}`);
    // 11/17 R6(검토 I5)·RF6(검토 I4): 민감 안내 규칙이 함께 걸렸으면 앞선 문구에 그 기관 한 문장씩 덧붙인다(trace에는 남기지 않음)
    for (const key of SENSITIVE_KEYS) {
      if (top.messageKey !== key && safety.hits.some((h) => h.messageKey === key)) notice.emergency = withAddon(notice.emergency, REFERRAL_ADDONS[key]);
    }
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
  // 11/17 RF2: 확인 질문(대상: freetext_urgent). 확인 전이면 응급 안내(문진 계속형) + 확인 질문, 진료과·search 없음
  if (risk.state === 'pending') {
    const notice = emergencyNotice(RISK_CONFIRM_KEY);
    return finish({emergency: carryEmergency ?? notice.emergency, followUp: riskConfirmQuestion(risk.askId)}, 'risk_confirm');
  }
  if (risk.state === 'unsure') carryEmergency ??= emergencyNotice(RISK_CONFIRM_KEY).emergency; // 이후 모든 응답에 안내를 붙이고 문진 계속
  if (risk.state === 'no') carryEmergency ??= {active: false}; // 앞서 보낸 응급 안내를 프론트에서 해제(BACKEND.md 0.11.0)
  const withEmergency = (response) => (carryEmergency ? {...response, emergency: carryEmergency} : response);

  // 메시지 사전 매칭(성별 거르기 없이, 키워드·시작 선택 고정 해제에 씀). 매칭 함수가 던져도 0개로 본다.
  let dictCache = null;
  const dictMatches = () => {
    if (dictCache) return dictCache;
    const matcher = typeof deps.matchSymptoms === 'function' ? deps.matchSymptoms : defaultMatchSymptoms;
    try { dictCache = messages.length > 0 ? (matcher(messages.join('\n'), data.refData, {sex: null}) ?? []) : []; } catch { dictCache = []; }
    if (!Array.isArray(dictCache)) dictCache = [];
    return dictCache;
  };

  // 2. 시작 선택(엔진 질문 ASK_START·MED_CHOICE)의 답 — 사용자가 명시적으로 고른 것
  //    11/17 EF(G3): 메시지에 사전 증상 매칭·증상 단서·위험 단서가 하나라도 있으면 검색 답(find_*, med_pharmacy, med_info)을
  //    무시하고 정상 흐름(이 경우 증상 확인에서 LLM을 부르지 않는다). med_symptom은 기존대로.
  let startOverridden = false;
  const overrideStart = () => {
    const cues = messageCues(messages, data, facilityKeywords);
    if (dictMatches().length > 0 || cues.symptomCue || cues.riskCue) {
      if (!startOverridden) trace.warnings.push(WARNING_START_CHOICE_OVERRIDDEN);
      startOverridden = true;
      return true;
    }
    return false;
  };
  if (engine.has(ENGINE_Q.ASK_START)) {
    const v = engine.get(ENGINE_Q.ASK_START);
    if (v === OPT.findHospital || v === OPT.findPharmacy) {
      if (!overrideStart()) {
        return finish(withEmergency({search: v === OPT.findHospital ? {type: 'hospital'} : {...PHARMACY_SEARCH}}), 'start_choice');
      }
    } else trace.warnings.push(`invalid_answer:${ENGINE_Q.ASK_START}`);
  }
  if (engine.has(ENGINE_Q.MED_CHOICE)) {
    const v = engine.get(ENGINE_Q.MED_CHOICE);
    if (v === OPT.medPharmacy || v === OPT.medInfo) {
      if (!overrideStart()) {
        if (v === OPT.medPharmacy) return finish(withEmergency({search: {...PHARMACY_SEARCH}}), 'start_choice');
        return finish(withEmergency({summary: {ko: buildMedInfoSummary()}, search: {...PHARMACY_SEARCH}}), 'start_choice');
      }
    } else if (v === OPT.medSymptom) symptom = {kind: 'unknown', source: 'med_symptom'};
    else trace.warnings.push(`invalid_answer:${ENGINE_Q.MED_CHOICE}`);
  }

  // 3. 키워드 기관 찾기(첫 요청 흐름, LLM 없음). 11/17 EF: 약국 찾기 문장만, 위험 단서가 있으면 막는다(사유 코드만 trace)
  const hasAnyAnswer = codes.size > 0 || engine.size > 0 || riskConfirms.length > 0;
  if (!hasAnyAnswer && messages.length > 0) {
    const kw = evaluateFacilityKeywords({messages, hasAnyAnswer, dictMatches: dictMatches(), data, rules: facilityKeywords});
    trace.facilityKeyword = kw.reason;
    if (kw.search) return finish(withEmergency({search: kw.search}), 'facility_keyword');
  }

  // 11/17 EF(I2): 확정 증상의 성별 제한과 filter.sex(보이는 T2 답)가 어긋나면 증상 모름 + warning(값 없이 코드만)
  const sexFilter = applyMappings({codes: vis, data}).filter.sex.value;
  const guardSex = (sym) => {
    if (sym?.kind !== 'symptom') return sym;
    if (!symptomSexMismatch(data.refData.symptoms.get(sym.symptomId), sexFilter)) return sym;
    if (!trace.warnings.includes(WARNING_SYMPTOM_SEX_MISMATCH)) trace.warnings.push(WARNING_SYMPTOM_SEX_MISMATCH);
    return {kind: 'unknown', source: 'sex_mismatch'};
  };

  // 증상 상태(답만으로, LLM 없음)
  if (!symptom) {
    const r = resolveFromAnswers(engine, data.refData);
    if (r && r.kind !== 'needLlm') symptom = guardSex(r);
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
        engineAnswers: engine, messages, codes: vis, data, // 11/17 EF(G4): 성별은 보이는 답에서만
        deps: {llm, matchSymptoms: deps.matchSymptoms, facilityKeywords},
        ctx: {consent: ctx.consent, signal, deadlineAt, requestId: ctx.requestId ?? null, reason, now},
        noLlm: startOverridden ? 'start_choice' : (sensitiveCue ? 'no_llm' : false),
      });
      if (signal?.aborted) return fail('aborted');
      if (r.llmMeta) { trace.llm.classify = r.llmMeta; llmUsed = true; }
      if (r.kind === 'ask') return finish(withEmergency({followUp: r.followUp}), 'identify');
      if (r.kind === 'search') return finish(withEmergency({search: r.search}), 'identify');
      if (r.kind === 'medInfo') return finish(withEmergency({summary: {ko: buildMedInfoSummary()}, search: {...PHARMACY_SEARCH}}), 'identify');
      symptom = r.kind === 'symptom' ? guardSex(r) : {kind: 'unknown', source: r.source ?? 'unknown'};
      nq = nextQuestion({codes, data, mode: 'normal', symptomState: stateOf()});
    }
    trace.skippedItems = nq.skippedItems;
    if (nq.kind === 'item') return finish(withEmergency({followUp: itemToFollowUp(nq.item, data, locale)}), 'question');
  } else if (!symptom) {
    symptom = {kind: 'unknown', source: 'skip'}; // 증상 확인 전 skip(또는 sym_other 뒤 skip): LLM 부르지 않고 증상 모름
  }

  // 7. 완료: 추천·요약·검색·건강정보 후보
  const symptomObj = setSlots();
  // 11/17 EF(G5): F2 답은 F2가 묻는 상태(증상 fallback·모름)일 때만 쓴다. 증상이 확정돼 F2가 숨겨지면 무시.
  const injuryAsked = ['fallback', 'unknown'].includes(stateOf());
  const rec = recommend({
    symptom: symptomObj,
    filter: {sex: trace.slots.filter.sex.value, ageBand: trace.slots.filter.age_band.value},
    injuryAnswer: injuryAsked && vis.get(INJURY_ITEM_ID) === INJURY_YES,
    data,
  });
  trace.symptom.fallbackGroup = rec.group;
  // 11/17 EF(G6): 안전 미응답 판단 문항은 답 규칙이 가리키는 문항 전체(데이터에서 만듦)
  const safetyUnanswered = safetyCheckItemIds(data).some((id) => !vis.has(id));
  const summary = buildSummary({slots: trace.slots, codes: vis, symptom: symptomObj, departments: rec.departments, data, safetyUnanswered, riskUnconfirmed: risk.state === 'unsure', group: rec.group}); // 11/17 RG1: RF 판단 #11(지나간 사건 '아니요' 경고) 삭제 — 질문 기준이 '오늘'이 되어 필요 없음
  const response = withEmergency({summary: {ko: summary}, search: rec.search});

  // 건강정보 후보: 상담 대상이 본인일 때만, 요청당 LLM 1번(이미 증상 분류를 불렀으면 건너뜀)
  if (vis.get(TARGET_ITEM_ID) === TARGET_SELF) {
    if (sensitiveCue) {
      trace.llm.profile = {called: false, skipped: 'no_llm'}; // 11/17 RF6(검토 S2): 민감 단서가 있으면 건강정보 추출도 하지 않는다
    } else if (llmUsed) {
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
