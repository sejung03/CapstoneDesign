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
 * 11/17 LCR1: 민감 단서를 두 갈래로 나눈다(LC 재개 지시서 "이번에 정한 것 1").
 *  - 강한 단서(SENSITIVE_NOTICE_CUE_RE): 그 말 자체가 피해·위협·자살을 뜻하는 것. 규칙이 못 잡았을 때 민감 안내 선택을 띄우고,
 *    그 요청과 대화에서 LLM을 부르지 않는다(RF6 판단 #10의 차단 범위도 이것으로 좁아짐).
 *  - 넓은 단어(맞았·때리·때려·때렸·위협·해치): 아무 처리도 하지 않는다. 일반 흐름으로 가서 규칙과 LLM 위험 신호가 판단한다.
 *    ("독감 주사 맞았는데 열이 나요"가 1366 안내로 가던 문제, dev none 278건 중 71건 오탐)
 * 정규화(normalizeTerm: NFKC·소문자·공백 제거)한 문자열 기준. 원문·걸린 위치는 trace에 남기지 않는다.
 * '죽고십'은 '죽고 싶'의 흔한 오타라 같은 단서로 둔다.
 */
export const SENSITIVE_NOTICE_CUE_RE = /(폭행|성폭|성추행|추행|강간|스토킹|스토커|몰카|몰래카메라|협박|자살|자해|죽고싶|죽고십|죽이겠|죽이려|죽여버)/;
/**
 * 강한 단서 바로 앞뒤(약 8자 창, RF4 방식)의 쓰임 제외. 예방·교육·작품·뉴스·정보 질문 쓰임은 안내하지 않는다.
 * '법'은 '방법'과 겹치지 않게 앞 글자가 '방'이 아닐 때만 본다("자살 방법"은 제외하지 않음 — 보수적).
 */
// LCR1 보강(dev 강한 단서 오탐 16건 → 10건 이하 목표): 단어는 빼지 않고, 지시서 목록에 같은 성격의 쓰임을 더했다.
//  - 예능·방송: 영화·드라마와 같은 작품 쓰임 / 전해 들은 말(…했대·받았대·당했대·했다더): 남의 일
//  - 신고하는방법: '신고 방법'의 띄어쓰기 변형
export const SENSITIVE_CUE_CONTEXT_RE = /(예방|교육|캠페인|영화|드라마|뉴스|기사|게임|소설|웹툰|수업|과제|숙제|(?<!방)법|처벌|신고방법|신고하는방법|뜻이뭐|이란|예능|방송|했대|받았대|당했대|했다더|당했다더)/;
export const SENSITIVE_CUE_WINDOW = 8;
/**
 * 피해자가 '나'인 서술은 쓰임 제외 근처여도 단서로 본다(RF6 판단 #15와 같은 원칙: 폭력 피해 서술).
 * 1인칭 목적·여격 표현, 또는 직접 겪었다는 서술(전해 들은 '당했다는·당했대'는 아님). 1366 갈래에만 쓴다.
 */
export const SENSITIVE_CUE_SELF_RE = /(나를|저를|나한테|저한테|나에게|저에게|내몸|제몸|당했(?!다는|대|다더|다고들)|당하고있|당하는중|당해서|당한것같|시달리)/;
/**
 * 강한 단서를 기관별로 고른다. 우선순위는 112 > 1366 > 109.
 *  - near: 갈래별로 더 보는 바로 앞뒤 쓰임 제외(공통 SENSITIVE_CUE_CONTEXT_RE와 함께 본다)
 *  - anywhere: 문장 어디에 있어도 그 갈래 단서를 넘기는 쓰임(112만: 규칙 FT-THREAT-01의 장난·사소한 이유 제외와 같은 목록).
 *    "숙제 때문에 엄마가 나를 죽이려고 해"처럼 이유가 창 밖에 오는 과장 표현용.
 *  - selfOverride: 피해자가 '나'인 서술이면 쓰임 제외를 보지 않음(1366만).
 * 109는 공통 쓰임 제외만 본다(정보 질문 '알려줘' 등은 109에서 제외하지 않음 — "자살 방법 알려줘"를 놓치지 않기 위해).
 * 쓰임 제외로 넘긴 문장은 버리는 것이 아니라 일반 흐름(규칙 → LLM 위험 신호)으로 간다.
 */
export const SENSITIVE_CUE_BRANCHES = Object.freeze([
  {messageKey: 'threat_notice_112', re: /(협박|죽이겠|죽이려|죽여버)/g,
    near: /(듯이|스팸|해고)/,
    anywhere: /(장난|농담|ᄏᄏ|ᄒᄒ|게임|과자|푸딩|성적|시험|숙제|망하면|안하면|틀리면|놀리면|늦으면|입으면|먹어서|먹었)/,
    selfOverride: false},
  {messageKey: 'violence_notice_1366', re: /(폭행|성폭|성추행|추행|강간|스토킹|스토커|몰카|몰래카메라)/g,
    near: /(상담소|센터|위치|알려줘|알려주세요|어디서|어디에)/, anywhere: null, selfOverride: true},
  {messageKey: 'crisis_notice_109', re: /(자살|자해|죽고싶|죽고십)/g, near: null, anywhere: null, selfOverride: false},
]);

