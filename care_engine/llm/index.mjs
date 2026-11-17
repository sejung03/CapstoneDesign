// LLM 모듈 공개 함수: classifySymptom(), extractProfileUpdates().
// 원문·quote·value·업체 응답 원문은 로그(log)와 meta에 넣지 않는다(설계 7절).
import {getConfig} from './config.mjs';
import {getProvider} from './provider.mjs';
import {loadRefData} from './ref-data.mjs';
import {maskPii} from './pii.mjs';
import {tailChars, INPUT_MAX_CHARS} from './normalize.mjs';
import {buildCandidates, formatCandidatesForPrompt} from './candidates.mjs';
import {symptomPickSchema, symptomRiskSchema, riskSignalSchema, profileExtractSchema} from './schemas.mjs';
import {validateSymptomPick, validateSymptomRisk, validateRiskSignal, validateProfileItems} from './validate.mjs';
import {buildSymptomConfirm} from './confirm-question.mjs';
import {hasProfileSignal} from './profile-trigger.mjs';
import {isRetryable} from './errors.mjs';
import symptomPrompt from './prompts/symptom_v1.mjs';
import profilePrompt from './prompts/profile_v1.mjs';
import riskPrompt from './prompts/risk_v1.mjs';
import symptomRiskPrompt from './prompts/symptom_risk_v1.mjs';

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
  for (;;) {
    if (signal?.aborted) return {ok: false, error: 'aborted', attempts, tokens, providerError};
    const remaining = deadline - now();
    if (remaining <= 0) return {ok: false, error: 'timeout', attempts, tokens, providerError};
    const timeoutMs = Math.min(config.timeoutMs, remaining);
    attempts += 1;
    const res = await callOnce(provider, {...req, timeoutMs}, signal);
    if (Number.isFinite(res.meta?.inputTokens)) tokens.input += res.meta.inputTokens;
    if (Number.isFinite(res.meta?.cachedInputTokens)) tokens.cachedInput += res.meta.cachedInputTokens;
    if (Number.isFinite(res.meta?.outputTokens)) tokens.output += res.meta.outputTokens;
    if (Number.isFinite(res.meta?.reasoningTokens)) tokens.reasoning += res.meta.reasoningTokens;
    if (res.ok) return {ok: true, data: res.data, attempts, tokens, providerError: null};
    // 어댑터가 이미 형식 검사한 짧은 code·param·HTTP 상태만(본문 없음)
    providerError = {
      httpStatus: Number.isFinite(res.meta?.httpStatus) ? res.meta.httpStatus : null,
      code: typeof res.meta?.errorCode === 'string' ? res.meta.errorCode : null,
      param: typeof res.meta?.errorParam === 'string' ? res.meta.errorParam : null,
    };
    const left = deadline - now();
    if (attempts === 1 && isRetryable(res.error) && left >= config.retryMinRemainingMs && !signal?.aborted) continue;
    return {ok: false, error: res.error, attempts, tokens, providerError};
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

async function classifySymptomInternal({text, riskText = null, sex = null, consent, signal, deadlineAt, requestId = null, reason = null} = {}, deps = {}, includeRisk = false) {
  const d = resolveDeps(deps);
  const refData = d.refData ?? loadRefData();
  const start = d.now();
  const meta = {
    provider: d.provider.name,
    model: d.provider.model ?? null,
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
  };
  let picks = [];
  let intent = null;
  let pickStatus = null;
  let dropped = null;
  let tokens = null;
  let riskSignal = 'none';

  const finish = (result) => {
    meta.latencyMs = d.now() - start;
    const out = includeRisk ? {...result, riskSignal, meta} : {...result, meta};
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
    });
    return out;
  };
  const fallback = (why, error = why) => { meta.error = error; return finish({status: 'fallback', reason: why}); };

  // 1. 동의(개발용 동의 포함)
  const c = resolveConsent(consent, d.provider.name, d.config);
  meta.consentSource = c.source;
  if (!hasExternalAiConsent(c.consent, d.provider.name)) return fallback('no_consent');
  if (signal?.aborted) return fallback('aborted');

  // 2. PII 가리기 + 500자
  const masked = maskPii(String(text ?? ''));
  const llmText = tailChars(masked.text.trim(), INPUT_MAX_CHARS);
  if (!llmText.trim()) return fallback('no_match', null);

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
    user: prompt.buildUser({text: llmText, riskText: tailChars(maskPii(String(riskText ?? text ?? '')).text.trim(), INPUT_MAX_CHARS), candidatesText: formatCandidatesForPrompt(candidates, refData)}),
    schema,
    schemaName: meta.schemaId,
  };

  // 5. 호출
  const res = await callProvider(d.provider, req, {config: d.config, signal, deadline: deadlineFrom(start, d.config, deadlineAt), now: d.now});
  meta.attempts = res.attempts;
  tokens = res.tokens;
  meta.tokens = {...res.tokens};
  meta.providerError = res.providerError ?? null;
  if (!res.ok) return fallback(res.error);

  // 6. 검사
  const v = includeRisk ? validateSymptomRisk(res.data, candidateIds, refData) : validateSymptomPick(res.data, candidateIds, refData);
  if (includeRisk) {
    riskSignal = v.riskSignal;
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
    provider: d.provider.name, model: d.provider.model ?? null, promptId: riskPrompt.id,
    schemaId: d.config.versions.schemaRisk, latencyMs: 0, attempts: 0, error: null,
    consentSource: null, modelWarning: d.config.modelWarning ?? null, tokens: emptyTokens(), providerError: null,
  };
  const finish = (riskSignal) => {
    meta.latencyMs = d.now() - start;
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
    schema: riskSignalSchema(), schemaName: meta.schemaId,
  }, {config: d.config, signal, deadline: deadlineFrom(start, d.config, deadlineAt), now: d.now});
  meta.attempts = res.attempts;
  meta.tokens = {...res.tokens};
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
