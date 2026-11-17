// Gemini 어댑터 자리 — 미구현. 네트워크 코드·import 없음. 항상 not_implemented를 돌려준다.
//
// 연결할 때 할 일(설계 4절):
// 1. 공통 스키마(schemas.mjs)를 업체 형식으로 넘긴다: responseMimeType: 'application/json' + responseSchema.
// 2. temperature: 0, 모델 "버전명"을 고정한다(별칭 금지). 모델명은 config.model(LLM_MODEL)에서.
// 3. 업체 오류를 error 값(timeout|rate_limit|server|network|blocked|bad_json|aborted)으로 바꾼다.
//    예외를 밖으로 던지지 않는다. req.signal(취소)과 req.timeoutMs를 지킨다.
// 4. 응답 원문과 입력을 로그에 남기지 않는다. meta에는 provider·model·latencyMs·토큰 수만.
// 그 밖: API 키(GEMINI_API_KEY)는 서버 환경변수에서만 읽는다. 연결 전 약관 확인(설계 11-1),
//        업체명이 들어간 동의 버전 확정(BACKEND.md "외부 AI 업체 미확정 시 연결 기준").

export function createGeminiProvider({model = null} = {}) {
  return {
    name: 'gemini',
    model,
    async generateStructured() {
      return {ok: false, error: 'not_implemented', meta: {provider: 'gemini', model, latencyMs: 0}};
    },
  };
}
