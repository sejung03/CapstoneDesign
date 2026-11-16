// 안전 규칙 평가(설계 §4-1). 결정표 + priority hit policy(OMG DMN).
// 자유 입력 규칙(메시지)과 답 규칙(보이는 답)을 같은 표에서 priority로 고른다.
import {matchFreeText} from './free-text.mjs';

function conditionHolds(cond, codes) {
  if (!codes.has(cond.question)) return false; // 답이 없으면 거짓(미응답은 규칙에 걸리지 않는다)
  const v = codes.get(cond.question);
  if (cond.operator === '=') return v === cond.answers[0];
  if (cond.operator === 'in') return cond.answers.includes(v);
  return false;
}

/**
 * @param {{codes:Map<string,string>, messages?:string[], data:object, freeTextRules?:{rules:Array<object>}}} input
 *   codes는 보이는 문항의 답만(visibleCodes). 숨겨진 문항의 답은 여기 오기 전에 빠진다.
 * @returns {{hits:Array<{ruleId, priority, result, terminal, triageCategoryId, messageKey, source}>, top:object|null}}
 */
export function evaluateSafety({codes, messages = [], data, freeTextRules = null}) {
  const hits = [];
  if (freeTextRules) {
    const ids = new Set(matchFreeText(messages, freeTextRules));
    for (const r of freeTextRules.rules) {
      if (ids.has(r.ruleId)) hits.push(pick(r, 'free_text'));
    }
  }
  for (const rule of data.rules) {
    const results = rule.conditions.map((c) => conditionHolds(c, codes));
    const hit = rule.combine === 'any' ? results.some(Boolean) : results.length > 0 && results.every(Boolean);
    if (hit) hits.push(pick(rule, 'answer'));
  }
  hits.sort((a, b) => a.priority - b.priority || (a.ruleId < b.ruleId ? -1 : 1));
  return {hits, top: hits[0] ?? null};
}

/**
 * 11/17 EF(G6): 안전 미응답 판단에 쓰는 문항 = 답 규칙 조건(`safety_rule_condition`)이 가리키는 문항 전체(order 순).
 * 코드에 박지 않고 데이터에서 만든다. 시드 v2.1-20261113에서는 Q0·N1·N2·N3(테스트로 확인).
 * @returns {string[]}
 */
export function safetyCheckItemIds(data) {
  const ids = new Set();
  for (const rule of data.rules) for (const c of rule.conditions) ids.add(c.question);
  return data.items.filter((it) => ids.has(it.linkId)).map((it) => it.linkId);
}

function pick(r, source) {
  return {
    ruleId: r.ruleId,
    priority: r.priority,
    result: r.result,
    terminal: r.terminal,
    triageCategoryId: r.triageCategoryId ?? null,
    messageKey: r.messageKey,
    source,
  };
}
