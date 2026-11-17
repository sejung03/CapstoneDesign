// 테스트·평가용 mock 제공업체. 네트워크 없음.
//
// fixtures 형식:
//   { "<schemaName>": { "<입력 텍스트>": entry, ... }, ... }   (schemaName 키가 없으면 전체를 한 맵으로 본다)
//   입력 텍스트는 user 문자열이 그 텍스트와 같거나 "\n<텍스트>"로 끝나면 맞는 것으로 본다(가장 긴 키 우선).
//   case id는 프롬프트에 넣지 않는다.
// entry:
//   {data: <객체>}                 정상 응답(파싱된 JSON)
//   {text: '<문자열>'}              업체가 돌려준 원문 문자열 → JSON 파싱, 실패하면 bad_json
//   {error: 'timeout'|'rate_limit'|'server'|'network'|'blocked'|'bad_json'}
//   delayMs: 위와 함께 지연(ms). req.timeoutMs를 넘으면 timeout, signal이 끊기면 aborted
//   배열 [entry, entry, ...]       호출할 때마다 차례로(재시도 테스트용). 끝나면 마지막 것을 반복
// 맞는 키가 없으면 options.defaults[schemaName], 그것도 없으면 not_implemented.

const MOCK_ERRORS = new Set(['timeout', 'rate_limit', 'server', 'network', 'blocked', 'bad_json']);

export function createMockProvider(fixtures = {}, {model = 'mock-v0', defaults = {}} = {}) {
  const calls = new Map();
  let callCount = 0;

  function mapFor(schemaName) {
    const m = fixtures?.[schemaName];
    return m && typeof m === 'object' && !Array.isArray(m) ? m : fixtures ?? {};
  }

  function lookup(req) {
    const map = mapFor(req.schemaName);
    let bestKey = null;
    for (const key of Object.keys(map)) {
      if (req.user === key || req.user.endsWith(`\n${key}`)) {
        if (bestKey === null || key.length > bestKey.length) bestKey = key;
      }
    }
    if (bestKey === null) {
      const d = defaults?.[req.schemaName];
      return d ? {key: `__default__:${req.schemaName}`, entry: d} : null;
    }
    return {key: `${req.schemaName}:${bestKey}`, entry: map[bestKey]};
  }

  return {
    name: 'mock',
    model,
    /** 테스트용: 지금까지 generateStructured가 불린 횟수 */
    get callCount() { return callCount; },
    async generateStructured(req) {
      callCount += 1;
      const started = Date.now();
      const meta = () => ({provider: 'mock', model, latencyMs: Date.now() - started});
      const found = lookup(req);
      if (!found) return {ok: false, error: 'not_implemented', meta: meta()};

      let entry = found.entry;
      if (Array.isArray(entry)) {
        const n = calls.get(found.key) ?? 0;
        calls.set(found.key, n + 1);
        entry = entry[Math.min(n, entry.length - 1)];
      }

      const delayMs = Number(entry?.delayMs ?? 0);
      if (delayMs > 0 || req.signal?.aborted) {
        const waited = await wait(delayMs, req.timeoutMs, req.signal);
        if (waited !== 'done') return {ok: false, error: waited, meta: meta()};
      }

      if (entry?.error) {
        return {ok: false, error: MOCK_ERRORS.has(entry.error) ? entry.error : 'server', meta: meta()};
      }
      if (typeof entry?.text === 'string') {
        try { return {ok: true, data: JSON.parse(entry.text), meta: meta()}; } catch { return {ok: false, error: 'bad_json', meta: meta()}; }
      }
      if (entry && 'data' in entry) return {ok: true, data: structuredClone(entry.data), meta: meta()};
      return {ok: false, error: 'bad_json', meta: meta()};
    },
  };
}

/** delayMs 기다림. timeoutMs가 먼저 오면 'timeout', signal이 끊기면 'aborted', 아니면 'done'. */
function wait(delayMs, timeoutMs, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) { resolve('aborted'); return; }
    const limit = Number.isFinite(timeoutMs) && timeoutMs >= 0 ? timeoutMs : Infinity;
    const outcome = delayMs > limit ? 'timeout' : 'done';
    const ms = Math.min(delayMs, limit);
    const timer = setTimeout(() => { cleanup(); resolve(outcome); }, ms);
    const onAbort = () => { cleanup(); resolve('aborted'); };
    function cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
    }
    signal?.addEventListener?.('abort', onAbort, {once: true});
  });
}
