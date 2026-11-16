// 엔진 코드가 ID로 읽는 데이터 문항(설계 §0 1번의 예외 목록). 11/17 EF(G6): 흩어져 있던 상수를 여기 한 곳에 모은다.
// 엔진 질문 5개 ID는 templates.mjs의 ENGINE_Q, engine_condition 값은 intake-data.mjs의 검사 목록에 있다.

/** 상담 대상(T1). 결과 매핑 slot이 없어서 ID로 읽는다(요약의 상담 대상 줄, 건강정보 후보는 본인일 때만). */
export const TARGET_ITEM_ID = 'T1';
/** T1에서 '본인'을 뜻하는 code. */
export const TARGET_SELF = 'self';

/**
 * 다쳐서 생긴 증상(F2). 11/17 EF(G6): engine_condition `symptom_is_fallback` 문항 중 결과 매핑 slot이 있으면
 * 그 slot으로 읽으려 했으나, 시드 v2.1-20261113의 F2에는 결과 매핑 slot이 없다(output_mapping.csv에 F2 행 없음).
 * 그래서 ID로 읽고 설계 §0 예외 목록에 F2를 적었다. slot이 생기면 그 slot으로 바꾼다.
 */
export const INJURY_ITEM_ID = 'F2';
/** F2에서 '예'를 뜻하는 code. */
export const INJURY_YES = 'yes';
