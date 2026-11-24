// 요약(설계 §8-2·§8-4). 표시 문구(선택지 문구·증상 이름·템플릿)만 조합한다. 사용자 원문·질환명 없음.
// 11/17 다국어: 문구를 tx(target, key, ko)로 얻는다. 한국어는 ko 그대로, 다른 언어는 번역(없으면 null).
// 한 언어에서 하나라도 null이면 그 언어의 요약은 null(섞인 요약을 만들지 않음, care_engine/docs/다국어_설계.md 원칙 3).
import {SUMMARY, SUMMARY_FORMAT, fillText, COURSE_SLOT_LABELS, CARD_SLOT_LABELS, DERIVED_VALUE_LABELS} from './templates.mjs';
import {slotEntries} from './slots.mjs';
import {TARGET_ITEM_ID} from './constants.mjs';

export {TARGET_ITEM_ID}; // 11/17 EF(G6): 상수는 constants.mjs 한 곳에(이전 import 경로 유지용 재수출)
export const SUMMARY_MAX = 2000;

/** 한국어 그대로 돌려주는 기본 tx. */
export const KO_TEXT = (target, key, ko) => ko;

class MissingText extends Error {}

/** slot 값(답 code 또는 매핑 value) → {target, key, ko}(표시할 수 없으면 null). */
function displayRef(entry, data) {
  if (!entry) return null;
  const opt = entry.question ? (data.optionsById.get(entry.question) ?? []).find((o) => o.code === entry.value) : null;
  if (opt) return {target: 'option', key: `${entry.question}:${opt.code}`, ko: opt.displayKo};
  if (Object.hasOwn(DERIVED_VALUE_LABELS, entry.value)) return {target: 'template', key: `derived.${entry.value}`, ko: DERIVED_VALUE_LABELS[entry.value]};
  return null; // 표시할 수 없는 값은 쓰지 않는다
}

/** slot 값 → 한국어 표시 문구(이전 이름 유지). */
export function displayOf(entry, data) {
  return displayRef(entry, data)?.ko ?? null;
}

function clip(lines) {
  let text = lines.filter(Boolean).join('\n');
  if (text.length > SUMMARY_MAX) text = text.slice(0, SUMMARY_MAX);
  return text;
}

/** tx를 감싸 번역이 없으면 MissingText를 던지는 도구 묶음. */
function texts(tx) {
  const need = (target, key, ko) => {
    const v = tx(target, key, ko);
    if (v === null || v === undefined) throw new MissingText(`${target}:${key}`);
    return v;
  };
  const tpl = (key, ko) => need('template', key, ko);
  const show = (ref) => (ref ? need(ref.target, ref.key, ref.ko) : null);
  return {need, tpl, show};
}

/** fn이 MissingText를 던지면 null. */
function orNull(fn) {
  try { return fn(); } catch (e) { if (e instanceof MissingText) return null; throw e; }
}

/**
 * 일반 요약.
 * @param {{slots:object, codes:Map, symptom:object|null, departments:Array<{deptId?, nameKo}>, data:object, safetyUnanswered:boolean,
 *          riskUnconfirmed?:boolean, group?:string|null, tx?:Function}} input
 *   group: recommend()의 group. null이면 증상 통계(variant) 경로, 문자열이면 fallback 그룹 경로, 생략(undefined)이면 순위 설명 줄을 넣지 않는다.
 * @returns {string|null} 한국어(tx 생략)는 항상 문자열. 다른 언어는 번역이 모자라면 null
 */
export function buildSummary({slots, codes, symptom, departments = [], data, safetyUnanswered = false, riskUnconfirmed = false, group, tx = KO_TEXT, profileInfo = null}) {
  return orNull(() => {
    const {need, tpl, show} = texts(tx);
    const lines = [];
    if (riskUnconfirmed) lines.push(tpl('summary.riskUnconfirmed', SUMMARY.riskUnconfirmed)); // 11/17 RF2: 확인 질문 '잘 모르겠어요'(또는 2번 무응답)면 첫 줄
    if (safetyUnanswered) lines.push(tpl('summary.safetyUnanswered', SUMMARY.safetyUnanswered));
    lines.push(tpl('summary.header', SUMMARY.header));
    const target = show(displayRef(codes.has(TARGET_ITEM_ID) ? {value: codes.get(TARGET_ITEM_ID), question: TARGET_ITEM_ID} : null, data));
    if (target) lines.push(`${tpl('summary.target', SUMMARY.target)}: ${target}`);
    const symptomName = symptom?.nameKo ? need('symptom', symptom.id, symptom.nameKo) : tpl('summary.symptomUnknown', SUMMARY.symptomUnknown);
    lines.push(`${tpl('summary.symptom', SUMMARY.symptom)}: ${symptomName}`);
    const onset = slotEntries(slots, 'report.onset').map((e) => show(displayRef(e, data))).filter(Boolean);
    if (onset.length) lines.push(`${tpl('summary.onset', SUMMARY.onset)}: ${onset.join(', ')}`);
    const course = [];
    for (const slot of ['detail.continuous', 'detail.worsening']) {
      for (const e of slotEntries(slots, slot)) {
        const d = show(displayRef(e, data));
        if (d) course.push(COURSE_SLOT_LABELS[slot] ? `${tpl(`course_slot.${slot}`, COURSE_SLOT_LABELS[slot])}(${d})` : d);
      }
    }
    for (const e of slotEntries(slots, 'report.notes')) {
      const d = show(displayRef(e, data));
      if (d) course.push(d);
    }
    if (course.length) lines.push(`${tpl('summary.course', SUMMARY.course)}: ${course.join(', ')}`);
    const pain = slotEntries(slots, 'detail.pain_score').map((e) => show(displayRef(e, data))).filter(Boolean);
    if (pain.length) lines.push(fillText(tpl('summary.pain', SUMMARY_FORMAT.pain), [pain[0]]));
    // 11/18 문진 재설계: 통증 양상(P3), 일상생활 불편 정도(N12)
    const quality = slotEntries(slots, 'detail.pain_quality').map((e) => show(displayRef(e, data))).filter(Boolean);
    if (quality.length) lines.push(`${tpl('summary.painQuality', SUMMARY.painQuality)}: ${quality[0]}`);
    const impact = slotEntries(slots, 'detail.daily_impact').map((e) => show(displayRef(e, data))).filter(Boolean);
    if (impact.length) lines.push(`${tpl('summary.dailyImpact', SUMMARY.dailyImpact)}: ${impact[0]}`);
    // 11/18: 본인 상담이면 사용자가 저장한 건강정보(약·기존 질환·알레르기)를 그대로 적는다(문진에서 묻지 않음)
    const saved = savedHealthLines(profileInfo);
    for (const [key, value] of saved) lines.push(`${tpl(`summary.${key}`, SUMMARY[key])}: ${value}`);
    // 11/17 요약 말투: 진료과는 순위를 붙여(2개 이상), 1개뿐이면 순위 없이. 바로 다음 줄에 경로별 순위 설명
    if (departments.length) {
      const name = (d) => (d.deptId ? need('department', d.deptId, d.nameKo) : need('department', '', d.nameKo));
      const names = departments.length === 1 ? name(departments[0])
        : departments.map((d, i) => fillText(tpl('summary.departmentRank', SUMMARY_FORMAT.departmentRank), [i + 1, name(d)])).join(' / ');
      lines.push(`${tpl('summary.departments', SUMMARY.departments)}: ${names}`);
      if (group !== undefined) lines.push(group === null ? tpl('summary.deptNoteStats', SUMMARY.deptNoteStats) : tpl('summary.deptNoteFallback', SUMMARY.deptNoteFallback));
    }
    lines.push(saved.length ? tpl('summary.uncheckedWithProfile', SUMMARY.uncheckedWithProfile) : tpl('summary.unchecked', SUMMARY.unchecked));
    lines.push(tpl('summary.footer', SUMMARY.footer));
    return clip(lines);
  });
}

/** 저장한 건강정보 한 칸의 최대 길이(요약 2000자 안에 들게) */
export const SAVED_HEALTH_MAX = 200;
/**
 * 11/18: 요약에 넣을 저장한 건강정보 [키, 값] 목록. 빈 값은 뺀다. 줄바꿈은 공백으로, 길이는 SAVED_HEALTH_MAX자까지.
 * @param {{medications?:string, history?:string, allergies?:string}|null} profileInfo 본인 상담일 때만 넘긴다(runCare)
 */
export function savedHealthLines(profileInfo) {
  if (!profileInfo || typeof profileInfo !== 'object') return [];
  const clean = (v) => (typeof v === 'string' ? v.replace(/[\r\n]+/g, ' ').trim().slice(0, SAVED_HEALTH_MAX) : '');
  return [['profileMedications', clean(profileInfo.medications)], ['profileHistory', clean(profileInfo.history)], ['profileAllergies', clean(profileInfo.allergies)]]
    .filter(([, v]) => v);
}

/**
 * 119 정리 요약(응급 E 문항 끝난 뒤). slots.card의 답한 것만. 정리할 줄이 없으면 null(번역이 모자란 언어도 null).
 */
export function buildEmergencySummary({slots, data, tx = KO_TEXT}) {
  let empty = false;
  const text = orNull(() => {
    const {need, tpl, show} = texts(tx);
    const lines = [];
    for (const [key, value] of Object.entries(slots.card ?? {})) {
      const slot = `card.${key}`;
      for (const e of Array.isArray(value) ? value : [value]) {
        const d = show(displayRef(e, data));
        if (!d) continue;
        const itemKo = data.itemById.get(e.question)?.textKo ?? null;
        const name = CARD_SLOT_LABELS[slot] ? tpl(`card_slot.${slot}`, CARD_SLOT_LABELS[slot]) : (itemKo ? need('item', e.question, itemKo) : null);
        if (name) lines.push(`${name}: ${d}`);
      }
    }
    if (lines.length === 0) { empty = true; return null; }
    return clip([tpl('summary.emergencyHeader', SUMMARY.emergencyHeader), ...lines]);
  });
  return empty ? null : text;
}

/** 약 정보 안내(MED_CHOICE = med_info). */
export function buildMedInfoSummary({tx = KO_TEXT} = {}) {
  return orNull(() => texts(tx).tpl('summary.medInfo', SUMMARY.medInfo));
}
