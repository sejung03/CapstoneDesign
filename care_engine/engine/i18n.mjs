// 11/17 다국어(care_engine/docs/다국어_설계.md). 한국어가 원본이고 번역은 ref.text_i18n(시드 text_i18n.csv)에 있다.
// 이 파일: 번역할 한국어 원문 목록(키별)과, 번역을 읽어 {ko, en?, zh?, vi?, uz?} 문구를 만드는 도구.
import {ENGINE_TEXT, EMERGENCY_TEXT, EMERGENCY_UNKNOWN, REFERRAL_ADDONS, NOT_DIAGNOSIS, SUMMARY, SUMMARY_FORMAT,
  COURSE_SLOT_LABELS, CARD_SLOT_LABELS, DERIVED_VALUE_LABELS} from './templates.mjs';
import {COPY} from '../llm/copy.mjs';

/** 프론트(frontend/i18n.mjs)와 같은 언어. ko는 원본. */
export const LOCALES = Object.freeze(['ko', 'en', 'zh', 'vi', 'uz']);
export const TRANSLATED_LOCALES = Object.freeze(['en', 'zh', 'vi', 'uz']);
export const TARGETS = Object.freeze(['item', 'option', 'symptom', 'department', 'template']);
export const REVIEW_STATUSES = Object.freeze(['draft', 'team_reviewed']);

/** 엔진 문구(target='template')의 키 → 한국어 원문. */
export function templateSourceTexts() {
  const out = {};
  for (const [k, v] of Object.entries(ENGINE_TEXT)) out[k] = v;
  out['q.sym_confirm.label'] = COPY.symConfirmLabel.ko;
  out['q.sym_confirm.none'] = COPY.symNone.ko;
  out['q.sym_confirm.unsure'] = COPY.symUnsure.ko;
  for (const [k, t] of Object.entries(EMERGENCY_TEXT)) {
    out[`emergency.${k}.title`] = t.title;
    out[`emergency.${k}.message`] = t.message;
  }
  out['emergency.unknown.title'] = EMERGENCY_UNKNOWN.title;
  out['emergency.unknown.message'] = EMERGENCY_UNKNOWN.message;
  for (const [k, v] of Object.entries(REFERRAL_ADDONS)) out[`addon.${k}`] = v;
  out.not_diagnosis = NOT_DIAGNOSIS;
  for (const [k, v] of Object.entries(SUMMARY)) if (typeof v === 'string') out[`summary.${k}`] = v;
  out['summary.pain'] = SUMMARY_FORMAT.pain;
  out['summary.departmentRank'] = SUMMARY_FORMAT.departmentRank;
  for (const [k, v] of Object.entries(COURSE_SLOT_LABELS)) out[`course_slot.${k}`] = v;
  for (const [k, v] of Object.entries(CARD_SLOT_LABELS)) out[`card_slot.${k}`] = v;
  for (const [k, v] of Object.entries(DERIVED_VALUE_LABELS)) out[`derived.${k}`] = v;
  return out;
}

/**
 * 원칙 4: 안전 문구 키. 응급·위기 안내와 그 덧붙임, 위험 확인·민감 안내 선택 질문, 응급 확인과 관련된 요약 줄.
 * 11/18부터 검토 상태와 상관없이 번역을 낸다. 대신 숫자(전화번호)를 빌드·테스트가 검사하고,
 * 프론트 응급 카드가 한국어 원문을 함께 보인다. 이 목록은 테스트·문서가 쓴다.
 */
export function isSafetyKey(target, key) {
  if (target !== 'template') return false;
  return key.startsWith('emergency.') || key.startsWith('addon.') || key === 'not_diagnosis'
    || key.startsWith('q.risk_confirm.') || key.startsWith('q.sensitive_choice.')
    || ['summary.riskUnconfirmed', 'summary.safetyUnanswered', 'summary.footer', 'summary.emergencyHeader'].includes(key);
}

/**
 * 번역할 한국어 원문 전체 목록. data는 loadIntakeData() 결과.
 * @returns {Array<{target:string, key:string, sourceKo:string}>}
 */
export function sourceTexts(data) {
  const rows = [];
  for (const it of data.items) rows.push({target: 'item', key: it.linkId, sourceKo: it.textKo});
  for (const [linkId, list] of data.optionsById) for (const o of list) rows.push({target: 'option', key: `${linkId}:${o.code}`, sourceKo: o.displayKo});
  for (const s of data.refData.symptoms.values()) rows.push({target: 'symptom', key: s.id, sourceKo: s.nameKo});
  for (const d of data.departments.values()) rows.push({target: 'department', key: d.deptId, sourceKo: d.nameKo});
  for (const [key, sourceKo] of Object.entries(templateSourceTexts())) rows.push({target: 'template', key, sourceKo});
  return rows;
}

/**
 * 번역 행(시드 text_i18n 형식, CSV 문자열) → 찾기 표. 형식이 틀린 행은 problems에 적는다(호출 측이 IntakeDataError).
 * @returns {Map<string, Map<string, {text:string, sourceKo:string, reviewed:boolean}>>} 키 `${target}|${key}`
 */
export function buildI18nIndex(rows, problems = []) {
  const index = new Map();
  for (const r of rows) {
    const at = `text_i18n ${r.target}:${r.key}:${r.locale}`;
    if (!TARGETS.includes(r.target)) { problems.push(`${at}: target`); continue; }
    if (!TRANSLATED_LOCALES.includes(r.locale)) { problems.push(`${at}: locale`); continue; }
    if (!REVIEW_STATUSES.includes(r.review_status)) { problems.push(`${at}: review_status`); continue; }
    if (!String(r.text ?? '').trim() || !String(r.source_ko ?? '').trim()) { problems.push(`${at}: 빈 문구`); continue; }
    const id = `${r.target}|${r.key}`;
    if (!index.has(id)) index.set(id, new Map());
    if (index.get(id).has(r.locale)) { problems.push(`${at}: 중복`); continue; }
    index.get(id).set(r.locale, {text: r.text, sourceKo: r.source_ko, reviewed: r.review_status === 'team_reviewed'});
  }
  return index;
}

/**
 * 한 언어 번역. 원문이 지금 한국어(ko)와 같을 때만(원칙 6). 없으면 null. locale이 'ko'면 ko 그대로.
 */
export function translateOne(index, target, key, ko, locale) {
  if (locale === 'ko') return ko;
  const e = index?.get(`${target}|${key}`)?.get(locale);
  if (!e || e.sourceKo !== ko) return null;
  return e.text;
}

/** {ko, en?, zh?, vi?, uz?} 문구. 번역이 없는 언어는 넣지 않는다(프론트가 ko를 보인다). */
export function translate(index, target, key, ko) {
  const out = {ko};
  for (const l of TRANSLATED_LOCALES) {
    const t = translateOne(index, target, key, ko, l);
    if (t !== null) out[l] = t;
  }
  return out;
}
