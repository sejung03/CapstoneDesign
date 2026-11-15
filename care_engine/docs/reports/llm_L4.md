# LLM 모듈 L4-MVP 보고: OpenAI 연결

> 2026-11-15, 브랜치 `llm-module`, push 안 함. 지시서: [../prompts/LLM모듈_L4_MVP_프롬프트.md](../prompts/LLM모듈_L4_MVP_프롬프트.md). 파일 단위 기록: [작업기록.md](작업기록.md).
> 평가 숫자는 모두 **초안 30개(가짜 사례, 혼자 단 라벨)** 기준의 참고값이다. 정식 평가셋으로 다시 재야 한다.

> ⚠️ **운영 전 `LLM_DEV_CONSENT`를 끄고 팀원 3의 동의 기능과 연결해야 한다.** 지금은 `consent` 없이 오는 요청을 동의한 것으로 간주한다(개발 설정, `meta.consentSource:'dev'`).

## 1. 단계별 결과

| 단계 | 내용 | `npm test` | 커밋 |
|---|---|---|---|
| M1 | OpenAI Responses API 어댑터 | 143 통과 / 0 실패 | `77e4e95` |
| M2 | 설정·개발용 동의·후보 기본값 all | 153 / 0 | `f6745a0` |
| M3 | 건강정보 신호어 → 정규식 패턴 | 155 / 0 | `be3442f` |
| M4 | 비용 계산·평가 예산 안전장치 | 165 / 0 | `ef4062e` |
| M5 | 스모크·평가 스크립트, 실제 호출 | 165 / 0 | `1e0336e` |
| M6 | README·설계 문서·보고서 | **165 / 0** | 이 보고서를 담은 커밋 |

- 멈춤 조건(같은 실패 3회, 401/403, `insufficient_quota`, 비용 한도 초과)은 **한 번도 나지 않았다.**
- 테스트 실패는 지시서대로 바뀐 동작 때문에 생긴 것뿐이었다(기본 후보 all, meta 키 추가, 신호어 목록 → 패턴, profile 지표 변화). 어떻게 고쳤는지는 작업기록에 테스트 이름과 함께 적었다.
- `npm test`는 네트워크를 쓰지 않는다. 어댑터 테스트는 가짜 fetch를 주입하고, `getProvider(openai)` 테스트는 키를 비워 호출 전에 끝난다. 실제 호출은 `eval/smoke_openai.mjs`와 `npm run eval:openai`에서만 했다.

## 2. M1 — 어댑터 (`llm/providers/openai.mjs`)

- 요청은 지시서 형식 그대로 보냈고 **400이 한 번도 나지 않아 형식을 바꾼 것은 없다.**
  - 본문: `model`, `instructions`, `input`, `text.format{type:'json_schema', name, schema, strict:true}`, `reasoning.effort`, `max_output_tokens:400`, `store:false`.
  - 공식 문서로 확인한 출처:
    - https://developers.openai.com/api/reference/resources/responses/methods/create
    - https://developers.openai.com/api/docs/guides/structured-outputs
  - 문서에서 확인한 것:
    - `text.format` 형식과 `reasoning.effort`의 `none` 값은 문서와 같다.
    - **`output_text`는 SDK에만 있는 편의 필드라 HTTP 응답 JSON에는 없다.** 그래서 실제로는 `output[].content[]`의 `output_text`를 이어 붙이는 경로를 쓴다. 지시서의 "있으면 그것"도 그대로 남겼다.
- **오류 매핑:**
  - 표대로 매핑했다: `quota`(429+insufficient_quota) · `rate_limit` · `auth`(401·403·키 없음) · `bad_request`(400·404·422) · `server`(5xx) · `network` · `timeout` · `aborted` · `blocked`(refusal) · `bad_json`(incomplete·깨진 JSON).
  - `quota`·`auth`·`bad_request`는 `errors.mjs`에 추가했고 재시도하지 않는다.
- **오류 정보:**
  - meta에는 HTTP 상태와 오류 `code`·`param`만 남긴다. 둘 다 `[A-Za-z0-9_.-]{1,64}`에 맞을 때만이다.
  - 오류 본문, 요청 본문, 키, 헤더는 어디에도 남기지 않는다. 결과 파일에서 `sk-`·`Bearer`·사례 단어를 찾아봤고 0건이었다.
- **meta:** `{provider, model, latencyMs, inputTokens, cachedInputTokens, outputTokens, reasoningTokens, httpStatus}`, 오류일 때만 `errorCode`·`errorParam`이 더 붙는다.
- 테스트는 지시서 16항목을 모두 넣었다(`llm/__tests__/openai.test.mjs`).

## 3. M2 — 설정·동의

- **후보 기본값 `all`.**
  - 실제로 보내는 후보는 **185개**다. 197개에서 fallback 12개와 상위 증상 D20을 빼고, 성별을 알면 더 줄어든다.
  - 프롬프트는 약 5,030토큰이다.
- **새 설정:** `LLM_REASONING_EFFORT`(none), `LLM_TEMPERATURE`(빈 값이면 null), `LLM_DEV_CONSENT`(정확히 `true`일 때만), `LLM_EVAL_BUDGET_USD`(2).
  - openai의 기본 모델은 `gpt-5.4-mini-2026-03-17`이다.
  - 날짜가 없는 별칭이면 `meta.modelWarning:'model_alias'`를 남기고 호출은 막지 않는다.
- **가격표:** `MODEL_PRICES_USD_PER_1M`에 입력 0.75 / 캐시 0.075 / 출력 4.50을 넣었다. 출처는 https://developers.openai.com/api/docs/pricing 이고 같은 값을 직접 확인했다.
- **개발용 동의:** `resolveConsent`를 추가했다.
  - `consent`가 undefined·null이고 devConsent가 켜져 있으면 `{granted:true, provider:<현재 업체>, version:'dev-assumed', healthInfo:true}`를 쓰고, meta에 `consentSource:'dev'`를 남긴다.
  - 실제 값(`true` 포함)이 오면 `'request'`로 보고 기존의 엄격한 검사를 그대로 거친다.
- **meta에 추가한 키:** `consentSource`, `modelWarning`, `tokens{input,cachedInput,output,reasoning}`(재시도 합계), `providerError{httpStatus,code,param}`.

## 4. M3 — 건강정보 신호어

정규화 후 단어 포함을 검사하던 방식을 원문(NFKC) 정규식 14개로 바꿨다(나이 3 · 약 4 · 알레르기 2 · 병력 5). 지시서의 음성 예 5개("안녕하세요", "약국 어디 있어요", "세상에 너무 아파요", "약속이 있어서", "수술실 앞이에요")는 모두 false다.

**초안 30개에서 바뀐 트리거**(신호어에 걸려 추출을 호출하는 사례: 1차 8개 → 2개):

| case | 구분 | 1차 | L4 | 정답 profile | 평가 |
|---|---|---|---|---|---|
| c16 | 시설 찾기 | 호출 | 안 함 | 없음 | 좋아짐("약국") |
| c17 | 시설 찾기 | 호출 | 안 함 | 없음 | 좋아짐 |
| c20 | 약 질문 | 호출 | 안 함 | 없음 | 좋아짐(약 복용 "질문"이지 본인 정보가 아님) |
| c22 | 잡담 | 호출 | 안 함 | 없음 | 좋아짐("안녕하세요") |
| c30 | 다른 사람 이야기 | 호출 | 안 함 | 없음 | 좋아짐(엄마 이야기가 밖으로 안 나감) |
| **c29** | 건강정보 | 호출 | **안 함** | history 1개 | **놓침** — "수술**을** 받았고": 패턴 `수술\s*(받|했)`에 조사 자리가 없다 |

c27·c28은 그대로 호출한다. 그래서 mock 평가의 profile 지표가 정밀도 4/5 → 3/3, 재현율 4/4 → 3/4로 바뀌었다.

## 5. M4 — 비용·안전장치

- `llm/cost.mjs`의 `estimateCostUsd(meta)` = (입력 − 캐시) × 0.75 + 캐시 × 0.075 + 출력 × 4.50, 100만 토큰당. 모르는 모델이면 null이다.
  - OpenAI `output_tokens`에는 추론 토큰이 이미 들어 있어 따로 더하지 않았다. 이번 실행은 추론 토큰이 0이었다.
- **`run_eval.mjs`에 넣은 것:**
  - 사례별 `costUsd`·`tokens`, 전체 `costUsd{total, perCase}`·`cacheInputRatio`.
  - 누적 비용이 예산을 넘으면 `stoppedByBudget`.
  - `auth`·`quota`·`bad_request`면 `stoppedByError`로 그 자리에서 멈춘다.
  - 결과에 `candidateMode`·`model`·`reasoningEffort`·`temperature`·`consentSource`를 남긴다.
- **실행 전 예상 최대 비용:** 문자 수를 토큰 수로 보고 캐시를 빼지 않으며, 재시도까지 2회로 잡는 상한이다.
  - 예상치는 all × 2회 $0.93, retrieve × 2회 $0.46이었고, 실제는 각각 그 약 5%와 7%였다.
  - 예상치가 예산을 넘거나 계산할 수 없으면(가격표에 없는 모델) 실행하지 않는다.

## 6. M5 — 실제 호출 결과

### 6-1. 스모크 (`npm run eval:smoke`, all 모드, 앞 10개 + temperature 시험 1건)

| case | 결과 | 고른 ID | 정답 ID | 지연(ms) | 입력 / 캐시 / 출력 / 추론 토큰 | 비용($) |
|---|---|---|---|---|---|---|
| c01 | **fallback:timeout** | – | D09 | 4011 | – (끊겨서 모름) | – |
| c02 | confirm | N01 | N01 | 3709 | 5032 / 4864 / 28 / 0 | 0.000617 |
| c03 | confirm | R21 | R21 | 1109 | 5037 / 4864 / 28 / 0 | 0.000621 |
| c04 | confirm | F13 | F13 | 2208 | 5036 / 4864 / 28 / 0 | 0.000620 |
| c05 | confirm | R02 | R02 | 903 | 5033 / 0 / 28 / 0 | 0.003901 |
| c06 | confirm | L14 | L14 | 1285 | 5033 / 4864 / 28 / 0 | 0.000618 |
| c07 | confirm | A02 | A02 | 1370 | 5039 / 4864 / 28 / 0 | 0.000622 |
| c08 | confirm | D12, D25 | D12 | 1351 | 5039 / 4864 / 31 / 0 | 0.000636 |
| c09 | confirm | H03 | H03 | 980 | 5031 / 4864 / 28 / 0 | 0.000616 |
| c10 | confirm | L03 | L03 | 1223 | 5034 / 4864 / 28 / 0 | 0.000618 |
| c01 (temperature=0) | confirm | D09 | D09 | 1146 | 5035 / 4864 / 28 / 0 | 0.000619 |

- **첫 호출이 4초 제한에 걸렸다**(c01). 콜드 스타트로 보이며 c02도 3.7초였다. 그 뒤는 1~2초였다. 지시서 멈춤 조건(첫 건 auth·quota·bad_request)에는 해당하지 않아 계속 진행했다.
- **temperature 결과: `temperature: 0`을 받는다(400 없음).**
  - 같은 사례에서 결과도 같았다(D09). 다만 기본 사례(c01)가 timeout이라 둘을 그대로 비교할 수는 없었다.
  - **기본값은 지시서 M2대로 "보내지 않음(null)"으로 확정했다.** 판단 근거는 §8-1에 있다.
- 스모크 비용은 **$0.009488**(10건, 끊긴 1건 제외)이고 캐시 입력 비율은 0.859다.

### 6-2. 전체 평가 (`npm run eval:openai -- --repeat 2`, 초안 30개 × 2회)

| 지표 | **all (기본)** | retrieve (참고) | mock(설계값, 참고) |
|---|---|---|---|
| 보낸 후보에 정답 | 22/22 | 16/22 | 22/22 |
| **Recall@10** | **21/22 (0.955)** | 16/22 (0.727) | 15/22 |
| Top-1 | 21/22 (0.955) | 15/22 (0.682) | 14/22 |
| no_match 정확도 | 8/8 | 8/8 | 8/8 |
| 의도 정확도 | 29/30 (0.967) | 30/30 | 26/30 |
| profile 정밀도 | 2/3 (0.667) | 3/3 | 3/3 |
| profile 재현율 | 2/4 (0.5) | 3/4 (0.75) | 3/4 |
| 실패율(사유) | **0/30** | 0/30 | 4/30 (설계: timeout 2, bad_json 2) |
| 지연 p50 / p95 (ms) | 1111 / 1443 | 1097 / 1512 | – |
| 반복 일치율 | 29/30 | 29/30 | 30/30 |
| 캐시 입력 비율 | **0.931** | 0.737 | – |
| 총비용 | **$0.045446** | $0.031699 | – |
| 사례당 비용(2회 합) | $0.001515 | $0.001057 | – |
| 응급 놓친 비율 | 미측정(안전 규칙 엔진 없음) | 미측정 | 미측정 |

- 토큰 합계(all): 입력 303,138, 그중 캐시 282,112, 출력 1,893, 추론 0. retrieve는 입력 92,392, 캐시 68,096, 출력 1,860.
- **all은 입력이 3배지만 비용은 1.4배다.** 후보 목록이 요청마다 같은 앞부분이라 캐시가 93% 맞는다.
- 실패 0건, 재시도 0건이었다. 전체 평가에서는 4초 제한에 걸린 호출이 없었고 최대 지연은 all 1,535ms, retrieve 1,973ms였다.

### 6-3. 눈에 띄는 차이 (case id와 ID만)

| case | 모드 | 정답 ID | 고른 ID / 결과 | 내용 |
|---|---|---|---|---|
| c30 | all | N17 | 없음, intent=`medication_question` | 다른 사람(엄마)의 약 이야기를 약 질문으로 봤다. retrieve에서는 symptom으로 봤다. 라벨 자체가 애매한 사례 |
| c12 | 둘 다 | S02 | S02, S04 ↔ S04, S02 | 두 증상의 순서가 반복마다 바뀜(반복 불일치 1건) |
| c27 | all | (profile 2개) | 2개 뽑음, 1개 일치 | 한 항목의 value 표기가 정답과 정규화 후 완전 일치하지 않음(값은 기록하지 않음). retrieve 실행에서는 2/2 — 같은 입력의 비결정성 |
| c29 | 둘 다 | (profile 1개) | 호출 안 함 | M3 신호어 빈틈(§4) |
| c01·c07·c09·c11·c27 | retrieve | D09·A02·H03·P06·N05 | 없음(no_match) | 정답이 retrieve 후보에 없음 → LLM이 정확히 "없음"이라 답함 |
| c08 | retrieve | D12 | D07 | 정답이 후보에 없어 가까운 다른 증상을 고름 |

mock(설계값)과 비교하면, mock에서 일부러 넣은 실패(timeout·형식 위반·엉뚱한 ID)는 실제 호출에서 하나도 나오지 않았다. 구조화 출력(strict)으로 enum 밖 ID나 깨진 JSON이 0건이었다.

### 6-4. 총비용

| 실행 | 비용 |
|---|---|
| 스모크 11건 | $0.009488 (+ 끊긴 1건: 토큰을 몰라 미집계, 상한 추정 $0.004 미만) |
| all × 2회 | $0.045446 |
| retrieve × 2회 | $0.031699 |
| **합계** | **약 $0.087** (예산 $2/회, 월 지원비 약 8.9만 원 대비 매우 작음) |

## 7. M6 — 정리

- README에 실행 방법, `.env` 항목 표(값 없이), **runCare에서 쓰는 법**(반환값 3가지별로 엔진이 할 일, `deadlineAt`·`signal`), 운영 전 체크리스트를 넣었다.
- 설계 문서는 19곳을 고쳤고 모두 "11/15 L4 반영"으로 표시했다: 업체·모델·추론 강도·store, 후보 기본값 all, 5-2의 "반복 문장부호 제거" 삭제, 6-1 신호어 패턴, 6-4 quote 원문 포함, 동의 객체·개발용 동의, 8절 설정 표, 11절 결정됨·남은 것.

## 8. 지시에 없던 판단 (확인할 것부터)

1. **temperature 기본값은 "보내지 않음" 유지.**
   - temperature 0은 받는 것을 확인했다. 그래도 지시서 M2가 "빈 값이면 null"을 기본으로 정했고, 넣지 않아도 반복 일치율이 29/30이라 그대로 두었다.
   - 다른 선택지: 설계 4절의 원래 의도대로 0을 기본으로 둔다. 바꾸려면 `.env`에 `LLM_TEMPERATURE=0`만 넣으면 된다.
2. **신호어 패턴은 지시서 그대로 두었다.** 그 결과 c29("수술을 받았고")를 놓친다.
   - 다른 선택지: `수술\s*(을|은)?\s*(받|했)`로 넓히는 것이다(약 패턴처럼 조사 자리를 둔다). 외부로 나가는 문장을 늘리는 쪽이라 팀 결정으로 남겼다.
3. **1차 테스트는 retrieve로 고정했다.** `index.test`와 mock 평가 테스트의 기대값은 retrieve 기준으로 계산한 것이라, 설정에 `LLM_CANDIDATE_MODE:'retrieve'`를 명시했다. all 기본값은 테스트를 따로 추가했다.
   - 다른 선택지: 모든 기대값을 all 기준으로 다시 계산하는 것이다. 1차 검증값을 잃는다.
4. **첫 호출 timeout(콜드 스타트)이 있었지만 4초 제한은 그대로 두었다.** 실사용 첫 요청이 fallback으로 갈 수 있다.
   - 다른 선택지: 서버 시작 때 예열 요청을 보내거나, 첫 호출만 제한을 늘린다. 팀 결정으로 남겼다.
5. **평가는 `bad_request`에서도 멈춘다.** 지시서의 진짜 멈춤 조건은 auth·quota다. 형식 오류는 계속 불러도 같은 결과라 멈추게 했다. 스모크는 지시서대로 첫 건 auth·quota·bad_request, 그 뒤 auth·quota에서 멈춘다.
6. **가격표에 없는 모델이면 평가를 실행하지 않는다.** 예상 비용을 계산할 수 없으면 예산 검사를 할 수 없기 때문이다.
7. **`status: incomplete`라도 사유가 `content_filter`면 `blocked`로 처리했다.** `completed`·`incomplete`가 아닌 상태(failed 등)는 `server`로 처리했다. 지시서는 incomplete를 모두 bad_json으로 정했지만, 두 경우 모두 fallback으로 가므로 사용자에게 보이는 결과는 같다.
8. **meta에 `errorCode`·`errorParam`(어댑터)과 `providerError`(공개 함수)를 추가했다.** 지시서 meta 목록에는 없다. 멈춤 조건 판정과 400 원인 확인(temperature 등)에 필요해서 넣었고, 형식 검사를 통과한 짧은 식별자만 담는다.
9. **"consent가 없음"은 undefined·null로만 판단한다.** `true`·`false`·빈 객체가 오면 실제 값으로 보고 엄격하게 검사한다(→ no_consent).
10. **평가는 `LLM_DEV_CONSENT=true`이면 consent를 넘기지 않는다.** MVP 경로(`consentSource:'dev'`)를 그대로 재기 위해서다. 꺼져 있으면 1차처럼 평가 전용 동의 객체를 쓴다.
11. **스모크는 `.env`와 상관없이 `LLM_PROVIDER=openai`로 고정했다.** 이름 그대로 OpenAI 스모크이기 때문이다.
12. **비용 계산에서 추론 토큰을 출력에 다시 더하지 않았다.** OpenAI `output_tokens`에 이미 들어 있기 때문이다. 추론 강도가 none이라 이번에는 0이었다.
13. **끊긴 호출(timeout)은 토큰을 몰라 비용에 넣지 못한다.** 그래서 실제 청구액은 표보다 조금 많을 수 있다(이번에는 1건).
14. **`LLM_TEMPERATURE`가 숫자가 아니거나 2보다 크면 null(보내지 않음)로 처리했다.**
15. **`compare.mjs`에 행을 추가했다:** 보낸 후보 정답, 총비용, 사례당 비용, 캐시 비율. 머리글에는 추론 강도·모드·반복을 넣었다.
16. **c30 의도 오분류 때문에 프롬프트를 바꾸지 않았다.** 사례 하나 때문에 바꾸면 초안 평가셋에 과적합될 수 있다.

## 9. 다음에 결정할 것

1. **정식 평가셋(2인 독립 라벨)으로 다시 잰다.** retrieve vs all 최종 확인과 모델·추론 강도 비교를 한다. 이번 결과(all R@10 21/22 vs retrieve 16/22)는 초안 기준이다.
2. **동의 연결(팀원 3)과 `LLM_DEV_CONSENT` 끄기.** 동의 객체 형식 `{granted, provider:'openai', version, healthInfo}`을 합의해야 한다.
3. **temperature 0을 기본으로 할지** 정한다(§8-1).
4. **신호어 패턴 빈틈**: 조사 허용 여부를 정한다(§8-2).
5. **첫 호출 지연 대책**: 예열 또는 첫 호출 제한을 정한다(§8-4).
6. **다른 사람 이야기 처리**: c30처럼 본인이 아닌 증상을 어떻게 다룰지, 문진의 대상 질문(T1)과 연결할지 정한다.
7. **평가의 profile 일치 기준**: 지금은 정규화한 value가 완전히 같아야 맞음으로 센다. 그래서 같은 정보도 표기가 다르면 틀린 것으로 나온다. 기준을 정해야 한다.
8. **동시성 제한(`LLM_MAX_CONCURRENCY`)**: 값만 읽고 아직 구현하지 않았다. 실사용 트래픽 전에 구현해야 한다.
9. **응급 놓친 비율**: 안전 규칙 엔진이 생긴 뒤에 잰다.

## 10. 변경 범위

`git diff --stat main...llm-module`과 care_engine 밖 변경 0개 확인은 요약 문서([llm_요약.md](llm_요약.md))의 "L4 결과" 절에 적었다. `.env`는 열거나 출력하지 않았다. 키는 `node --env-file=.env`로 프로세스 환경에만 들어갔다.
