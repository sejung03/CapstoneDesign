// 답 정리와 보이는 문항(설계 §4-5, §4-1). FHIR R4 enableWhen 의미를 따른다.
// 미응답을 'no'로 바꾸지 않는다. 답 값(사용자가 고른 code)은 warning에 남기지 않는다.
import {RISK_CONFIRM_ID_RE, RISK_ANSWERS, SENSITIVE_CHOICE_ID_RE, SENSITIVE_ANSWERS, SYM_RETRY_ID_RE} from './constants.mjs';

/** 데이터 문항이 아닌 엔진 질문(설계 §4-4). 답은 engine Map에 넣는다. */
export const ENGINE_QUESTION_IDS = Object.freeze(['SYM_DICT_CONFIRM', 'SYM_CONFIRM', 'SYM_NOT_FOUND', 'ASK_START', 'MED_CHOICE', 'SYM_AREA_PICK', 'SYM_REWRITE_CONFIRM']);
/**
 * 11/18 되묻기 SYM_RETRY_<n>은 engine Map의 이 키에 {n, value}로 둔다(value null = 아직 답 없음). 여러 개면 n이 가장 큰 것.
 * 다른 엔진 답(문자열)과 달리 객체다. identify.mjs의 symRetryOf로만 읽는다.
 */
export const SYM_RETRY_KEY = 'SYM_RETRY';
const ENGINE_SET = new Set(ENGINE_QUESTION_IDS);
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_DEPTH = 20;

/**
 * @param {Array<{questionId:string, value:any}>} followUpAnswers
 * @param {object} data loadIntakeData() 결과
 * @returns {{codes:Map<string,string>, engine:Map<string,string>, warnings:string[]}}
 */
export function normalizeAnswers(followUpAnswers, data) {
  const warnings = [];
  const codes = new Map();
  const engine = new Map();
  const last = new Map();
  for (const a of Array.isArray(followUpAnswers) ? followUpAnswers : []) {
    if (!a || typeof a !== 'object' || typeof a.questionId !== 'string') continue;
    last.set(a.questionId, a.value); // 같은 questionId는 마지막 것
  }
  const riskConfirms = []; // 11/17 RF2: [{n, value}] — RISK_CONFIRM_<n> 답(값은 risk_yes·risk_no·risk_unsure만)
  const sensitiveChoices = [];
  const pendingRisks = [];
  const pendingSensitive = [];
  for (const [qid, value] of last) {
    const rm = RISK_CONFIRM_ID_RE.exec(qid);
    if (rm) {
      if (value === null) { pendingRisks.push(Number(rm[1])); continue; }
      if (value === undefined) continue;
      if (Object.values(RISK_ANSWERS).includes(value)) riskConfirms.push({n: Number(rm[1]), value});
      else warnings.push('invalid_answer:RISK_CONFIRM');
      continue;
    }
    const sm = SENSITIVE_CHOICE_ID_RE.exec(qid);
    if (sm) {
      if (value === null) { pendingSensitive.push(Number(sm[1])); continue; }
      if (value === undefined) continue;
      if (Object.values(SENSITIVE_ANSWERS).includes(value)) sensitiveChoices.push({n: Number(sm[1]), value});
      else warnings.push('invalid_answer:SENSITIVE_CHOICE');
      continue;
    }
    const ym = SYM_RETRY_ID_RE.exec(qid);
    if (ym) {
      if (value !== null && typeof value !== 'string') { warnings.push('invalid_answer:SYM_RETRY'); continue; }
      const n = Number(ym[1]);
      const prev = engine.get(SYM_RETRY_KEY);
      if (!prev || n > prev.n) engine.set(SYM_RETRY_KEY, {n, value: value ?? null});
      continue;
    }
    const known = data.itemById.has(qid);
    if (!known && !ENGINE_SET.has(qid)) {
      // 모르는 ID는 형식이 맞을 때만 ID를 남긴다(값은 남기지 않는다)
      warnings.push(ID_RE.test(qid) ? `unknown_question:${qid}` : 'unknown_question');
      continue;
    }
    if (value === null || value === undefined) continue; // 미응답
    if (known) {
      const ok = typeof value === 'string' && (data.optionsById.get(qid) ?? []).some((o) => o.code === value);
      if (ok) codes.set(qid, value);
      else warnings.push(`invalid_answer:${qid}`);
    } else if (typeof value === 'string') {
      engine.set(qid, value); // 엔진 질문의 이상한 값은 identify가 '모름'으로 처리
    } else {
      warnings.push(`invalid_answer:${qid}`);
    }
  }
  return {codes, engine, warnings, riskConfirms, sensitiveChoices, pendingRisks, pendingSensitive};
}

function conditionTrue(cond, codes, data, depth) {
  const visible = isVisible(cond.question, codes, data, depth + 1);
  const answered = visible && codes.has(cond.question);
  switch (cond.operator) {
    case '=': return answered && codes.get(cond.question) === cond.answer;
    case '!=': return answered && codes.get(cond.question) !== cond.answer;
    case 'exists': return answered === (cond.answer === true);
    default: return false;
  }
}

/**
 * enableWhen 평가. 가리킨 문항이 보이지 않거나 답이 없으면 '='·'!='는 거짓,
 * 'exists'는 (답 있음) === answer. enable_behavior가 비면 all.
 */
export function isVisible(linkId, codes, data, depth = 0) {
  if (depth > MAX_DEPTH) return false;
  const item = data.itemById.get(linkId);
  if (!item) return false;
  const conds = data.enableWhenById.get(linkId);
  if (!conds || conds.length === 0) return true;
  const results = conds.map((c) => conditionTrue(c, codes, data, depth));
  return item.enableBehavior === 'any' ? results.some(Boolean) : results.every(Boolean);
}

/** 보이는 문항의 답만 남긴 Map(order 순). */
export function visibleCodes(codes, data) {
  const out = new Map();
  for (const item of data.items) {
    if (codes.has(item.linkId) && isVisible(item.linkId, codes, data)) out.set(item.linkId, codes.get(item.linkId));
  }
  return out;
}
