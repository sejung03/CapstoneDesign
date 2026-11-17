import {
  SENSITIVE_ANSWERS, SENSITIVE_CHOICE_MAX_ASKS, SENSITIVE_CHOICE_PREFIX,
  SENSITIVE_CUE_BRANCHES, SENSITIVE_KEYS,
} from './constants.mjs';
import {normalizeTerm} from '../llm/normalize.mjs';
import {stripNoise} from './free-text.mjs';

/** 메시지별 민감 단서를 정해진 우선순위(112 > 1366 > 109)로 하나만 고른다. */
export function sensitiveCueHits(messages) {
  const out = [];
  for (let i = 0; i < messages.length; i += 1) {
    const t = normalizeTerm(messages[i]);
    const variants = [t, stripNoise(t)];
    const branch = SENSITIVE_CUE_BRANCHES.find((b) => variants.some((v) => b.re.test(v)));
    if (branch) out.push({messageKey: branch.messageKey, messageIndex: i});
  }
  return out;
}

/** 규칙 hit와 넓은 단서를 합친다. messageKey는 응답 문구 선택에만 쓰고 trace에는 넣지 않는다. */
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
  if (events.length === 0) return {state: 'none', askId: null, messageKey: null};
  const valid = choices.filter((a) => Number.isInteger(a.n) && a.n >= 1 && a.n <= messageCount);
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
