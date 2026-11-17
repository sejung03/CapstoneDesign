// 오류 종류. 설계 4절 StructuredResult.error + 5-8 표.
// 모든 오류는 증상 분류에서 fallback 문진, 건강정보 추출에서 items:[]로 간다(정상·비응급으로 보지 않는다).

export const LLM_ERRORS = Object.freeze([
  'timeout',          // 1회 제한 또는 전체 예산 초과
  'rate_limit',       // 429
  'server',           // 5xx, 어댑터 내부 예외
  'network',          // 연결 실패
  'blocked',          // 업체 안전 필터 차단
  'bad_json',         // JSON 파싱 실패·스키마 위반
  'aborted',          // 프론트 signal 취소
  'not_implemented',  // 어댑터 미구현(gemini·openai 자리), mock 사례 없음
  'no_consent',       // 동의 없음 → LLM 호출 안 함
  'quota',            // 429 insufficient_quota — 잔액·한도 부족 (L4 M1, 재시도 안 함)
  'auth',             // 401·403, 키 없음 (L4 M1, 재시도 안 함)
  'bad_request',      // 400·404·422 — 요청 형식 오류 (L4 M1, 재시도 안 함)
]);

/** 실제 호출을 그 자리에서 멈춰야 하는 오류(L4 진짜 멈춤 조건). */
export const STOP_ERRORS = Object.freeze(['auth', 'quota']);

/** 1회 재시도하는 오류(설계 5-9: 429·5xx·네트워크만). */
export const RETRYABLE_ERRORS = Object.freeze(['rate_limit', 'server', 'network']);

export function isRetryable(error) {
  return RETRYABLE_ERRORS.includes(error);
}
