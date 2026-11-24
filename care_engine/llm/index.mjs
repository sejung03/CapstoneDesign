// LLM 모듈 공개 함수: classifySymptom(), extractProfileUpdates().
// 원문·quote·value·업체 응답 원문은 로그(log)와 meta에 넣지 않는다(설계 7절).
import {getConfig, RISK_MAX_OUTPUT_TOKENS} from './config.mjs';
import {getProvider} from './provider.mjs';
import {loadRefData} from './ref-data.mjs';
import {maskPii} from './pii.mjs';
import {tailChars, INPUT_MAX_CHARS} from './normalize.mjs';
import {buildCandidates, formatCandidatesForPrompt} from './candidates.mjs';
import {symptomPickSchema, symptomRiskSchema, riskSignalSchema, profileExtractSchema, rewriteSchema, REWRITE_SCHEMA_NAME, REWRITE_RISK_SCHEMA_NAME} from './schemas.mjs';
import {validateSymptomPick, validateSymptomRisk, validateRiskSignal, validateProfileItems, validateRewrite} from './validate.mjs';
import {buildSymptomConfirm, buildRewriteConfirm} from './confirm-question.mjs';
import {hasProfileSignal} from './profile-trigger.mjs';
import {isRetryable, STOP_ERRORS} from './errors.mjs';
import {matchSymptoms} from '../engine/dictionary-match.mjs';
import symptomPrompt from './prompts/symptom_v2.mjs';
import profilePrompt from './prompts/profile_v1.mjs';
import riskPrompt from './prompts/risk_v2.mjs';
import symptomRiskPrompt from './prompts/symptom_risk_v3.mjs';
import rewritePrompt from './prompts/symptom_rewrite_v1.mjs';
import rewriteRiskPrompt from './prompts/symptom_rewrite_risk_v1.mjs';

const noop = () => {};

/**
 * 외부 AI 이용 동의 확인. 업체명이 들어간 버전이어야 한다(BACKEND.md 465행, 설계 5-1).
 * consent = {granted:true, provider:'<업체명>', version:'<동의문 버전>', healthInfo?:true}
 * 불리언 true 같은 포괄 동의는 인정하지 않는다.
 */
export function hasExternalAiConsent(consent, providerName) {
  return Boolean(consent && typeof consent === 'object' && consent.granted === true
    && consent.provider === providerName && typeof consent.version === 'string' && consent.version.trim() !== '');
}

/**
 * 개발용 동의(L4-MVP M2). consent가 아예 없고(undefined·null) LLM_DEV_CONSENT=true일 때만
 * 현재 업체 이름으로 동의한 것으로 간주한다. 실제 consent 값이 오면 devConsent는 무시하고 엄격하게 검사한다.
 * ⚠ 운영 전 LLM_DEV_CONSENT를 끄고 실제 동의 기능과 연결해야 한다.
 * @returns {{consent:object|null, source:'request'|'dev'|null}}
 */
export function resolveConsent(consent, providerName, config) {
  if (consent === undefined || consent === null) {
    if (config?.devConsent === true) {
      return {consent: {granted: true, provider: providerName, version: 'dev-assumed', healthInfo: true}, source: 'dev'};
    }
    return {consent: null, source: null};
  }
  return {consent, source: 'request'};
}

const emptyTokens = () => ({input: 0, cachedInput: 0, output: 0, reasoning: 0});

function resolveDeps(deps = {}) {
  const config = deps.config ?? getConfig();
  return {
    config,
    provider: deps.provider ?? getProvider({config}),
    refData: deps.refData,
    log: typeof deps.log === 'function' ? deps.log : noop,
    now: typeof deps.now === 'function' ? deps.now : Date.now,
  };
}

/**
 * 시간 예산·재시도 규칙(설계 5-9)으로 provider를 부른다. 예외를 던지지 않는다.
 * @returns {Promise<{ok:boolean, data?:any, error?:string, attempts:number, tokens:{input:number, output:number}}>}
 */
async function callProvider(provider, req, {config, signal, deadline, now}) {
  let attempts = 0;
  const tokens = emptyTokens();
  let providerError = null;
  let servedTier = null; // 11/24: 응답이 알려 준 실제 처리 등급(service_tier)
  for (;;) {
    if (signal?.aborted) return {ok: false, error: 'aborted', attempts, tokens, providerError, servedTier};
    const remaining = deadline - now();
    if (remaining <= 0) return {ok: false, error: 'timeout', attempts, tokens, providerError, servedTier};
    const timeoutMs = Math.min(config.timeoutMs, remaining);
    attempts += 1;
    const res = await callOnce(provider, {...req, timeoutMs}, signal);
    if (Number.isFinite(res.meta?.inputTokens)) tokens.input += res.meta.inputTokens;
    if (Number.isFinite(res.meta?.cachedInputTokens)) tokens.cachedInput += res.meta.cachedInputTokens;
    if (Number.isFinite(res.meta?.outputTokens)) tokens.output += res.meta.outputTokens;
    if (Number.isFinite(res.meta?.reasoningTokens)) tokens.reasoning += res.meta.reasoningTokens;
    if (typeof res.meta?.serviceTier === 'string') servedTier = res.meta.serviceTier;
    if (res.ok) return {ok: true, data: res.data, attempts, tokens, providerError: null, servedTier};
    // 어댑터가 이미 형식 검사한 짧은 code·param·HTTP 상태만(본문 없음)
    providerError = {
      httpStatus: Number.isFinite(res.meta?.httpStatus) ? res.meta.httpStatus : null,
      code: typeof res.meta?.errorCode === 'string' ? res.meta.errorCode : null,
      param: typeof res.meta?.errorParam === 'string' ? res.meta.errorParam : null,
    };
    const left = deadline - now();
    if (attempts === 1 && isRetryable(res.error) && left >= config.retryMinRemainingMs && !signal?.aborted) continue;
    return {ok: false, error: res.error, attempts, tokens, providerError, servedTier};
  }
}

/** 한 번 호출. 바깥에서도 시간 제한을 건다(어댑터가 timeoutMs를 지키지 않아도 멈춘다). */
async function callOnce(provider, req, outerSignal) {
  const ctrl = new AbortController();
  const onOuterAbort = () => ctrl.abort();
  outerSignal?.addEventListener?.('abort', onOuterAbort, {once: true});
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => { ctrl.abort(); resolve({ok: false, error: 'timeout', meta: {}}); }, req.timeoutMs);
  });
  const aborted = new Promise((resolve) => {
    if (outerSignal?.aborted) resolve({ok: false, error: 'aborted', meta: {}});
    outerSignal?.addEventListener?.('abort', () => resolve({ok: false, error: 'aborted', meta: {}}), {once: true});
  });
  try {
    const call = Promise.resolve()
      .then(() => provider.generateStructured({...req, signal: ctrl.signal}))
      .then((r) => (r && typeof r === 'object' ? r : {ok: false, error: 'server', meta: {}}))
      .catch(() => ({ok: false, error: 'server', meta: {}}));
    const res = await Promise.race([call, timeout, aborted]);
    if (res.ok === true && !('data' in res)) return {ok: false, error: 'bad_json', meta: res.meta ?? {}};
    return res;
  } finally {
    clearTimeout(timer);
    outerSignal?.removeEventListener?.('abort', onOuterAbort);
  }
}

function deadlineFrom(start, config, deadlineAt) {
  const budget = start + config.budgetMs;
  return Number.isFinite(deadlineAt) ? Math.min(deadlineAt, budget) : budget;
}

/**
 * 증상 후보 분류(설계 5절).
 * @param {{text:string, sex?:string|null, consent:object, signal?:AbortSignal, deadlineAt?:number, requestId?:string, reason?:string}} input
 * @param {{provider?:object, refData?:object, config?:object, log?:Function, now?:Function}} [deps]
 * @returns {Promise<{status:'confirm', followUp:object, meta:object} | {status:'fallback', reason:string, meta:object} | {status:'route', intent:string, meta:object}>}
 */
export async function classifySymptom(input = {}, deps = {}) {
  return classifySymptomInternal(input, deps, false);
}

export async function classifySymptomWithRisk(input = {}, deps = {}) {
  return classifySymptomInternal(input, deps, true);
}

// forceFull(11/18 절충 1): 고쳐 쓰기 후보 확인(SYM_REWRITE_CONFIRM)에서 '다른 증상이에요'를 고른 뒤라 고쳐 쓰기를 건너뛰고 전체 목록 호출만 한다.
async function classifySymptomInternal({text, riskText = null, sex = null, consent, signal, deadlineAt, requestId = null, reason = null, forceFull = false} = {}, deps = {}, includeRisk = false) {
  const d = resolveDeps(deps);
  const refData = d.refData ?? loadRefData();
  const start = d.now();
  const meta = {
    provider: d.provider.name,
    model: d.provider.model ?? null,
    serviceTier: d.provider.serviceTier ?? null, servedTier: null,
    promptId: includeRisk ? symptomRiskPrompt.id : symptomPrompt.id,
    schemaId: includeRisk ? d.config.versions.schemaSymptomRisk : d.config.versions.schemaSymptom,
    dataVersion: refData.dataVersion,
    candidateCount: 0,
    candidateMode: null,
    latencyMs: 0,
    attempts: 0,
    error: null,
    consentSource: null,
    modelWarning: d.config.modelWarning ?? null,
    tokens: emptyTokens(),
    providerError: null,
    // 11/18 절충 1: 어느 길로 끝났는지(원문 없음). full = 목록 전체 호출만 / rewrite_hit = 고쳐 쓰기 → 사전에서 찾음 /
    //   rewrite_route = 고쳐 쓰기에서 증상 아닌 의도 / rewrite_miss·rewrite_bad·rewrite_fail → 목록 전체 호출로 넘어감
    symptomPath: 'full',
  };
  let picks = [];
  let intent = null;
  let pickStatus = null;
  let dropped = null;
  let tokens = null;
  let riskSignal = 'none';
  let rewriteRisk = null; // 고쳐 쓰기 호출이 본 위험 신호(전체 목록 호출이 실패·none이어도 놓치지 않게)

  const finish = (result) => {
    meta.latencyMs = d.now() - start;
    const out = includeRisk ? {...result, riskSignal, meta} : {...result, meta};
    if (includeRisk && ['self_harm', 'threat', 'violence'].includes(riskSignal)) {
      safeLog(d.log, {kind: 'sensitive_referral'});
      return out;
    }
    safeLog(d.log, {
      event: 'llm.classify_symptom',
      requestId, reason,
      provider: meta.provider, model: meta.model, promptId: meta.promptId, schemaId: meta.schemaId,
      dataVersion: meta.dataVersion, candidateCount: meta.candidateCount, candidateMode: meta.candidateMode,
      picks: [...picks], pickStatus, intent, result: result.status,
      fallbackReason: result.status === 'fallback' ? result.reason : null,
      error: meta.error, latencyMs: meta.latencyMs, attempts: meta.attempts,
      dropped, consentSource: meta.consentSource, modelWarning: meta.modelWarning,
      inputTokens: tokens?.input ?? null, cachedInputTokens: tokens?.cachedInput ?? null,
      outputTokens: tokens?.output ?? null, reasoningTokens: tokens?.reasoning ?? null,
      providerError: meta.providerError,
      symptomPath: meta.symptomPath,
    });
    return out;
  };
  const fallback = (why, error = why) => { meta.error = error; return finish({status: 'fallback', reason: why}); };
  const addUsage = (res) => {
    meta.attempts += res.attempts ?? 0;
    for (const k of Object.keys(meta.tokens)) meta.tokens[k] += res.tokens?.[k] ?? 0;
    if (res.servedTier) meta.servedTier = res.servedTier;
    tokens = {...meta.tokens};
  };

  // 1. 동의(개발용 동의 포함)
  const c = resolveConsent(consent, d.provider.name, d.config);
  meta.consentSource = c.source;
  if (!hasExternalAiConsent(c.consent, d.provider.name)) return fallback('no_consent');
  if (signal?.aborted) return fallback('aborted');

  // 2. PII 가리기 + 500자
  const masked = maskPii(String(text ?? ''));
  const llmText = tailChars(masked.text.trim(), INPUT_MAX_CHARS);
  if (!llmText.trim()) return fallback('no_match', null);
  const riskLlmText = tailChars(maskPii(String(riskText ?? text ?? '')).text.trim(), INPUT_MAX_CHARS);

  // 2-1. 11/18 절충 1(LLM_SYMPTOM_MODE=rewrite): 목록 없이 표준 표현으로 고쳐 쓰기 → 사전 재검색.
  //   찾으면 여기서 끝(호출 1번, 입력 수백 토큰). 못 찾음·형식 오류·실패면 아래 전체 목록 호출로 넘어간다(원래 문장 그대로 → 정확도 최저선은 full과 같다).
  //   고쳐 쓰기 시간 제한은 짧게(rewriteTimeoutMs) 두어 전체 목록 호출에 쓸 시간을 남긴다. 인증·잔액 오류는 다음 호출도 같으므로 바로 멈춘다.
  //   위험 신호는 원래 문장(riskText)으로 본다. 고쳐 쓴 표현(terms)은 검색에만 쓰고 결과·로그에 남기지 않는다.
  if (d.config.symptomMode === 'rewrite' && !forceFull) {
    const rPrompt = includeRisk ? rewriteRiskPrompt : rewritePrompt;
    const rwReq = {
      system: rPrompt.system,
      user: rPrompt.buildUser({text: llmText, riskText: riskLlmText}),
      schema: rewriteSchema({risk: includeRisk}),
      schemaName: includeRisk ? REWRITE_RISK_SCHEMA_NAME : REWRITE_SCHEMA_NAME,
    };
    const rwConfig = {...d.config, timeoutMs: Math.min(d.config.rewriteTimeoutMs, d.config.timeoutMs)};
    const rwRes = await callProvider(d.provider, rwReq, {config: rwConfig, signal, deadline: deadlineFrom(start, d.config, deadlineAt), now: d.now});
    addUsage(rwRes);
    meta.providerError = rwRes.providerError ?? null;
    if (!rwRes.ok) {
      if (STOP_ERRORS.includes(rwRes.error) || rwRes.error === 'aborted') return fallback(rwRes.error);
      meta.symptomPath = 'rewrite_fail';
    } else {
      const rv = validateRewrite(rwRes.data, {risk: includeRisk});
      if (!rv.ok) {
        meta.symptomPath = 'rewrite_bad';
      } else {
        if (includeRisk) { rewriteRisk = rv.riskSignal; riskSignal = rv.riskSignal; meta.riskError = rv.riskError; }
        if (rv.intent !== 'symptom') {
          intent = rv.intent;
          meta.symptomPath = 'rewrite_route';
          return finish({status: 'route', intent: rv.intent});
        }
        let ids = [];
        try { ids = rv.terms.length ? matchSymptoms(rv.terms.join('\n'), refData, {sex}) : []; } catch { ids = []; }
        const followUp = ids.length ? buildRewriteConfirm(ids, refData) : null;
        if (followUp) {
          intent = 'symptom';
          pickStatus = 'matched';
          picks = ids;
          meta.symptomPath = 'rewrite_hit';
          return finish({status: 'confirm', followUp});
        }
        meta.symptomPath = 'rewrite_miss';
      }
    }
    if (signal?.aborted) return fallback('aborted');
  }

  // 3. 후보
  let mode = d.config.candidateMode;
  let candidates = buildCandidates(llmText, refData, {k: d.config.candidateK, mode, sex});
  if (candidates.length === 0 && mode !== 'all') {
    mode = 'all';
    candidates = buildCandidates(llmText, refData, {mode, sex});
  }
  meta.candidateMode = mode;
  meta.candidateCount = candidates.length;
  if (candidates.length === 0) return fallback('no_match', null);
  const candidateIds = candidates.map((c) => c.symptomId);

  // 4. 스키마·프롬프트
  const prompt = includeRisk ? symptomRiskPrompt : symptomPrompt;
  const schema = includeRisk ? symptomRiskSchema(candidateIds) : symptomPickSchema(candidateIds);
  const req = {
    system: prompt.system,
    user: prompt.buildUser({text: llmText, riskText: riskLlmText, candidatesText: formatCandidatesForPrompt(candidates, refData)}),
    schema,
    schemaName: meta.schemaId,
  };

  // 5. 호출 (rewrite 모드에서 넘어온 경우 토큰·시도 수는 더한다)
  const res = await callProvider(d.provider, req, {config: d.config, signal, deadline: deadlineFrom(start, d.config, deadlineAt), now: d.now});
  addUsage(res);
  meta.providerError = res.providerError ?? meta.providerError;
  if (!res.ok) return fallback(res.error); // rewriteRisk가 있으면 riskSignal에 이미 들어 있다

  // 6. 검사
  const v = includeRisk ? validateSymptomRisk(res.data, candidateIds, refData) : validateSymptomPick(res.data, candidateIds, refData);
  if (includeRisk) {
    // 11/18: 두 호출 중 하나라도 위험 신호를 냈으면 그것을 쓴다(전체 목록 호출 것이 우선)
    riskSignal = v.riskSignal !== 'none' ? v.riskSignal : (rewriteRisk ?? 'none');
    meta.riskError = v.riskError;
  }
  dropped = v.dropped;
  if (!v.ok) return fallback('bad_json');
  intent = v.intent;
  pickStatus = v.status;
  picks = v.picks;

  // 7. 결과
  if (v.intent !== 'symptom') return finish({status: 'route', intent: v.intent});
  if (v.status !== 'matched' || v.picks.length === 0) return fallback('no_match', null);
  const followUp = buildSymptomConfirm(v.picks, refData, 'ko');
  if (!followUp) return fallback('no_match', null);
  return finish({status: 'confirm', followUp});
}

/** 위험 신호만 받는 작은 호출. 실패·동의 없음·형식 위반은 signal:none이다. */
export async function detectRiskSignal({text, consent, signal, deadlineAt, requestId = null, reason = null} = {}, deps = {}) {
  const d = resolveDeps(deps);
  const start = d.now();
  const meta = {
    provider: d.provider.name, model: d.provider.model ?? null, serviceTier: d.provider.serviceTier ?? null, servedTier: null, promptId: riskPrompt.id,
    schemaId: d.config.versions.schemaRisk, latencyMs: 0, attempts: 0, error: null,
    consentSource: null, modelWarning: d.config.modelWarning ?? null, tokens: emptyTokens(), providerError: null,
  };
  const finish = (riskSignal) => {
    meta.latencyMs = d.now() - start;
    if (['self_harm', 'threat', 'violence'].includes(riskSignal)) {
      safeLog(d.log, {kind: 'sensitive_referral'});
      return {riskSignal, meta};
    }
    safeLog(d.log, {event: 'llm.detect_risk', requestId, reason, provider: meta.provider, model: meta.model,
      promptId: meta.promptId, schemaId: meta.schemaId, signal: riskSignal, error: meta.error,
      latencyMs: meta.latencyMs, attempts: meta.attempts, consentSource: meta.consentSource});
    return {riskSignal, meta};
  };
  const c = resolveConsent(consent, d.provider.name, d.config);
  meta.consentSource = c.source;
  if (!hasExternalAiConsent(c.consent, d.provider.name)) { meta.error = 'no_consent'; return finish('none'); }
  if (signal?.aborted) { meta.error = 'aborted'; return finish('none'); }
  const llmText = tailChars(maskPii(String(text ?? '')).text.trim(), INPUT_MAX_CHARS);
  if (!llmText) { meta.error = 'no_match'; return finish('none'); }
  const res = await callProvider(d.provider, {
    system: riskPrompt.system, user: riskPrompt.buildUser({text: llmText}),
    schema: riskSignalSchema(), schemaName: meta.schemaId, maxOutputTokens: RISK_MAX_OUTPUT_TOKENS,
  }, {config: d.config, signal, deadline: deadlineFrom(start, d.config, deadlineAt), now: d.now});
  meta.attempts = res.attempts;
  meta.tokens = {...res.tokens};
  if (res.servedTier) meta.servedTier = res.servedTier;
  meta.providerError = res.providerError ?? null;
  if (!res.ok) { meta.error = res.error; return finish('none'); }
  const v = validateRiskSignal(res.data);
  if (!v.ok) meta.error = v.error;
  return finish(v.signal);
}

/**
 * 건강정보(profileUpdates) 추출(설계 6절). 오류·시간 초과면 items:[].
 * @param {{messages:string[], consent:object, signal?:AbortSignal, deadlineAt?:number, requestId?:string, reason?:string}} input
 * @returns {Promise<{items:Array<object>, meta:object}>}
 */
export async function extractProfileUpdates({messages, consent, signal, deadlineAt, requestId = null, reason = null} = {}, deps = {}) {
  const d = resolveDeps(deps);
  const start = d.now();
  const list = Array.isArray(messages) ? messages : [];
  const meta = {
    provider: d.provider.name,
    model: d.provider.model ?? null,
    serviceTier: d.provider.serviceTier ?? null, servedTier: null,
    promptId: profilePrompt.id,
    schemaId: d.config.versions.schemaProfile,
    dataVersion: d.refData?.dataVersion ?? null,
    candidateCount: null,
    candidateMode: null,
    latencyMs: 0,
    attempts: 0,
    error: null,
    consentSource: null,
    modelWarning: d.config.modelWarning ?? null,
    tokens: emptyTokens(),
    providerError: null,
  };
  let dropped = null;
  let sentCount = 0;
  let tokens = null;

  const finish = (items) => {
    meta.latencyMs = d.now() - start;
    safeLog(d.log, {
      event: 'llm.extract_profile',
      requestId, reason,
      provider: meta.provider, model: meta.model, promptId: meta.promptId, schemaId: meta.schemaId,
      messageCount: list.length, sentMessageCount: sentCount,
      itemCount: items.length, fields: items.map((i) => i.field),
      dropped, error: meta.error, latencyMs: meta.latencyMs, attempts: meta.attempts,
      consentSource: meta.consentSource, modelWarning: meta.modelWarning,
      inputTokens: tokens?.input ?? null, cachedInputTokens: tokens?.cachedInput ?? null,
      outputTokens: tokens?.output ?? null, reasoningTokens: tokens?.reasoning ?? null,
      providerError: meta.providerError,
    });
    return {items, meta};
  };

  // 외부 AI 동의 + 건강정보 처리 동의(개발용 동의 포함)
  const c = resolveConsent(consent, d.provider.name, d.config);
  meta.consentSource = c.source;
  if (!hasExternalAiConsent(c.consent, d.provider.name) || c.consent.healthInfo !== true) {
    meta.error = 'no_consent';
    return finish([]);
  }
  if (signal?.aborted) { meta.error = 'aborted'; return finish([]); }

  // 신호어가 있는 메시지만 보낸다(번호는 원래 순서 유지). 없으면 호출 0회.
  const selected = [];
  list.forEach((m, index) => {
    if (typeof m === 'string' && hasProfileSignal(m)) {
      const t = tailChars(maskPii(m).text, INPUT_MAX_CHARS);
      if (t.trim()) selected.push({index, text: t});
    }
  });
  sentCount = selected.length;
  if (selected.length === 0) return finish([]);

  const req = {
    system: profilePrompt.system,
    user: profilePrompt.buildUser({messages: selected}),
    schema: profileExtractSchema(),
    schemaName: meta.schemaId,
  };
  const res = await callProvider(d.provider, req, {config: d.config, signal, deadline: deadlineFrom(start, d.config, deadlineAt), now: d.now});
  meta.attempts = res.attempts;
  tokens = res.tokens;
  meta.tokens = {...res.tokens};
  if (res.servedTier) meta.servedTier = res.servedTier;
  meta.providerError = res.providerError ?? null;
  if (!res.ok) { meta.error = res.error; return finish([]); }

  // 보내지 않은 메시지를 가리키는 항목은 범위 밖으로 처리해 버린다
  const sentIdx = new Set(selected.map((s) => s.index));
  const visible = list.map((m, i) => (sentIdx.has(i) ? m : null));
  const v = validateProfileItems(res.data, visible);
  dropped = v.dropped;
  if (!v.ok) { meta.error = 'bad_json'; return finish([]); }
  return finish(v.items);
}

function safeLog(log, event) {
  try { log(event); } catch { /* 로그 실패가 응답을 막지 않는다 */ }
}

/** 예열에 쓰는 고정 문장. 사용자 데이터가 아니다. */
export const WARMUP_TEXT = '머리가 아파요';
/** 예열 대상 성별. 성별에 따라 후보 목록(=응답 형식의 증상 ID 목록과 프롬프트 앞부분)이 달라진다. */
export const WARMUP_SEXES = Object.freeze([null, 'female', 'male']);
const WARMUP_TIMEOUT_MS = 20000;

/**
 * 11/18: 증상+위험 결합 호출 예열. 서버가 뜰 때 한 번 부른다(사용자 요청을 기다리게 하지 않는다).
 * 이유: 처음 쓰는 응답 형식(JSON 스키마)과 프롬프트 앞부분은 업체 쪽 준비·캐시가 없어 첫 요청이 느리다
 *   (11/18 실측: 첫 요청 3.8~4.0초, 이후 p50 1.3초). 실서비스와 같은 후보 목록으로 성별 3가지를 한 번씩 보낸다.
 * 고정 문장(WARMUP_TEXT)만 보내므로 사용자 동의가 필요한 데이터가 없다 → 이 호출 전용 consent(version 'warmup')를 쓴다.
 * mock이면 부르지 않는다. 예외를 던지지 않는다. 결과에는 성공 여부·지연·오류 코드만 있다.
 * @param {{refData?:object, config?:object, provider?:object, log?:Function, sexes?:Array}} [deps]
 * @returns {Promise<{skipped:string|null, results:Array<{sex:string|null, ok:boolean, latencyMs:number, error:string|null}>}>}
 */
export async function warmSymptomRisk({refData, config: baseConfig, provider, log = noop, sexes = WARMUP_SEXES} = {}) {
  try {
    const base = baseConfig ?? getConfig();
    // 전체 목록 호출은 항상 예열한다(rewrite 모드에서도 못 찾으면 쓰인다). 11/18 절충 1: rewrite 모드면 고쳐 쓰기 호출도 한 번
    //   (고쳐 쓰기 응답 형식은 성별과 무관. 첫 요청이 3초 제한을 넘어 실패하는 것을 실측함)
    const fullConfig = {...base, symptomMode: 'full', timeoutMs: WARMUP_TIMEOUT_MS, budgetMs: WARMUP_TIMEOUT_MS};
    const p = provider ?? getProvider({config: fullConfig});
    if (p.name === 'mock') return {skipped: 'mock', results: []};
    const consent = {granted: true, provider: p.name, version: 'warmup', healthInfo: false};
    const jobs = sexes.map((sex) => ({sex, mode: 'full'}));
    if (base.symptomMode === 'rewrite') jobs.push({sex: null, mode: 'rewrite'});
    const results = await Promise.all(jobs.map(async ({sex, mode}) => {
      try {
        const config = mode === 'rewrite'
          ? {...fullConfig, symptomMode: 'rewrite', rewriteTimeoutMs: WARMUP_TIMEOUT_MS}
          : fullConfig;
        const r = await classifySymptomWithRisk({text: WARMUP_TEXT, riskText: WARMUP_TEXT, sex, consent, requestId: null, reason: 'warmup'},
          {provider: p, refData, config, log});
        return {sex, mode, ok: !r.meta.error, latencyMs: r.meta.latencyMs, error: r.meta.error ?? null};
      } catch {
        return {sex, mode, ok: false, latencyMs: 0, error: 'internal'};
      }
    }));
    return {skipped: null, results};
  } catch {
    return {skipped: 'error', results: []};
  }
}
