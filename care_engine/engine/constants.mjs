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

// ---- 11/17 RF2: 위험 표현 확인 질문(RISK_CONFIRM) ----
/**
 * 확인 질문 ID는 `RISK_CONFIRM_<n>`이다. n은 질문을 낼 때까지의 사용자 메시지 수(엔진의 userMessages 기준).
 * 엔진은 상태가 없으므로 "어느 메시지까지 확인했는가"를 이 ID로 다시 계산한다(답은 followUpAnswers에 질문 ID별로 남는다).
 */
export const RISK_CONFIRM_PREFIX = 'RISK_CONFIRM_';
export const RISK_CONFIRM_ID_RE = /^RISK_CONFIRM_(\d{1,4})$/;
export const RISK_ANSWERS = Object.freeze({yes: 'risk_yes', no: 'risk_no', unsure: 'risk_unsure'});
/** 같은 범위의 확인 질문을 몇 번까지 내는가(그 뒤에도 답이 없으면 '잘 모르겠어요'로 처리). */
export const RISK_CONFIRM_MAX_ASKS = 2;
/** 확인 질문 대상 message_key(EMERGENCY_STOP·민감 안내는 대상이 아님). */
export const RISK_CONFIRM_KEY = 'freetext_urgent';

// ---- 11/17 RF3: 민감 안내(확인 질문·문진·LLM 없이 기관 안내만, 내용을 남기지 않음) ----
export const SENSITIVE_KEYS = Object.freeze(['crisis_notice_109', 'threat_notice_112', 'violence_notice_1366']);
export const SENSITIVE_CHOICE_PREFIX = 'SENSITIVE_CHOICE_';
export const SENSITIVE_CHOICE_ID_RE = /^SENSITIVE_CHOICE_(\d{1,4})$/;
export const SENSITIVE_ANSWERS = Object.freeze({end: 'sens_end', continue: 'sens_continue'});
export const SENSITIVE_CHOICE_MAX_ASKS = 2;
/**
 * 11/17 RF6(검토 S2): 민감 규칙이 놓친 문장도 LLM으로 보내지 않기 위한 넓은 단서(정규화·공백 없는 문자열 기준).
 * 걸리면 증상 분류·건강정보 추출 LLM을 부르지 않는다(판정에는 쓰지 않음, trace에도 남기지 않음).
 */
export const SENSITIVE_CUE_RE = /(때려|때렸|때리|맞았|폭행|폭력|협박|위협|스토킹|스토커|성추행|성폭|강간|추행|몰카|몰래카메라|죽이겠|죽이려|죽여버|해치|자살|자해|죽고싶|죽고십)/;
/** 규칙이 놓친 민감 단서를 기관별로 고른다. 우선순위는 112 > 1366 > 109. */
export const SENSITIVE_CUE_BRANCHES = Object.freeze([
  {messageKey: 'threat_notice_112', re: /(협박|위협|죽이겠|죽이려|죽여버|해치)/},
  {messageKey: 'violence_notice_1366', re: /(때려|때렸|때리|맞았|폭행|폭력|스토킹|스토커|성추행|성폭|강간|추행|몰카|몰래카메라)/},
  {messageKey: 'crisis_notice_109', re: /(자살|자해|죽고싶|죽고십)/},
]);

