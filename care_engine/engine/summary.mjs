// 요약(설계 §8-2·§8-4). 표시 문구(선택지 문구·증상 이름·템플릿)만 조합한다. 사용자 원문·질환명 없음.
import {SUMMARY, COURSE_SLOT_LABELS, CARD_SLOT_LABELS, DERIVED_VALUE_LABELS} from './templates.mjs';
import {slotEntries} from './slots.mjs';

export const SUMMARY_MAX = 2000;
/** 상담 대상 문항. 결과 매핑 slot이 없어서 ID로 읽는 유일한 예외(설계 §0 1번). */
export const TARGET_ITEM_ID = 'T1';

/** slot 값(답 code 또는 매핑 value) → 원래 문항의 선택지 표시 문구. */
export function displayOf(entry, data) {
  if (!entry) return null;
  const opt = entry.question ? (data.optionsById.get(entry.question) ?? []).find((o) => o.code === entry.value) : null;
  if (opt) return opt.displayKo;
  if (Object.hasOwn(DERIVED_VALUE_LABELS, entry.value)) return DERIVED_VALUE_LABELS[entry.value];
  return null; // 표시할 수 없는 값은 쓰지 않는다
}

function clip(lines) {
  let text = lines.filter(Boolean).join('\n');
  if (text.length > SUMMARY_MAX) text = text.slice(0, SUMMARY_MAX);
  return text;
}

/**
 * 일반 요약.
 * @param {{slots:object, codes:Map, symptom:object|null, departments:Array<{nameKo}>, data:object, safetyUnanswered:boolean}} input
 * @returns {string}
 */
export function buildSummary({slots, codes, symptom, departments = [], data, safetyUnanswered = false}) {
  const lines = [];
  if (safetyUnanswered) lines.push(SUMMARY.safetyUnanswered);
  lines.push(SUMMARY.header);
  const target = displayOf(codes.has(TARGET_ITEM_ID) ? {value: codes.get(TARGET_ITEM_ID), question: TARGET_ITEM_ID} : null, data);
  if (target) lines.push(`${SUMMARY.target}: ${target}`);
  lines.push(`${SUMMARY.symptom}: ${symptom?.nameKo ?? SUMMARY.symptomUnknown}`);
  const onset = slotEntries(slots, 'report.onset').map((e) => displayOf(e, data)).filter(Boolean);
  if (onset.length) lines.push(`${SUMMARY.onset}: ${onset.join(', ')}`);
  const course = [];
  for (const slot of ['detail.continuous', 'detail.worsening']) {
    for (const e of slotEntries(slots, slot)) {
      const d = displayOf(e, data);
      if (d) course.push(COURSE_SLOT_LABELS[slot] ? `${COURSE_SLOT_LABELS[slot]}(${d})` : d);
    }
  }
  for (const e of slotEntries(slots, 'report.notes')) {
    const d = displayOf(e, data);
    if (d) course.push(d);
  }
  if (course.length) lines.push(`${SUMMARY.course}: ${course.join(', ')}`);
  const pain = slotEntries(slots, 'detail.pain_score').map((e) => displayOf(e, data)).filter(Boolean);
  if (pain.length) lines.push(SUMMARY.pain(pain[0]));
  if (departments.length) lines.push(`${SUMMARY.departments}: ${departments.map((d) => d.nameKo).join(', ')}`);
  lines.push(SUMMARY.unchecked);
  lines.push(SUMMARY.footer);
  return clip(lines);
}

/**
 * 119 정리 요약(응급 E 문항 끝난 뒤). slots.card의 답한 것만. 정리할 줄이 없으면 null.
 */
export function buildEmergencySummary({slots, data}) {
  const lines = [];
  for (const [key, value] of Object.entries(slots.card ?? {})) {
    const slot = `card.${key}`;
    for (const e of Array.isArray(value) ? value : [value]) {
      const d = displayOf(e, data);
      if (!d) continue;
      const name = CARD_SLOT_LABELS[slot] ?? data.itemById.get(e.question)?.textKo ?? null;
      if (name) lines.push(`${name}: ${d}`);
    }
  }
  if (lines.length === 0) return null;
  return clip([SUMMARY.emergencyHeader, ...lines]);
}

/** 약 정보 안내(MED_CHOICE = med_info). */
export function buildMedInfoSummary() {
  return SUMMARY.medInfo;
}
