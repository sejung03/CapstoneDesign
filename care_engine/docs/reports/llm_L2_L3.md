# LLM 모듈 L2·L3 보고 — 스키마·검사·확인 질문·공개 함수·평가 틀

> 2026-11-15. 브랜치 `llm-module`. 지시서 L2·L3. 네트워크 호출·API 키·.env·npm 패키지 없음.
> 사용자 원문은 이 보고서에 없다(가짜 평가 사례도 case id로만 적는다).

## 1. 파일 목록

L2 (커밋 `c39d412`)

| 파일 | 내용 |
|---|---|
| `llm/schemas.mjs` | `symptomPickSchema(candidateIds)`, `profileExtractSchema()`, `assertPortableSchema()` |
| `llm/prompts/symptom_v1.mjs`, `llm/prompts/profile_v1.mjs` | `{id, system, buildUser}` |
| `llm/validate.mjs` | `validateSymptomPick`, `validateProfileItems` |
| `llm/confirm-question.mjs` | `buildSymptomConfirm`, `parseSymptomConfirm`, `checkFollowUpContract` |
| `llm/copy.mjs` | 확인 질문 문구 상수(ko) |
| `llm/profile-trigger.mjs` | `shouldExtractProfile`, `hasProfileSignal` |
| `llm/config.mjs` | 신호어 목록·상한 상수(L3에서 확장) |
| 테스트 | schemas 9, prompts 3, validate 22, confirm-question 8, profile-trigger 4 |

L3

| 파일 | 내용 |
|---|---|
| `llm/errors.mjs` | 오류 9종(`not_implemented`, `no_consent` 추가), 재시도 대상 |
| `llm/provider.mjs` | 인터페이스 JSDoc, `getProvider()` (LLM_PROVIDER, 기본 mock) |
| `llm/providers/gemini.mjs`, `openai.mjs` | 항상 `not_implemented`. 상단 주석에 연결 체크리스트. import·fetch 없음(테스트로 확인) |
| `llm/providers/mock.mjs` | `createMockProvider(fixtures, {defaults})` — (입력 텍스트 → 응답), 오류 흉내, `delayMs`, signal, 배열 응답 |
| `llm/config.mjs` | `getConfig(env)` 설계 8절 값, `versions` |
| `llm/index.mjs` | `classifySymptom`, `extractProfileUpdates`, `hasExternalAiConsent` |
| `eval/cases/draft_v0.jsonl` + `README.md` | 가짜 사례 30개(초안 라벨) |
| `eval/fixtures/mock_v0.json` | 사례별 mock 응답(case id 기준) |
| `eval/run_eval.mjs`, `eval/compare.mjs` | 지표 계산, 두 결과 비교 |
| `README.md` | 폴더 구조, 실행법, mock 전용, 업체 연결 파일 2개·체크리스트 |
| 테스트 | provider 11, config 3, index 24, eval 7 |

## 2. 테스트

| 시점 | `npm test` |
|---|---|
| L1 끝 | 35 통과 / 0 실패 |
| L2 끝 | 81 통과 / 0 실패 |
| L3 끝 | **127 통과 / 0 실패** |

## 3. mock 평가 결과 (`--repeat 3`)

`node eval/run_eval.mjs --cases eval/cases/draft_v0.jsonl --provider mock --fixtures eval/fixtures/mock_v0.json --repeat 3`
fixture 구성: 정답 포함 20, 정답 없음 4, 형식 위반 2, timeout 2, 엉뚱한 ID 2. (증상 정답 있는 사례 22, 없는 사례 8)

| 지표 | 결과 | fixture 설계상 기대 | 일치 |
|---|---|---|---|
| 실패율 | 4/30 (0.133) | timeout 2 + 형식 위반 2 = 4 | ✅ |
| 실패 사유 | timeout 2, bad_json 2 | 같음 | ✅ |
| Recall@10 | 15/22 (0.682) | 정답 포함 증상 사례 15 | ✅ |
| Top-1 | 14/22 (0.636) | c12만 정답이 2순위 | ✅ |
| no_match 정확도 | 8/8 | 증상 아닌 8개 모두 확인 질문 없음 | ✅ |
| 의도 정확도 | 26/30 (0.867) | 실패 4개만 의도 없음 | ✅ |
| profile 정밀도 | 4/5 (0.8) | c30에 다른 사람 약을 일부러 넣음 | ✅ |
| profile 재현율 | 4/4 (1.0) | | ✅ |
| 후보 Recall@10·20·40·60 (retrieve) | 15/22 (모든 K 같음) | — | |
| 실제 보낸 후보에 정답 | 16/22 | c29는 retrieve 0개 → all 모드 | |
| 응급 놓친 비율 | **미측정** (gold_emergency 3건) | 안전 규칙 엔진 없음 | |
| 지연 p50 / p95 | 3ms / 7ms (mock) | — | |
| 반복 일치율 | 30/30 | mock은 결정적 | ✅ |

이 수치는 `eval/__tests__/run_eval.test.mjs`에 고정했다(fixture를 바꾸면 테스트가 알려 준다).

**초안 사례에서 드러난 후보 생성 한계(실제 정보)**: 바꿔 말한 표현 22개 중 6개(c01·c07·c08·c09·c11·c27)는 정답이 retrieve 후보 60개 안에도 없다. 놓친 경우는 모두 순위 문제가 아니라 글자 겹침이 없는 경우다(L1 leave-one-out과 같은 경향). 이 6개는 LLM이 아무리 정확해도 맞힐 수 없으므로, mock 응답도 enum 안에서만 골랐고(정답 없음 4개로 배정) 사례 문장은 고치지 않았다. `CANDIDATE_MODE=all` 비교가 필요하다는 근거다.

## 4. 로그에 원문이 남지 않는지

- `index.test.mjs`: 테스트 문장에 고유 표지 문자열(`표지QZ7`)과 전화번호를 넣고, 모든 로그 이벤트를 JSON으로 합친 문자열에 표지·전화번호·문장 일부·profile quote/value(`혈압약`, `땅콩`, `32살`)가 없는지 검사 → **통과**. 어댑터가 표지를 담은 예외를 던져도 로그에 없음.
- `meta`에도 표지가 없음을 검사.
- 평가 결과 파일: 테스트로 30개 사례 원문·profile 값이 결과 JSON에 없음을 검사 → 통과. 실제 생성 파일 `eval/out/*_mock.json`에서도 사례 단어 검색 0건.
- 로그에 남기는 것: requestId, reason, provider, model, promptId, schemaId, dataVersion, 후보 개수·모드, picks ID, status, intent, 결과·fallback 사유, error, 지연, 시도 횟수, dropped 개수, 토큰 수. profile은 field 이름과 개수만.

## 5. 동작 요약

`classifySymptom`: 동의 확인 → maskPii → 500자(마지막) → buildCandidates(0개면 `all`) → 스키마·프롬프트 → provider(1회 4초, 전체 7초, `deadlineAt`이 더 이르면 그것) → validate → intent≠symptom이면 `route` → picks 있으면 `confirm`, 없으면 `fallback`.
재시도: `rate_limit`·`server`·`network`만 1회, 남은 시간 ≥ 3000ms일 때만. `timeout`·`bad_json`·`blocked`은 재시도 안 함. 어댑터가 늦거나 예외를 던져도 바깥에서 끊고 `timeout`·`server`로 바꾼다.

## 6. 설계 문서와 다르게 한 곳

1. **symptom_v1 프롬프트의 후보 목록 위치**: 설계 5-5는 "증상 목록: {candidates}"를 지시문 끝에 둔다. 지시서가 `system: string`(고정)을 요구해서 규칙 1~6은 system에, 후보 목록과 사용자 문장은 user에 넣었다(`증상 목록:\n…\n\n사용자 문장:\n…`). 문구 자체는 그대로.
2. **profile_v1 프롬프트**: 설계 6-3은 핵심 규칙 4개만 있다. 역할·항목 설명, age는 숫자만, messageIndex 뜻을 덧붙였다. 규칙 3은 "상담 대상이 본인일 때 제외(T1은 엔진이 넘김)"인데 T1을 아직 받지 않으므로 **항상 제외**로 썼다.
3. **quote 검사 강화**: 설계 6-4는 "정규화 후 부분 문자열". 프론트(`frontend/health-updates.mjs:35`)는 `message.includes(quote)`로 원문 그대로 검사하고 하나라도 틀리면 **전체 profileUpdates를 거절**한다. 그래서 정규화 검사 + 원문 포함 검사를 둘 다 요구한다(띄어쓰기만 다른 quote는 버림).
4. **확인 질문 en 문구 없음**: 설계에 en 문구가 없어 만들지 않았다(ko만). locale=en이어도 ko만 나간다(설계 11-5와 같은 미결).

## 7. 지시에 없던 판단

(보수적인 쪽을 골랐다. 다른 선택지를 함께 적는다.)

1. **동의 형식**: `consent = {granted:true, provider:'<업체명>', version:'<버전>', healthInfo?:true}`이고 `provider`가 현재 업체 이름과 같아야 인정. `true` 같은 포괄 동의는 `no_consent`(BACKEND.md "업체명을 생략한 포괄 동의를 실제 전송 권한으로 취급하지 않습니다"). 건강정보 추출은 `healthInfo:true`도 필요. 다른 선택지: 불리언 동의 허용 → 계약 위반 위험. **팀원 3(서버)과 동의 객체 형식 합의 필요.**
2. **건강정보 추출은 신호어가 있는 메시지만 보낸다**(원래 번호 유지). 보내지 않은 메시지를 가리키는 항목은 버린다. 다른 선택지: 메시지 전체 전송 → 외부로 나가는 정보가 늘어남.
3. **건강정보 메시지도 PII 가림 + 메시지마다 마지막 500자**. 가려진 부분을 quote로 돌려주면 원문과 달라 버려진다(안전한 방향).
4. **`no_match`·`unclear`인데 picks가 있으면 picks를 버린다**(설계 5-8대로 fallback). 다른 선택지: picks가 있으면 확인 질문 → LLM이 확신 없다고 한 결과를 보여 주게 됨.
5. **picks 검사에 "후보 가능 여부"도 넣음**: 후보 집합 밖·없는 ID뿐 아니라 fallback·상위 증상 ID도 `unknownId`로 버린다.
6. **profile field 중복은 원래 순서의 첫 항목만**: 첫 항목이 검사에 실패해도 뒤 항목으로 대신하지 않는다(그 field는 비움). 다른 선택지: 첫 "유효" 항목 사용.
7. **age 값은 `String(Number(v))`로 정리**("032"→"32"), quote 안 숫자와 수치로 비교. 한글 숫자("서른")는 버린다.
8. **parseSymptomConfirm의 이상한 답은 `reason:'invalid'`**: 지시서는 `none|unsure`만 적었지만, 없는 ID·fallback 증상·상위 증상을 고른 답을 `unsure`로 섞으면 로그에서 구별이 안 돼 값을 하나 더했다. status는 똑같이 `fallback`이라 흐름은 같다. 다른 선택지: `unsure`로 합치기.
9. **빈 입력·후보 0개(all 모드에서도)**: LLM을 부르지 않고 `fallback`/`no_match`(meta.error는 null).
10. **모르는 `LLM_PROVIDER`는 오류**(조용히 mock으로 바꾸지 않음). 실서버에서 설정 실수가 mock 응답으로 이어지는 것을 막는다. 숫자 환경변수가 잘못되면 기본값.
11. **`LLM_MAX_CONCURRENCY`는 읽기만 하고 제한은 구현하지 않음**: 실제 업체가 없어서 의미가 없고, 대기 시간이 시간 예산을 잡아먹는 방식을 정해야 한다. 업체 연결(L4) 때 구현.
12. **mock fixtures는 case id 기준 파일 → 실행 때 (사례 문장 → 응답) 맵으로 바꿈**. mock은 user 문자열이 그 문장으로 끝나는지로 찾는다(가장 긴 키 우선). 프롬프트에 case id는 들어가지 않는다. 사례가 없으면 `defaults[schemaName]`, 그것도 없으면 `not_implemented`.
13. **mock 형식 위반 2개**는 "JSON이 중간에 끊김"(c11)과 "스키마 밖 status 값"(c22)으로 나눴다. 엉뚱한 ID 중 c20은 의도는 맞고 picks만 엉뚱해서 `route`로 끝난다(의도 정확도에 맞음으로 셈).
14. **지표 정의**: 후보 Recall@K는 정답 중 하나라도 retrieve 상위 K에 있으면 맞음. no_match 정확도는 "증상 정답이 없는 사례에서 확인 질문을 내지 않은 비율"(오류로 끝난 것도 포함). 의도 정확도는 오류로 의도가 없으면 틀림. profile 일치는 field + 정규화 value. 반복 일치율은 (status, reason, intent, picks)가 모두 같은 비율. 지연 p50·p95는 모든 반복의 값.
15. **평가 사례에 `group` 칸 추가**(설계 9-1 형식 + 구성 분류).
16. **신호어 '세'·'살'이 너무 넓다**: 잡담 c22("안녕하세요")가 '세'로 신호어 판정됐다. 약국 찾기도 '약'으로 걸린다. 설계 목록 그대로 두고 기록만 한다(팀 검토 대상). 다른 선택지: 숫자+살/세 패턴으로 좁히기, '알러지' 같은 변형 추가.
17. 작업 중 테스트 기대값을 고친 곳은 하나: `statusCounts.confirm` 기대값을 19→18로. 지시서·설계 값이 아니라 내가 센 숫자가 틀렸다(정답 포함 15 + c01·c08·c27 = 18). 작업기록 참고.
