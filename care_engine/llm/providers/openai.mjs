// OpenAI 어댑터 (Responses API). L4-MVP M1.
// 문서(2026-11-15 확인): https://developers.openai.com/api/reference/resources/responses/methods/create
//                       https://developers.openai.com/api/docs/guides/structured-outputs
//
// 원칙
// - 예외를 밖으로 던지지 않는다. 모든 실패는 {ok:false, error}로 돌려준다(→ fallback).
// - 요청 본문·응답 원문·오류 본문·키를 로그나 meta에 남기지 않는다. 오류는 code 문자열만(형식 검사 후).
// - API 키는 서버 환경변수(OPENAI_API_KEY)에서만 읽는다. 키가 없으면 호출하지 않고 auth.
// - store:false (Responses API는 기본으로 응답을 저장한다).

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const SAFE_CODE = /^[A-Za-z0-9_.-]{1,64}$/;

/** 오류 code·param 같은 짧은 식별자만 남긴다. 그 밖의 문자열은 버린다. */
function safeCode(v) {
  return typeof v === 'string' && SAFE_CODE.test(v) ? v : null;
}

const num = (v) => (Number.isFinite(v) ? v : null);

/** HTTP 상태 + 오류 code → error 값(지시서 M1 표). */
export function mapHttpError(status, code) {
  if (status === 429) return code === 'insufficient_quota' ? 'quota' : 'rate_limit';
  if (status === 401 || status === 403) return 'auth';
  if (status === 400 || status === 404 || status === 422) return 'bad_request';
  if (status >= 500) return 'server';
  return 'bad_request';
}

/** 응답 JSON에서 출력 텍스트와 refusal 여부. output_text(SDK 편의 필드)가 있으면 그것을 쓴다. */
export function readOutput(json) {
  let refusal = false;
  const parts = [];
  for (const item of Array.isArray(json?.output) ? json.output : []) {
    for (const c of Array.isArray(item?.content) ? item.content : []) {
      if (c?.type === 'refusal') refusal = true;
      else if (c?.type === 'output_text' && typeof c.text === 'string') parts.push(c.text);
    }
  }
  const text = typeof json?.output_text === 'string' ? json.output_text : parts.join('');
  return {text, refusal};
}

/**
 * @param {{model?:string|null, apiKey?:string, fetchImpl?:Function, reasoningEffort?:string,
 *          temperature?:number|null, maxOutputTokens?:number, baseUrl?:string|null}} [opts]
 */
export function createOpenAiProvider({
  model = null,
  apiKey = process.env.OPENAI_API_KEY,
  fetchImpl = globalThis.fetch,
  reasoningEffort = 'none',
  temperature = null,
  maxOutputTokens = 400,
  baseUrl = null,
} = {}) {
  const url = `${(baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')}/responses`;

  /** 요청 본문(키 없음). 테스트에서 확인할 수 있게 따로 둔다. */
  function buildBody(req) {
    const body = {
      model,
      instructions: req.system,
      input: req.user,
      text: {format: {type: 'json_schema', name: req.schemaName, schema: req.schema, strict: true}},
      reasoning: {effort: reasoningEffort},
      max_output_tokens: Number.isFinite(req.maxOutputTokens)
        ? Math.max(1, Math.min(maxOutputTokens, Math.floor(req.maxOutputTokens)))
        : maxOutputTokens,
      store: false,
    };
    if (temperature !== null && temperature !== undefined && Number.isFinite(temperature)) body.temperature = temperature;
    return body;
  }

  async function generateStructured(req = {}) {
    const start = Date.now();
    const meta = {
      provider: 'openai', model, latencyMs: 0,
      inputTokens: null, cachedInputTokens: null, outputTokens: null, reasoningTokens: null,
      httpStatus: null,
    };
    const done = (r) => {
      meta.latencyMs = Date.now() - start;
      return {...r, meta};
    };
    const fail = (error, code = null, param = null) => {
      if (code) meta.errorCode = code;
      if (param) meta.errorParam = param;
      return done({ok: false, error});
    };

    try {
      if (typeof apiKey !== 'string' || apiKey.trim() === '') return fail('auth', 'missing_api_key');
      if (typeof fetchImpl !== 'function') return fail('network', 'no_fetch');
      if (req.signal?.aborted) return fail('aborted');

      const ctrl = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, Number.isFinite(req.timeoutMs) ? req.timeoutMs : 4000);
      const onOuterAbort = () => ctrl.abort();
      req.signal?.addEventListener?.('abort', onOuterAbort, {once: true});

      let status;
      let json = null;
      try {
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: {'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json'},
          body: JSON.stringify(buildBody(req)),
          signal: ctrl.signal,
        });
        status = res.status;
        meta.httpStatus = status;
        const raw = await res.text();
        try { json = JSON.parse(raw); } catch { json = null; }
      } catch {
        if (timedOut) return fail('timeout');
        if (req.signal?.aborted) return fail('aborted');
        return fail('network');
      } finally {
        clearTimeout(timer);
        req.signal?.removeEventListener?.('abort', onOuterAbort);
      }

      const usage = json?.usage;
      meta.inputTokens = num(usage?.input_tokens);
      meta.cachedInputTokens = num(usage?.input_tokens_details?.cached_tokens);
      meta.outputTokens = num(usage?.output_tokens);
      meta.reasoningTokens = num(usage?.output_tokens_details?.reasoning_tokens);

      if (!(status >= 200 && status < 300)) {
        const code = safeCode(json?.error?.code) ?? safeCode(json?.error?.type);
        return fail(mapHttpError(status, code), code, safeCode(json?.error?.param));
      }
      if (!json || typeof json !== 'object') return fail('bad_json', 'unparsable_response');

      const {text, refusal} = readOutput(json);
      if (refusal) return fail('blocked', 'refusal');
      if (json.status === 'incomplete') {
        const why = safeCode(json.incomplete_details?.reason);
        return fail(why === 'content_filter' ? 'blocked' : 'bad_json', why ?? 'incomplete');
      }
      if (json.status && json.status !== 'completed') return fail('server', safeCode(json.status));
      let data;
      try { data = JSON.parse(text); } catch { return fail('bad_json', 'invalid_json'); }
      return done({ok: true, data});
    } catch {
      return fail('server', 'adapter_exception');
    }
  }

  return {name: 'openai', model, generateStructured, buildBody};
}
