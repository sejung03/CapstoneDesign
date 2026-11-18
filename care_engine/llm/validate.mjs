// LLM 출력 검사. 설계 5-6(증상 선택), 6-4(건강정보).
import {INTENTS, PICK_STATUSES, PROFILE_FIELDS, RISK_SIGNALS} from './schemas.mjs';
import {MAX_PICKS, PROFILE_MAX_ITEMS, PROFILE_VALUE_MAX, PROFILE_QUOTE_MAX} from './config.mjs';
import {normalizeTerm} from './normalize.mjs';

function parseMaybeJson(raw) {
  if (typeof raw === 'string') {
    try { return {ok: true, value: JSON.parse(raw)}; } catch { return {ok: false}; }
  }
  return {ok: true, value: raw};
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const hasExactKeys = (o, keys) => {
  const k = Object.keys(o);
  return k.length === keys.length && keys.every((x) => Object.prototype.hasOwnProperty.call(o, x));
};

/**
 * @returns {{ok:boolean, error?:'bad_json', intent?:string, status?:string, picks:string[],
 *            dropped:{unknownId:number, duplicate:number, overLimit:number}}}
 */
export function validateSymptomPick(raw, candidateIds, refData) {
  const dropped = {unknownId: 0, duplicate: 0, overLimit: 0};
  const bad = () => ({ok: false, error: 'bad_json', picks: [], dropped});
  const parsed = parseMaybeJson(raw);
  if (!parsed.ok) return bad();
  const o = parsed.value;
  if (!isPlainObject(o) || !hasExactKeys(o, ['intent', 'status', 'picks'])) return bad();
  if (!INTENTS.includes(o.intent) || !PICK_STATUSES.includes(o.status)) return bad();
  if (!Array.isArray(o.picks) || !o.picks.every((p) => typeof p === 'string')) return bad();

  const allowed = new Set(candidateIds);
  const seen = new Set();
  const picks = [];
  for (const id of o.picks) {
    const s = refData.symptoms.get(id);
    // 이번 후보 집합 + 현재 data_version의 ref.symptom에 있고 후보 가능(fallback·상위 아님)
    if (!allowed.has(id) || !s || !s.isCandidate) { dropped.unknownId += 1; continue; }
    if (seen.has(id)) { dropped.duplicate += 1; continue; }
    seen.add(id);
    if (picks.length >= MAX_PICKS) { dropped.overLimit += 1; continue; }
    picks.push(id);
  }

  let status = o.status;
  if (status === 'matched' && picks.length === 0) status = 'no_match';
  // no_match·unclear면 picks를 쓰지 않는다(설계 5-8: fallback). 보수적 처리.
  const finalPicks = status === 'matched' ? picks : [];
  return {ok: true, intent: o.intent, status, picks: finalPicks, dropped};
}

export function validateRiskSignal(raw) {
  const parsed = parseMaybeJson(raw);
  if (!parsed.ok || !isPlainObject(parsed.value) || !hasExactKeys(parsed.value, ['risk_signal'])) {
    return {ok: false, signal: 'none', error: 'bad_json'};
  }
  if (!RISK_SIGNALS.includes(parsed.value.risk_signal)) return {ok: false, signal: 'none', error: 'invalid_risk_signal'};
  return {ok: true, signal: parsed.value.risk_signal, error: null};
}

export function validateSymptomRisk(raw, candidateIds, refData) {
  const parsed = parseMaybeJson(raw);
  if (!parsed.ok || !isPlainObject(parsed.value)
    || !hasExactKeys(parsed.value, ['intent', 'status', 'picks', 'risk_signal'])) {
    return {...validateSymptomPick(null, candidateIds, refData), riskSignal: 'none', riskError: 'bad_json'};
  }
  const symptom = validateSymptomPick({intent: parsed.value.intent, status: parsed.value.status, picks: parsed.value.picks}, candidateIds, refData);
  const risk = RISK_SIGNALS.includes(parsed.value.risk_signal)
    ? {signal: parsed.value.risk_signal, error: null}
    : {signal: 'none', error: 'invalid_risk_signal'};
  return {...symptom, riskSignal: risk.signal, riskError: risk.error};
}

const DROP_REASONS = [
  'badShape', 'indexOutOfRange', 'quoteNotFound', 'valueInvalid', 'valueNotInQuote', 'ageInvalid',
  'duplicateField', 'overLimit',
];

function emptyDropped() {
  return Object.fromEntries(DROP_REASONS.map((r) => [r, 0]));
}

/**
 * @param {*} raw  LLM 출력({items:[...]}) — 문자열(JSON)도 받는다
 * @param {string[]} messages  요청의 사용자 메시지 배열(원문)
 * @returns {{ok:boolean, error?:'bad_json', items:Array<object>, dropped:Record<string,number>}}
 *   items는 BACKEND.md 0.18.0 형식
 */
export function validateProfileItems(raw, messages) {
  const dropped = emptyDropped();
  const parsed = parseMaybeJson(raw);
  if (!parsed.ok || !isPlainObject(parsed.value) || !hasExactKeys(parsed.value, ['items']) || !Array.isArray(parsed.value.items)) {
    return {ok: false, error: 'bad_json', items: [], dropped};
  }

  const fieldsSeen = new Set();
  const items = [];
  for (const it of parsed.value.items) {
    if (!isPlainObject(it) || !hasExactKeys(it, ['field', 'value', 'messageIndex', 'quote'])
      || !PROFILE_FIELDS.includes(it.field) || typeof it.value !== 'string'
      || !Number.isInteger(it.messageIndex) || typeof it.quote !== 'string') {
      dropped.badShape += 1; continue;
    }
    // field 중복: 원래 순서에서 첫 항목만(그 항목이 틀려도 뒤 항목으로 대신하지 않는다)
    if (fieldsSeen.has(it.field)) { dropped.duplicateField += 1; continue; }
    fieldsSeen.add(it.field);

    const r = checkProfileItem(it, messages);
    if (r) { dropped[r] += 1; continue; }
    if (items.length >= PROFILE_MAX_ITEMS) { dropped.overLimit += 1; continue; }
    const value = it.field === 'age' ? String(Number(it.value.trim())) : it.value.trim();
    items.push({
      id: `${it.field}-1`,
      field: it.field,
      operation: 'set',
      value,
      evidence: {kind: 'message', index: it.messageIndex, quote: it.quote},
    });
  }
  return {ok: true, items, dropped};
}

/** 항목 하나 검사. 문제가 있으면 사유 이름, 없으면 null. */
function checkProfileItem(it, messages) {
  const list = Array.isArray(messages) ? messages : [];
  if (it.messageIndex < 0 || it.messageIndex >= list.length || typeof list[it.messageIndex] !== 'string') {
    return 'indexOutOfRange';
  }
  const message = list[it.messageIndex];
  const quoteNorm = normalizeTerm(it.quote);
  // quote: 1~500자, 공백만 불가, 정규화 후 부분 문자열(설계) + 원문 그대로 포함(프론트가 includes로 검사)
  if (!it.quote.trim() || it.quote.length > PROFILE_QUOTE_MAX || !quoteNorm
    || !normalizeTerm(message).includes(quoteNorm) || !message.includes(it.quote)) {
    return 'quoteNotFound';
  }
  const v = it.value.trim();
  if (!v || it.value.length > PROFILE_VALUE_MAX) return 'valueInvalid';
  if (it.field === 'age') {
    if (!/^\d{1,3}$/.test(v) || Number(v) > 120) return 'ageInvalid';
    const nums = (it.quote.match(/\d+/g) ?? []).map(Number);
    if (!nums.includes(Number(v))) return 'valueNotInQuote';
    return null;
  }
  if (!quoteNorm.includes(normalizeTerm(v))) return 'valueNotInQuote';
  return null;
}

/** 11/18 절충 1: 고쳐 쓴 표현 개수·길이 상한(스키마에 넣지 않는 제한) */
export const REWRITE_MAX_TERMS = 4;
export const REWRITE_TERM_MAX = 30;

/**
 * 고쳐 쓰기 출력 검사. terms는 사전 재검색에만 쓰고 사용자에게 보이지 않는다.
 * 문자열이 아니거나 빈 표현은 버리고, 앞에서부터 REWRITE_MAX_TERMS개, 각 REWRITE_TERM_MAX자까지만 쓴다.
 * @param {{risk?:boolean}} [opts]
 * @returns {{ok:boolean, error?:'bad_json', intent?:string, terms:string[], riskSignal:string, riskError:string|null}}
 */
export function validateRewrite(raw, {risk = false} = {}) {
  const bad = {ok: false, error: 'bad_json', terms: [], riskSignal: 'none', riskError: risk ? 'bad_json' : null};
  const parsed = parseMaybeJson(raw);
  if (!parsed.ok || !isPlainObject(parsed.value)) return bad;
  const o = parsed.value;
  if (!hasExactKeys(o, risk ? ['intent', 'terms', 'risk_signal'] : ['intent', 'terms'])) return bad;
  if (!INTENTS.includes(o.intent) || !Array.isArray(o.terms)) return bad;
  const seen = new Set();
  const terms = [];
  for (const t of o.terms) {
    if (typeof t !== 'string') continue;
    const s = t.replace(/[\r\n]+/g, ' ').trim().slice(0, REWRITE_TERM_MAX);
    const n = normalizeTerm(s);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    terms.push(s);
    if (terms.length >= REWRITE_MAX_TERMS) break;
  }
  const riskOk = !risk || RISK_SIGNALS.includes(o.risk_signal);
  return {ok: true, intent: o.intent, terms, riskSignal: risk && riskOk ? o.risk_signal : 'none', riskError: riskOk ? null : 'invalid_risk_signal'};
}
