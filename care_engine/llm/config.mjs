// 설정 상수. (L3에서 환경변수 읽기·시간 예산·버전을 덧붙인다)

/**
 * 건강정보 추출 신호어(설계 6-1). 메시지(normalizeTerm 후)에 하나라도 있으면 추출 호출.
 * 설계 목록 그대로이며 "등"으로 열린 부분은 넣지 않았다(팀 검토 대상, 설계 11-4).
 */
export const PROFILE_SIGNAL_WORDS = Object.freeze([
  '살', '세', '나이', '약', '복용', '먹고 있', '알레르기', '앓', '진단', '수술', '병력',
]);

export const MAX_PICKS = 10;
export const PROFILE_MAX_ITEMS = 4;
export const PROFILE_VALUE_MAX = 500;
export const PROFILE_QUOTE_MAX = 500;
