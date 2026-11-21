// 다음 문항 결정(설계 §4-3). order 오름차순으로 처음 만나는 "물을 문항" 하나.
// 증상 확인은 데이터 문항이 아니므로 증상 문항(report.symptom 매핑, N4) 자리에 끼워 넣는다.
import {isVisible} from './answers.mjs';

/**
 * 구조상 묻지 않는 문항이면 그 이유, 아니면 null.
 * @param {'pending'|'known'|'fallback'|'unknown'} symptomState
 */
export function structuralSkipReason(item, symptomState) {
  if (item.todo) return 'todo';
  if (item.ui === 'frontend') return 'frontend';
  if (item.type !== 'choice') return item.type; // string(N4 포함)·display
  if (item.engineCondition === 'symptom_is_fallback' && symptomState !== 'fallback' && symptomState !== 'unknown') return 'engine_condition';
  return null;
}

/**
 * @param {{codes:Map<string,string>, data:object, mode?:'normal'|'emergency'|'stopped', symptomState?:string}} input
 *   codes: 정리한 답 전체(보이는지는 여기서 판단). symptomState: 'pending'(아직 안 정함)·'known'·'fallback'·'unknown'
 * @returns {{kind:'item', item:object, skippedItems:string[]} | {kind:'identify', skippedItems:string[]} | {kind:'done', skippedItems:string[]}}
 *   skippedItems: 보이고 답이 없지만 구조상 묻지 않은 문항 ID(trace용)
 */
export function nextQuestion({codes, data, mode = 'normal', symptomState = 'pending'}) {
  const skippedItems = [];
  if (mode === 'stopped') return {kind: 'done', skippedItems};
  const symptomItem = data.itemById.get(data.symptomItemId);
  const identifyAt = symptomItem ? symptomItem.order : Infinity;
  const identifyOpen = mode === 'normal' && symptomState === 'pending' && symptomItem && isVisible(symptomItem.linkId, codes, data);
  for (const item of data.items) {
    if (mode === 'emergency' && item.flow !== 'emergency') continue;
    if (codes.has(item.linkId) && isVisible(item.linkId, codes, data)) continue; // 이미 답함
    if (!isVisible(item.linkId, codes, data)) continue;
    const why = structuralSkipReason(item, symptomState);
    if (why) { skippedItems.push(item.linkId); continue; }
    if (identifyOpen && item.order > identifyAt) return {kind: 'identify', skippedItems};
    return {kind: 'item', item, skippedItems};
  }
  if (identifyOpen) return {kind: 'identify', skippedItems};
  return {kind: 'done', skippedItems};
}

/**
 * 문항 → 프론트 followUp(BACKEND.md 0.20.0). id = link_id, 선택지 id = code.
 * @param {'ko'|'en'} [locale] v1 데이터에는 en이 없다. 있으면 함께 넣는다.
 */
export function itemToFollowUp(item, data, locale = 'ko') { // eslint-disable-line no-unused-vars
  const label = (ko, en) => (en ? {ko, en} : {ko});
  return {
    id: item.linkId,
    type: 'singleChoice',
    required: item.required,
    label: label(item.textKo, item.textEn),
    options: (data.optionsById.get(item.linkId) ?? []).map((o) => ({id: o.code, label: label(o.displayKo, o.displayEn)})),
  };
}

/** 엔진이 어떤 경우에도 묻지 않는 문항(todo·frontend·string·display). engine_condition 문항은 조건에 따라 묻는다. */
export function neverAskedItems(data) {
  return data.items.filter((it) => it.todo || it.ui === 'frontend' || it.type !== 'choice').map((it) => it.linkId);
}
