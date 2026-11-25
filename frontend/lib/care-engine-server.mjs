// 문진 엔진(care_engine runCare) 서버 연결. 브라우저는 /api/care로 요청하고, 엔진·OpenAI 키는 서버에만 있다.
// 엔진은 자기 파일 위치 기준으로 시드 CSV·규칙 JSON을 읽으므로 번들하지 않고 Node가 원래 경로에서 불러온다.
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseEnv} from 'node:util';
import {CARE_CONSENT_VERSION} from '../care-adapter.mjs';
import {rankFacilities, RankingInputError} from './care-ranking.mjs';
import {createSupabaseRefStore} from './care-data-supabase.mjs';

const MAX_BODY = 64 * 1024;
const SERVER_BUDGET_MS = 7000; // 프론트 8초 제한 안쪽(엔진 README)
// 엔진 LLM 설정 중 개발 환경에서 care_engine/.env로부터 채워 넣는 키(이미 있는 값은 덮지 않음)
const ENGINE_ENV_KEYS = ['OPENAI_API_KEY', 'LLM_PROVIDER', 'LLM_MODEL', 'LLM_DEV_CONSENT', 'LLM_REASONING_EFFORT',
  'LLM_TEMPERATURE', 'LLM_CANDIDATE_MODE', 'LLM_CANDIDATE_K', 'LLM_TIMEOUT_MS', 'LLM_BUDGET_MS',
  'LLM_REWRITE_TIMEOUT_MS', 'LLM_SERVICE_TIER']; // 11/24 추가
const ERROR_STATUS = {unsupported_reason: 400, aborted: 499, data: 503, contract: 500, internal: 500};

export function engineDir(env = process.env) {
  return path.resolve(env.CARE_ENGINE_DIR || path.join(process.cwd(), '..', 'care_engine'));
}

/** 개발 환경에서만 care_engine/.env의 LLM 키를 서버 프로세스에 채운다. 값은 출력하지 않는다. */
export function loadEngineEnv({env = process.env, dir = engineDir(env), read = readFileSync, exists = existsSync} = {}) {
  if (env.NODE_ENV !== 'development') return [];
  const file = path.join(dir, '.env');
  if (!exists(file)) return [];
  const parsed = parseEnv(read(file, 'utf8'));
  const added = [];
  for (const key of ENGINE_ENV_KEYS) {
    if (env[key] === undefined && typeof parsed[key] === 'string') { env[key] = parsed[key]; added.push(key); }
  }
  return added;
}

let enginePromise = null;
/** @returns {Promise<{runCare:Function, loadIntakeDataFromRows:Function}>} */
export function loadEngine(env = process.env) {
  if (!enginePromise) {
    loadEngineEnv({env});
    const dir = engineDir(env);
    const load = (file) => import(/* webpackIgnore: true */ /* turbopackIgnore: true */ pathToFileURL(path.join(dir, 'engine', file)).href);
    enginePromise = Promise.all([load('index.mjs'), load('intake-data.mjs')])
      .then(([index, data]) => ({runCare: index.runCare, warmLlm: index.warmLlm, loadIntakeDataFromRows: data.loadIntakeDataFromRows}))
      .catch((e) => { enginePromise = null; throw e; });
  }
  return enginePromise;
}

/**
 * 외부 AI 동의. 브라우저는 처리 안내(careHealthNotice)를 확인한 뒤에만 요청하고, 그 버전을 payload.consent로 보낸다.
 * 버전이 지금 안내와 같을 때만 엔진 consent를 만든다. 그 밖에는 {granted:false}를 넘겨 개발용 동의(LLM_DEV_CONSENT)도 쓰지 않는다.
 */
export function engineConsent(payloadConsent, env = process.env) {
  const provider = String(env.LLM_PROVIDER ?? '').trim().toLowerCase() || 'mock';
  if (payloadConsent && payloadConsent.granted === true && payloadConsent.version === CARE_CONSENT_VERSION) {
    return {granted: true, provider, version: CARE_CONSENT_VERSION, healthInfo: true};
  }
  return {granted: false};
}

/** Supabase가 설정되어 있으면 ref 스키마에서 엔진 데이터를 읽는다(검사 통과 시에만, 실패하면 시드 CSV). */
export function createRefStore({supabaseConfig, loadEngine: load = loadEngine, log = (msg) => console.warn(msg)} = {}) {
  if (!supabaseConfig) return Object.assign(async () => null, {warm: async () => {}});
  let builder = null;
  const store = createSupabaseRefStore({
    config: supabaseConfig,
    buildData: (tables) => { if (!builder) throw new Error('engine_not_loaded'); return builder(tables); },
    onError: (e) => log(`[care] Supabase 데이터 대신 시드 CSV 사용: ${e?.message ?? e}`),
  });
  const getData = async () => {
    try { builder ??= (await load()).loadIntakeDataFromRows; } catch { return null; }
    return store();
  };
  /** 서버가 뜰 때 한 번 불러 첫 사용자 요청 전에 읽기를 시작한다. */
  getData.warm = () => getData().then(() => store.ready()).catch(() => {});
  return getData;
}

/**
 * 11/18: 서버 시작 시 LLM 예열(instrumentation.js에서 기다리지 않고 부른다). 처음 쓰는 응답 형식은 업체 쪽 준비 때문에
 * 첫 요청이 느리므로(실측 3.8~4초) 사용자 요청 전에 고정 문장으로 한 번씩 보낸다. 엔진 warmLlm이 mock이면 건너뛴다.
 * 사용자 요청과 같은 데이터(refStore: Supabase 또는 시드 CSV)의 후보 목록을 쓴다. 예외를 던지지 않고 개수·지연만 로그에 남긴다.
 */
export async function warmCareLlm({loadEngine: load = loadEngine, refStore = async () => null, log = (msg) => console.info(msg)} = {}) {
  try {
    const engine = await load();
    if (typeof engine.warmLlm !== 'function') return null;
    let data = null;
    try { data = await refStore(); } catch { data = null; }
    const r = await engine.warmLlm(data ? {refStore: data} : {});
    if (r && !r.skipped && Array.isArray(r.results)) {
      const ok = r.results.filter((x) => x.ok).length;
      const errors = [...new Set(r.results.map((x) => x.error).filter(Boolean))];
      log(`[care] LLM 예열 ${ok}/${r.results.length} (${r.results.map((x) => x.latencyMs).join('/')}ms)${errors.length ? ` 오류 ${errors.join(',')}` : ''}`);
    }
    return r;
  } catch { return null; }
}

/**
 * POST /api/care 처리기. 응답 본문은 엔진의 response(프론트 계약)만이며 trace·원문은 내보내지 않는다.
 * @param {{loadEngine?:Function, sameOrigin:(request:Request)=>boolean, refStore?:()=>Promise<object|null>, env?:object,
 *          now?:()=>number, newId?:()=>string}} deps
 */
export function createCareHandler({loadEngine: load = loadEngine, sameOrigin, refStore = async () => null, env = process.env,
  now = Date.now, newId = () => crypto.randomUUID(), frequentCounts = async () => null}) {
  const headers = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'};
  const reply = (data, status = 200) => Response.json(data, {status, headers});
  return async (request) => {
    if (request.method !== 'POST') return new Response(null, {status: 405, headers: {...headers, Allow: 'POST'}});
    if (!sameOrigin(request)) return reply({error: 'invalid_origin'}, 403);
    if (!request.headers.get('content-type')?.startsWith('application/json')) return reply({error: 'content_type'}, 415);
    if (Number(request.headers.get('content-length')) > MAX_BODY) return reply({error: 'body_too_large'}, 413);
    let payload;
    try {
      const text = await request.text();
      if (Buffer.byteLength(text) > MAX_BODY) return reply({error: 'body_too_large'}, 413);
      payload = JSON.parse(text);
    } catch { return reply({error: 'invalid_json'}, 400); }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return reply({error: 'invalid_payload'}, 400);
    // 추천 순위는 엔진·LLM을 부르지 않는다(대화 내용을 쓰지 않음)
    if (payload.reason === 'recommendations') {
      // 로그인 사용자의 길찾기·전화번호 복사 횟수(서버 세션으로만 읽음). 못 읽으면 횟수 없이 순위를 낸다.
      let counts = null;
      try { counts = await frequentCounts(request); } catch { counts = null; }
      try { return reply(rankFacilities(payload, {frequentCounts: counts})); } catch (e) { return reply({error: e instanceof RankingInputError ? 'invalid_candidates' : 'internal'}, e instanceof RankingInputError ? 400 : 500); }
    }
    let runCare;
    try { ({runCare} = await load()); } catch { return reply({error: 'engine_unavailable'}, 503); }
    const {consent: payloadConsent, ...enginePayload} = payload;
    let data = null;
    try { data = await refStore(); } catch { data = null; }
    const out = await runCare(enginePayload,
      {signal: request.signal, deadlineAt: now() + SERVER_BUDGET_MS, requestId: newId(), consent: engineConsent(payloadConsent, env)},
      data ? {refStore: data} : {});
    if (out?.error || !out?.response) return reply({error: out?.error || 'internal'}, ERROR_STATUS[out?.error] ?? 500);
    return reply(out.response);
  };
}
