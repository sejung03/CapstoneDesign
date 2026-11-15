# LLM 모듈 L4-MVP 프롬프트: OpenAI 연결

> 2026-11-15. 1차(L1~L3) 다음 단계. 자리를 비워도 끝까지 진행되는 형식이다.
> 목표: **MVP에서 실제로 동작하는 LLM 모듈.** 비교·최적화(모델 비교, retrieve vs all 비교, 동의어 없는 증상 색인)는 다음 주 평가셋이 나온 뒤로 미룬다.

## 이번에 정한 것
| 항목 | 값 | 근거 |
|---|---|---|
| 업체 | OpenAI (Responses API) | 팀 결정 11/15 |
| 모델 | `gpt-5.4-mini-2026-03-17` (날짜 고정 스냅샷) | 공식 문서: 구조화 출력 지원, reasoning.effort 기본 none, 스냅샷 고정 가능. 입력 $0.75 / 캐시 입력 $0.075 / 출력 $4.50 (100만 토큰당) |
| 추론 강도 | `none` | 분류 작업, 지연·비용 최소 |
| 후보 방식 기본값 | **`all`** (197개 전부) | 초안 평가에서 retrieve가 바꿔 말한 표현 6/22를 놓침. retrieve 코드는 설정으로 남긴다 |
| 동의 | **MVP에서는 동의한 것으로 간주** (개발 설정) | 팀원 3의 동의 기능 연결 전. 가짜 문장만 사용 |
| 응답 저장 | `store: false` | Responses API는 기본으로 응답을 30일 저장하므로 끈다 |
| 비용 안전장치 | 평가 1회 $2 초과 시 중단 | 예산: 지원비 월 약 8.9만 원, 12월 말까지 |

---

## 0. 사람이 먼저 할 일
1. `care_engine/.env`에 아래가 있는지 확인(키 값은 이미 저장됨). 없는 줄만 추가한다.
   ```
   OPENAI_API_KEY=(저장한 키)
   LLM_PROVIDER=openai
   LLM_MODEL=gpt-5.4-mini-2026-03-17
   LLM_DEV_CONSENT=true
   ```
2. 이 파일을 `care_engine/docs/prompts/LLM모듈_L4_MVP_프롬프트.md`에 둔다(이미 있으면 생략).
3. Claude Code를 저장소 루트에서 실행하고 "Edit automatically"를 켠다. 새 npm 스크립트 이름은 `eval:` 로 시작하므로 기존 허용 규칙(`Bash(npm run eval:*)`)에 걸린다.

---

## Claude Code에 붙여 넣을 명령
```
이 저장소는 의료 정보 도우미 앱이야. 내가 자리를 비우는 동안 혼자 끝까지 진행해줘. 중간에 질문하지 마.
판단이 필요하면 더 보수적인(안전한) 쪽을 고르고 보고서의 "지시에 없던 판단"에 이유와 다른 선택지를 적은 뒤 계속 진행해.

먼저 읽을 것: care_engine/docs/prompts/LLM모듈_L4_MVP_프롬프트.md(이 지시서), care_engine/docs/LLM모듈_설계.md,
care_engine/docs/reports/llm_요약.md, care_engine/README.md, care_engine/llm/ 전체.

지시서의 M1 → M6을 순서대로 진행해. 규칙:
- 브랜치 llm-module에서 작업. pull·reset·rebase·push·stash 금지.
- care_engine/ 밖의 파일은 만들거나 고치지 않는다. 커밋은 단계마다 `git add care_engine` 후 커밋.
- .env 파일은 열거나 출력하지 않는다. 키는 코드가 process.env로만 읽고, node --env-file=.env로 실행한다.
  키 값·요청 헤더를 로그·보고서·테스트에 남기지 않는다.
- npm 패키지 설치 금지(Node 22 내장 fetch 사용).
- 실제 OpenAI 호출은 M5의 스크립트에서만, eval/cases/draft_v0.jsonl의 가짜 사례로만 한다.
  `npm test`는 네트워크를 절대 쓰지 않아야 한다(어댑터 테스트는 가짜 fetch 주입).
- 단계마다 `npm test` 전부 통과 후 다음 단계. 같은 실패를 세 번 고쳐도 안 되면 보고서에 적고 멈춘다.
- 진짜 멈춤 조건 추가: 실제 호출에서 인증 실패(401/403), 잔액·한도 부족(insufficient_quota),
  비용 한도 초과가 나면 재시도하지 말고 그 자리에서 멈추고 보고한다.
- 파일을 만들거나 고칠 때마다 care_engine/docs/reports/작업기록.md에 한 줄씩 덧붙인다(1차와 같은 형식, 단계 이름 M1~M6).
- 보고서: care_engine/docs/reports/llm_L4.md. 마지막에 llm_요약.md 맨 위에 "L4 결과" 절을 추가한다.
```

---

## M1 — OpenAI 어댑터 (`llm/providers/openai.mjs`)

```
createOpenAiProvider({model, apiKey = process.env.OPENAI_API_KEY, fetchImpl = globalThis.fetch,
                      reasoningEffort = 'none', temperature = null, maxOutputTokens = 400, baseUrl})
→ { name:'openai', model, generateStructured(req) }
```
- 요청: `POST {baseUrl ?? 'https://api.openai.com/v1'}/responses`, 헤더 `Authorization: Bearer <key>`, `Content-Type: application/json`
  ```json
  {
    "model": "<model>",
    "instructions": "<req.system>",
    "input": "<req.user>",
    "text": {"format": {"type": "json_schema", "name": "<req.schemaName>", "schema": <req.schema>, "strict": true}},
    "reasoning": {"effort": "<reasoningEffort>"},
    "max_output_tokens": 400,
    "store": false
  }
  ```
  - `temperature`는 값이 주어졌을 때만 넣는다(기본 null = 넣지 않음). 이 세대 모델이 none에서 temperature를 받는지 확인하지 못했으므로, M5 스모크에서 `LLM_TEMPERATURE=0`으로 1건 시험하고 400이면 넣지 않는 쪽으로 확정해 보고한다.
  - 요청 형식이 실제 API와 다르면(400 + 매개변수 오류) 오류 메시지에 맞춰 고치고, 바꾼 내용을 보고서에 적는다. 공식 문서를 읽을 수 있으면 확인하고 출처 URL을 적는다.
- 시간·취소: `req.timeoutMs` 타이머와 `req.signal`을 합친 AbortController. 타이머로 끊기면 `timeout`, 바깥 signal이면 `aborted`.
- 응답 해석:
  - 출력 텍스트: `output_text`가 있으면 그것, 없으면 `output[].content[]` 중 `type === 'output_text'`의 `text`를 이어 붙임
  - `type === 'refusal'` 내용이 있으면 `blocked`
  - `status === 'incomplete'`(최대 토큰 초과 등)이면 `bad_json`
  - JSON.parse 실패 → `bad_json`
- 오류 매핑(새 값은 errors.mjs에도 추가하고, 모두 fallback 경로로 간다):
  | 상황 | error | 재시도 |
  |---|---|---|
  | 429 + code `insufficient_quota` | `quota` (신규) | 안 함 |
  | 그 밖의 429 | `rate_limit` | 기존 규칙 |
  | 401, 403 | `auth` (신규) | 안 함 |
  | 400, 404, 422 | `bad_request` (신규) | 안 함 |
  | 5xx | `server` | 기존 규칙 |
  | fetch 예외(연결 실패) | `network` | 기존 규칙 |
  | 키 없음 | `auth` (호출하지 않음) | 안 함 |
- meta: `{provider:'openai', model, latencyMs, inputTokens, cachedInputTokens, outputTokens, reasoningTokens, httpStatus}`
  (`usage.input_tokens`, `usage.input_tokens_details.cached_tokens`, `usage.output_tokens`, `usage.output_tokens_details.reasoning_tokens`)
- 예외를 밖으로 던지지 않는다. 오류 본문·요청 본문·키를 로그에 남기지 않는다(오류 code 문자열만).
- 테스트(가짜 fetch): 정상, refusal, incomplete, 깨진 JSON, 429 quota, 429 일반, 401, 400, 500, 네트워크 예외, 타임아웃, 바깥 취소, 키 없음, temperature 미지정 시 본문에 없음, store:false·strict:true 포함, 요청 본문에 키가 없음.

## M2 — 설정·동의·기본값

1. `config.mjs`
   - 기본 `candidateMode`를 `'all'`로 바꾼다(retrieve는 `LLM_CANDIDATE_MODE=retrieve`로 계속 쓸 수 있게).
   - 새 설정: `LLM_REASONING_EFFORT`(기본 `none`, 허용값 none|low|medium|high), `LLM_TEMPERATURE`(빈 값이면 null),
     `LLM_DEV_CONSENT`(`true`일 때만 true), `LLM_EVAL_BUDGET_USD`(기본 2).
   - openai인데 `LLM_MODEL`이 비어 있으면 기본값 `gpt-5.4-mini-2026-03-17`. 날짜가 없는 별칭(`gpt-5.4-mini` 등)이 들어오면 경고를 meta에 남기되 막지는 않는다.
   - 가격표 상수 `MODEL_PRICES_USD_PER_1M = {'gpt-5.4-mini-2026-03-17': {input:0.75, cachedInput:0.075, output:4.50}}`. 모르는 모델이면 비용을 null로 표시(추정하지 않음). 출처 URL을 주석에 적는다: https://developers.openai.com/api/docs/pricing
   - `getProvider`가 openai일 때 위 설정을 어댑터에 넘긴다.
2. 개발용 동의
   - `classifySymptom`·`extractProfileUpdates`에서 `consent`가 없고 `config.devConsent === true`이면
     `{granted:true, provider:<현재 업체>, version:'dev-assumed', healthInfo:true}`를 쓴다. meta에 `consentSource:'dev'` 기록.
   - `hasExternalAiConsent`의 엄격한 검사는 그대로 둔다(실제 동의 객체가 오면 기존 규칙).
   - README와 llm_L4.md에 "운영 전 LLM_DEV_CONSENT를 끄고 팀원 3의 동의 기능과 연결해야 함"을 눈에 띄게 적는다.
   - 테스트: devConsent false + consent 없음 → no_consent / true → 호출됨 / 실제 consent 객체가 오면 devConsent 무시.

## M3 — 건강정보 신호어 좁히기 (`profile-trigger.mjs`, `config.mjs`)

단어 포함 검사에서 정규식 패턴으로 바꾼다. 목적: "안녕하세요", "약국", "세상" 같은 문장이 외부로 나가지 않게.
- 나이: `\d{1,3}\s*(살|세)`, `만\s*\d{1,3}\s*세`, `나이`
- 약: `약\s*(을|은|를)?\s*(먹|복용|처방)`, `복용`, `먹고\s*있`, `\S+약\s*(먹|복용)` (예: 혈압약 먹어요)
- 알레르기: `알레르기`, `알러지`
- 병력: `앓`, `진단\s*(받|을)`, `수술\s*(받|했)`, `병력`, `기저\s*질환`
- 테스트: 위 각 패턴의 양성 예, 그리고 음성 예 "안녕하세요", "약국 어디 있어요", "세상에 너무 아파요", "약속이 있어서", "수술실 앞이에요" 가 false.
- 1차 초안 30개 사례에서 바뀐 결과(트리거 여부)를 보고한다.

## M4 — 비용 계산과 안전장치

- `llm/cost.mjs`: `estimateCostUsd(meta, prices)` → 입력(캐시 제외)·캐시 입력·출력(추론 토큰 포함) 합계. 모르는 모델이면 null.
- `run_eval.mjs`:
  - 사례마다 비용을 더해 결과 파일과 콘솔 표에 `costUsd`(합계, 사례당 평균)를 출력
  - 누적 비용이 `LLM_EVAL_BUDGET_USD`를 넘으면 남은 사례를 실행하지 않고 `stoppedByBudget:true`로 끝낸다
  - provider가 openai면 실행 전에 "예상 최대 비용"(사례 수 × 반복 × 사례당 상한 추정)을 출력하고, 그 값이 예산을 넘으면 실행하지 않는다
  - 결과에 `candidateMode`, `model`, `reasoningEffort`, `consentSource`를 함께 남긴다
- 테스트: mock meta로 비용 계산, 예산 초과 시 중단.

## M5 — 실제 호출 (네트워크 사용은 여기서만)

package.json 스크립트 추가:
```
"eval:smoke":  "node --env-file=.env eval/smoke_openai.mjs",
"eval:openai": "node --env-file=.env eval/run_eval.mjs --cases eval/cases/draft_v0.jsonl --provider openai"
```
1. `eval/smoke_openai.mjs`: draft_v0에서 앞의 10개 사례만 증상 분류 1회씩.
   출력은 사례마다 case id, status, intent, picks ID, 지연, 토큰(입력·캐시·출력·추론), 비용. **문장 원문은 출력하지 않는다.**
   - 첫 1건이 auth·quota·bad_request면 즉시 멈추고 보고(멈춤 조건)
   - `LLM_TEMPERATURE=0`으로 1건 따로 시험 → 결과(받는지/400인지)를 보고하고 기본값 확정
2. 스모크가 통과하면 전체 평가:
   - `npm run eval:openai -- --repeat 2` (all 모드, 기본값)
   - `LLM_CANDIDATE_MODE=retrieve`로 같은 명령 1회 더(비교 참고용, --repeat 2)
   - 두 결과를 `eval/compare.mjs`로 나란히 비교
3. 보고할 숫자(초안 30개, 혼자 단 라벨이라 참고값이라고 명시):
   - Recall@10, Top-1, no_match 정확도, 의도 정확도, profile 정밀도·재현율
   - 실패율(사유별), 지연 p50·p95, 반복 일치율, 캐시 입력 비율
   - 총비용, 사례당 비용
   - mock 기대값과 다른 곳 중 눈에 띄는 것: case id와 정답 ID·고른 ID만(문장 원문 없이)

## M6 — 정리

1. `care_engine/README.md`
   - 실행 방법(`npm test`, `npm run eval:smoke`, `npm run eval:openai`), `.env` 항목 표(값 없이 이름과 설명만)
   - **runCare에서 쓰는 법**: `classifySymptom`·`extractProfileUpdates` 호출 예시, 반환값 3가지(confirm / fallback / route)별로 엔진이 할 일, `deadlineAt`·`signal` 넘기는 법
   - 운영 전 체크리스트: LLM_DEV_CONSENT 끄기, 실제 동의 연결, 모델 스냅샷 확인, 사용 한도 확인
2. 설계 문서 `care_engine/docs/LLM모듈_설계.md` 고칠 곳(바꾼 곳마다 "11/15 L4 반영" 표시):
   - 업체 OpenAI 확정, 모델·추론 강도·store:false
   - 후보 기본값 all
   - 5-2 정규화 문구에서 "반복 문장부호 제거" 삭제(파이프라인 규칙이 기준)
   - 6-1 신호어를 M3 패턴으로
   - 6-4 quote 검사: "원문에 그대로 포함"(1차에서 엄격하게 바꾼 것)
   - 동의 객체 형식과 개발용 동의
   - 11절 정해야 할 것: 업체·모델 항목을 "결정됨"으로, 남은 것(평가셋, retrieve/all, 모델 비교, 동의 연결, 동의어 없는 19개 증상) 정리
3. `npm test` 전부 통과, `git diff --stat main...llm-module`과 care_engine 밖 변경 0개 확인
4. llm_L4.md와 llm_요약.md 갱신, 커밋. push하지 않는다.

보고(채팅 마지막 메시지):
- 단계별 완료, 테스트 수, 커밋 목록
- 스모크·평가 결과 표, 총비용
- temperature 결과, 요청 형식에서 바꾼 것
- 지시에 없던 판단(내가 확인할 것부터)
- 다음에 결정할 것
