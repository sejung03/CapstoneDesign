import {
  SENSITIVE_ANSWERS, SENSITIVE_CHOICE_MAX_ASKS, SENSITIVE_CHOICE_PREFIX,
  SENSITIVE_CUE_BRANCHES, SENSITIVE_CUE_CONTEXT_RE, SENSITIVE_CUE_SELF_RE, SENSITIVE_CUE_WINDOW, SENSITIVE_KEYS,
} from './constants.mjs';
import {normalizeTerm} from '../llm/normalize.mjs';
import {stripNoise} from './free-text.mjs';

/**
 * 11/17 LCR1: 정규화한 문자열 v에서 강한 단서 하나라도 "쓰임 제외 없이" 걸리면 true.
 * 단서마다 바로 앞뒤 SENSITIVE_CUE_WINDOW자 안에 쓰임 제외(예방·영화·뉴스·뜻이 뭐…)가 있으면 그 단서는 넘긴다.
 * 갈래별 쓰임 제외(near·anywhere)도 본다. 1366 갈래는 피해자가 '나'인 서술(SENSITIVE_CUE_SELF_RE)이면 쓰임 제외를 보지 않는다.
 */
function strongCueIn(v, branch) {
  if (branch.selfOverride && SENSITIVE_CUE_SELF_RE.test(v)) { branch.re.lastIndex = 0; return branch.re.test(v); }
  if (branch.anywhere && branch.anywhere.test(v)) return false;
  const re = branch.re;
  const excluded = (s) => SENSITIVE_CUE_CONTEXT_RE.test(s) || (branch.near ? branch.near.test(s) : false);
  re.lastIndex = 0;
  for (let m = re.exec(v); m; m = re.exec(v)) {
    // 앞 창은 한 글자 더 잘라 '방법'의 '방'이 창 밖으로 잘려 '법'만 남는 일을 막는다. 뒤 창은 '신고하는방법' 길이만큼 4자 더 본다.
    const before = v.slice(Math.max(0, m.index - SENSITIVE_CUE_WINDOW - 1), m.index);
    const after = v.slice(m.index + m[0].length, m.index + m[0].length + SENSITIVE_CUE_WINDOW + 4);
    if (!excluded(before) && !excluded(after)) return true;
  }
  return false;
}

/** 메시지별 강한 민감 단서를 정해진 우선순위(112 > 1366 > 109)로 하나만 고른다. 넓은 단어(맞았·때리·위협…)는 보지 않는다. */
export function sensitiveCueHits(messages) {
  const out = [];
  for (let i = 0; i < messages.length; i += 1) {
    if (typeof messages[i] !== 'string') continue;
    const t = normalizeTerm(messages[i]);
    const variants = [t, stripNoise(t)];
    const branch = SENSITIVE_CUE_BRANCHES.find((b) => variants.some((v) => strongCueIn(v, b)));
    if (branch) out.push({messageKey: branch.messageKey, messageIndex: i});
  }
  return out;
}

/** 규칙 hit와 강한 단서를 합친다. messageKey는 응답 문구 선택에만 쓰고 trace에는 넣지 않는다. */
export function collectSensitiveEvents({hits, messages}) {
  const byIndex = new Map();
  for (const h of hits) {
    if (!SENSITIVE_KEYS.includes(h.messageKey)) continue;
    for (const i of h.messageIndexes ?? []) if (!byIndex.has(i)) byIndex.set(i, h.messageKey);
  }
  for (const h of sensitiveCueHits(messages)) if (!byIndex.has(h.messageIndex)) byIndex.set(h.messageIndex, h.messageKey);
  return [...byIndex].sort((a, b) => a[0] - b[0]).map(([messageIndex, messageKey]) => ({messageIndex, messageKey}));
}

/**
 * 상태 없는 민감 안내 선택 처리. 답의 n은 그때까지 확인한 메시지 수다.
 * 새 민감 메시지가 생기면 다시 묻고, 무응답 두 번 또는 확인 전 skip은 end로 처리한다.
 */
export function resolveSensitiveChoice({events, choices = [], messageCount, reason}) {
  const valid = choices.filter((a) => Number.isInteger(a.n) && a.n >= 1 && a.n <= messageCount);
  // LLM 민감 신호는 종류를 저장하지 않는다. 다음 요청에는 선택 답만 남으므로 배너 유지/해제만 처리한다.
  if (events.length === 0) {
    if (valid.some((a) => a.value === SENSITIVE_ANSWERS.end)) return {state: 'end', askId: null, messageKey: null};
    if (valid.some((a) => a.value === SENSITIVE_ANSWERS.continue)) return {state: 'continue', askId: null, messageKey: null};
    return {state: 'none', askId: null, messageKey: null};
  }
  const uncovered = events.filter((e) => !valid.some((a) => a.n > e.messageIndex));
  if (uncovered.length > 0) {
    const first = uncovered[0];
    if (reason === 'skip' || messageCount - first.messageIndex > SENSITIVE_CHOICE_MAX_ASKS) {
      return {state: 'end', askId: null, messageKey: first.messageKey};
    }
    return {state: 'pending', askId: `${SENSITIVE_CHOICE_PREFIX}${messageCount}`, messageKey: first.messageKey};
  }
  const covering = valid.filter((a) => events.some((e) => a.n > e.messageIndex));
  if (covering.some((a) => a.value === SENSITIVE_ANSWERS.end)) {
    return {state: 'end', askId: null, messageKey: events[0].messageKey};
  }
  return {state: 'continue', askId: null, messageKey: events[0].messageKey};
}
