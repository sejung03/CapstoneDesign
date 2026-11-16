// 결과 매핑(설계 §5). output_mapping을 보이는 답과 걸린 규칙에 적용해 slot을 채운다.
// 각 값은 {value, question}(question = 원래 문항 ID, 규칙이면 rule_id). 같은 slot에 값이 여러 개면 배열.

const GROUPS = ['card', 'filter', 'detail', 'report', 'flow'];

function put(slots, slot, entry) {
  const [group, key] = slot.split('.');
  const g = slots[group];
  if (!(key in g)) g[key] = entry;
  else if (Array.isArray(g[key])) g[key].push(entry);
  else g[key] = [g[key], entry];
}

/** slot 값을 항상 배열로 읽는다. */
export function slotEntries(slots, slot) {
  const [group, key] = slot.split('.');
  const v = slots?.[group]?.[key];
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * @param {{codes:Map<string,string>, ruleHits:Array<{ruleId:string}>, data:object, symptom?:{id:string, nameKo:string}|null}} input
 *   codes: 보이는 문항의 답만(visibleCodes)
 * @returns {{card:object, filter:object, detail:object, report:object, flow:object}}
 */
export function applyMappings({codes, ruleHits = [], data, symptom = null}) {
  const slots = Object.fromEntries(GROUPS.map((g) => [g, {}]));
  const hitIds = new Set(ruleHits.map((h) => h.ruleId));
  for (const m of data.mappings) {
    if (m.from === 'answer') {
      if (!codes.has(m.question)) continue;
      const code = codes.get(m.question);
      if (m.when !== 'any' && m.when !== code) continue;
      put(slots, m.slot, {value: m.value ?? code, question: m.question});
    } else if (m.from === 'rule' && hitIds.has(m.ruleId)) {
      put(slots, m.slot, {value: m.value, question: m.ruleId});
    }
  }
  // 진료과 필터: 미응답이면 unknown(설계 §5)
  if (!('sex' in slots.filter)) slots.filter.sex = {value: 'unknown', question: null};
  if (!('age_band' in slots.filter)) slots.filter.age_band = {value: 'unknown', question: null};
  // 분석서의 주된 증상: 확정 증상 이름(사용자 원문 아님). 모르면 비움.
  if (symptom && symptom.nameKo) slots.report.symptom = {value: symptom.nameKo, question: data.symptomItemId, symptomId: symptom.id};
  return slots;
}
