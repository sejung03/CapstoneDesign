// 설정. 설계 8절 값들. 환경변수가 없거나 잘못되면 기본값.
// API 키 관련 변수(GEMINI_API_KEY, OPENAI_API_KEY)는 이번 범위 밖이라 읽지 않는다.
import {SYMPTOM_SCHEMA_NAME, PROFILE_SCHEMA_NAME} from './schemas.mjs';

/**
 * 건강정보 추출 신호어(설계 6-1). 메시지(normalizeTerm 후)에 하나라도 있으면 추출 호출.
 * 설계 목록 그대로이며 "등"으로 열린 부분은 넣지 않았다(팀 검토 대상, 설계 11-4).
 */
export const PROFILE_SIGNAL_WORDS = Object.freeze([
  '살', '세', '나이', '약', '복용', '먹고 있', '알레르기', '앓', '진단', '수술', '병력',
]);

export const MAX_PICKS = 10;
export const PROFILE_MAX_ITEMS = 4;
export const PROFILE_VALUE_MAX = 500;
export const PROFILE_QUOTE_MAX = 500;

export const VERSIONS = Object.freeze({
  promptSymptom: 'symptom_v1',
  promptProfile: 'profile_v1',
  schemaSymptom: SYMPTOM_SCHEMA_NAME,
  schemaProfile: PROFILE_SCHEMA_NAME,
});

export const DEFAULTS = Object.freeze({
  provider: 'mock',
  model: null,            // mock이면 'mock-v0'. 실제 업체는 버전명 필수(별칭 금지)
  timeoutMs: 4000,        // LLM 1회 제한
  budgetMs: 7000,         // 서버 전체 예산(프론트 8초 제한 안쪽)
  retryMinRemainingMs: 3000, // 남은 시간이 이 이상일 때만 재시도
  candidateMode: 'retrieve',
  candidateK: 40,
  maxConcurrency: 2,
});

const PROVIDERS = ['mock', 'gemini', 'openai'];
const MODES = ['retrieve', 'all'];

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
  const model = (env.LLM_MODEL ?? '').trim() || (provider === 'mock' ? 'mock-v0' : DEFAULTS.model);
  const mode = (env.LLM_CANDIDATE_MODE ?? '').trim().toLowerCase();
  return Object.freeze({
    provider,
    providerKnown: PROVIDERS.includes(provider),
    model,
    timeoutMs: posInt(env.LLM_TIMEOUT_MS, DEFAULTS.timeoutMs),
    budgetMs: posInt(env.LLM_BUDGET_MS, DEFAULTS.budgetMs),
    retryMinRemainingMs: DEFAULTS.retryMinRemainingMs,
    candidateMode: MODES.includes(mode) ? mode : DEFAULTS.candidateMode,
    candidateK: posInt(env.LLM_CANDIDATE_K, DEFAULTS.candidateK),
    maxConcurrency: posInt(env.LLM_MAX_CONCURRENCY, DEFAULTS.maxConcurrency),
    versions: VERSIONS,
  });
}
