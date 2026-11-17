// 설정. 설계 8절 값들 + L4-MVP(11/15). 환경변수가 없거나 잘못되면 기본값.
// API 키(OPENAI_API_KEY)는 여기서 읽지 않는다. 어댑터(providers/openai.mjs)가 process.env에서 직접 읽는다.
import {SYMPTOM_SCHEMA_NAME, PROFILE_SCHEMA_NAME, RISK_SCHEMA_NAME, SYMPTOM_RISK_SCHEMA_NAME} from './schemas.mjs';

/**
 * 건강정보 추출 신호어 패턴(설계 6-1, L4-MVP M3에서 단어 → 정규식으로 좁힘).
 * 원문(NFKC만, 공백 유지)에 하나라도 맞으면 추출 호출. 목적: "안녕하세요"·"약국"·"세상" 같은 문장이 외부로 나가지 않게.
 */
export const PROFILE_SIGNAL_PATTERNS = Object.freeze({
  age: Object.freeze([/\d{1,3}\s*(살|세)/u, /만\s*\d{1,3}\s*세/u, /나이/u]),
  medication: Object.freeze([/약\s*(을|은|를)?\s*(먹|복용|처방)/u, /복용/u, /먹고\s*있/u, /\S+약\s*(먹|복용)/u]),
  allergy: Object.freeze([/알레르기/u, /알러지/u]),
  history: Object.freeze([/앓/u, /진단\s*(받|을)/u, /수술\s*(받|했)/u, /병력/u, /기저\s*질환/u]),
});

export const MAX_PICKS = 10;
/** OpenAI max_output_tokens(지시서 M1). 증상 picks 최대 10개·건강정보 4개에 충분하다. */
export const OPENAI_MAX_OUTPUT_TOKENS = 400;
/** risk_signal 한 필드 전용 호출은 출력 상한을 작게 둔다. */
export const RISK_MAX_OUTPUT_TOKENS = 40;
export const PROFILE_MAX_ITEMS = 4;
export const PROFILE_VALUE_MAX = 500;
export const PROFILE_QUOTE_MAX = 500;

export const VERSIONS = Object.freeze({
  promptSymptom: 'symptom_v1',
  promptProfile: 'profile_v1',
  schemaSymptom: SYMPTOM_SCHEMA_NAME,
  schemaProfile: PROFILE_SCHEMA_NAME,
  promptRisk: 'risk_v2',
  promptSymptomRisk: 'symptom_risk_v2',
  schemaRisk: RISK_SCHEMA_NAME,
  schemaSymptomRisk: SYMPTOM_RISK_SCHEMA_NAME,
});

export const DEFAULTS = Object.freeze({
  provider: 'mock',
  model: null,            // mock이면 'mock-v0'. 실제 업체는 버전명 필수(별칭 금지)
  timeoutMs: 4000,        // LLM 1회 제한
  budgetMs: 7000,         // 서버 전체 예산(프론트 8초 제한 안쪽)
  retryMinRemainingMs: 3000, // 남은 시간이 이 이상일 때만 재시도
  candidateMode: 'all',    // L4-MVP 11/15: retrieve가 바꿔 말한 표현을 놓쳐 all로. retrieve는 LLM_CANDIDATE_MODE로
  candidateK: 40,
  maxConcurrency: 2,
  openaiModel: 'gpt-5.4-mini-2026-03-17', // 날짜 고정 스냅샷(L4-MVP 팀 결정)
  reasoningEffort: 'none',
  temperature: null,      // null = 요청에 넣지 않음
  devConsent: false,      // LLM_DEV_CONSENT=true일 때만 true. 운영 전 반드시 끈다
  evalBudgetUsd: 2,       // 평가 1회 비용 상한
});

/**
 * 모델 가격(USD / 100만 토큰). 모르는 모델은 비용을 null로 둔다(추정하지 않음).
 * 출처: https://developers.openai.com/api/docs/pricing (Standard, 2026-11-15 확인)
 */
export const MODEL_PRICES_USD_PER_1M = Object.freeze({
  'gpt-5.4-mini-2026-03-17': Object.freeze({input: 0.75, cachedInput: 0.075, output: 4.50}),
});

const PROVIDERS = ['mock', 'gemini', 'openai'];
const MODES = ['retrieve', 'all'];
export const REASONING_EFFORTS = Object.freeze(['none', 'low', 'medium', 'high']);
/** 날짜 고정 스냅샷 이름(끝이 -YYYY-MM-DD). 아니면 별칭으로 보고 경고만 남긴다. */
const SNAPSHOT_RE = /-\d{4}-\d{2}-\d{2}$/;

function nonNegNumber(v, def) {
  if (v === undefined || v === null || String(v).trim() === '') return def;
  const s = String(v).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return def;
  return Number(s);
}

function posInt(v, def) {
  if (v === undefined || v === null || String(v).trim() === '') return def;
  const s = String(v).trim();
  if (!/^\d+$/.test(s)) return def;
  const n = Number(s);
  return n > 0 ? n : def;
}

/** @param {Record<string,string|undefined>} [env] */
export function getConfig(env = process.env) {
  const rawProvider = (env.LLM_PROVIDER ?? '').trim().toLowerCase();
  // 모르는 업체 이름은 mock으로 바꾸지 않고 그대로 둔다 → getProvider가 오류를 낸다
  const provider = rawProvider === '' ? DEFAULTS.provider : rawProvider;
  const model = (env.LLM_MODEL ?? '').trim()
    || (provider === 'mock' ? 'mock-v0' : provider === 'openai' ? DEFAULTS.openaiModel : DEFAULTS.model);
  const mode = (env.LLM_CANDIDATE_MODE ?? '').trim().toLowerCase();
  const effort = (env.LLM_REASONING_EFFORT ?? '').trim().toLowerCase();
  const temperatureRaw = (env.LLM_TEMPERATURE ?? '').trim();
  const temperature = temperatureRaw === '' ? null : nonNegNumber(temperatureRaw, null);
  return Object.freeze({
    provider,
    providerKnown: PROVIDERS.includes(provider),
    model,
    // 실제 업체인데 날짜 없는 별칭이면 경고(막지는 않는다)
    modelWarning: provider !== 'mock' && model && !SNAPSHOT_RE.test(model) ? 'model_alias' : null,
    reasoningEffort: REASONING_EFFORTS.includes(effort) ? effort : DEFAULTS.reasoningEffort,
    temperature: temperature !== null && temperature <= 2 ? temperature : null,
    devConsent: (env.LLM_DEV_CONSENT ?? '').trim() === 'true',
    evalBudgetUsd: nonNegNumber(env.LLM_EVAL_BUDGET_USD, DEFAULTS.evalBudgetUsd),
    timeoutMs: posInt(env.LLM_TIMEOUT_MS, DEFAULTS.timeoutMs),
    budgetMs: posInt(env.LLM_BUDGET_MS, DEFAULTS.budgetMs),
    retryMinRemainingMs: DEFAULTS.retryMinRemainingMs,
    candidateMode: MODES.includes(mode) ? mode : DEFAULTS.candidateMode,
    candidateK: posInt(env.LLM_CANDIDATE_K, DEFAULTS.candidateK),
    maxConcurrency: posInt(env.LLM_MAX_CONCURRENCY, DEFAULTS.maxConcurrency),
    versions: VERSIONS,
  });
}
