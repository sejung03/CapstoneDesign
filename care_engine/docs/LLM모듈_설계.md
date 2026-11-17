# LLM 모듈 설계 (v1 초안)

> 2026-11-15 작성. 담당: 팀원 1. 상태: **초안**. 제공업체(Gemini·OpenAI)가 정해지기 전에도 만들 수 있게 썼다.
> **제공업체 API를 부르는 파일 2개(`providers/gemini.mjs`, `providers/openai.mjs`)만 빼고 나머지는 지금 바로 구현·테스트할 수 있다.** 그 전까지는 `providers/mock.mjs`로 돌린다.
> *(11/15 L4 반영)* **업체 OpenAI 확정**(팀 결정 11/15). Responses API, 모델 `gpt-5.4-mini-2026-03-17`(날짜 고정 스냅샷), 추론 강도 `none`, `store: false`. `providers/openai.mjs` 연결 완료, `gemini.mjs`는 자리만 남긴다.
> 맞춘 계약: `frontend/docs/BACKEND.md`(requestAssistant 요청·응답, followUp 0.20.0, profileUpdates 0.18.0, 외부 AI 업체 기준). DB: `ref.symptom`, `ref.symptom_synonym`, `ref.data_version`.

---

## 0. 방법론 한눈에 보기

1. **사전이 먼저다.** 동의어 사전 1,173개로 맞히면 LLM을 부르지 않는다. 맞힌 원문은 외부로 나가지 않는다.
2. **안전 규칙은 LLM보다 먼저, LLM과 상관없이 돈다.** LLM이 실패해도 응급 판정은 그대로다. LLM 결과로 "응급 아님"을 결론 내리지 않는다.
3. **LLM은 후보 목록 안에서 고르기만 한다(2단계 구조).** ① 사전으로 후보를 뽑고 ② LLM이 그중 맞는 것을 순서대로 고른다. 출력은 구조화 출력(enum)으로 묶고, 받은 뒤 코드로 다시 검사한다.
4. **사람이 최종 확인한다.** 후보를 선택형 질문으로 보여 주고 사용자가 고른 것만 증상으로 쓴다.
5. **실패하면 되묻는다.** 시간 초과·오류·형식 위반·후보 없음은 모두 fallback 문진(F1~F3)으로 보낸다.
6. **측정해서 고른다.** Gemini와 OpenAI를 같은 평가셋, 같은 지표로 비교해 정한다.

근거(조사 결과 요약): 후보 생성 → 재순위의 2단계 구조가 의료 개념 정규화의 표준이고(ALTA 2025, BeLink 2026), LLM을 학습 없이 판별기로 쓰면 정확도가 오른다(ACL 2025). 상용 증상 체커(Infermedica)도 자유 입력 파싱(/parse), 응급 신호(/red_flags), 문진(/diagnosis)을 서로 다른 부품으로 두고, 잡아낸 증상은 하나하나 확인받으라고 안내한다.

---

## 1. 범위

| 기능 | v1 | 비고 |
|---|---|---|
| 증상 후보 분류 | ✅ | 사전에 없는 표현 → symptom_id 후보 최대 10개 |
| 의도 분류 | ✅ | 증상 상담 / 기관 찾기 / 약 관련 질문 / 기타. BACKEND.md 0.20.0이 "증상 상담과 기관 탐색 의도를 구별"하라고 요구함 |
| `profileUpdates` 추출 | ✅ | 사용자가 직접 말한 나이·알레르기·복용약·병력만 |
| 요약(`summary`) | ❌ LLM 안 씀 | **템플릿으로 만든다.** 11/14 결정("사용자에게 보이는 답은 템플릿")과 맞춘다. 인수인계 문서의 "판단 없는 요약"은 이 결정으로 대체 |
| 응급 판정 | ❌ LLM 안 씀 | 안전 규칙·위험 표현 사전(규칙)만 |
| 진료과 결정 | ❌ LLM 안 씀 | `ref.recommend_departments` |

---

## 2. 전체 흐름 (`runCare` 안에서)

```
요청 (reason=message 등)
 │
 ├─ 1. 응답 상태 갱신
 ├─ 2. 안전 규칙 + 위험 표현 사전 (원문 대상, 규칙) ── 걸리면 → emergency 종료
 ├─ 3. 확정 증상이 이미 있나? (followUpAnswers에 SYM_CONFIRM 답) ── 있으면 LLM 건너뜀
 ├─ 4. 사전 매칭 (팀원 2 모듈) ── 성공 → 증상 확정
 ├─ 5. 실패 → 동의 확인 → LLM 모듈
 │      5-1 PII 가리기
 │      5-2 후보 생성 (사전 기반, 결정적)
 │      5-3 LLM 선택 (enum)
 │      5-4 결과 검사
 ├─ 6. 결과 → 확인 질문(followUp) 또는 fallback 문진
 └─ 7. 다음 문항 … 완료 후 추천
```

- **상태 저장 없음**: 확인 질문의 선택지 ID에 symptom_id를 넣는다(`sym_D01`). 다음 요청에서 이 답만 읽으면 되므로 후보 목록을 서버에 저장할 필요가 없다.
- 사용자가 확인 질문 답을 수정하면 프론트가 그 뒤 답을 지우고 다시 요청한다 → 3에서 답이 없으므로 LLM을 다시 부른다.
- 의도가 `facility_search`(예: "문 연 약국")면 문진 없이 search 조건만 돌려준다. 판단은 엔진이 하고 LLM은 라벨만 준다.

---

## 3. 폴더 구조

저장소 루트에 `care_engine/`을 둔다(`data_pipeline/`, `frontend/`와 나란히, 같은 snake_case 표기). 이름은 기술(llm, server)이 아니라 하는 일로 지었다. 이 폴더에는 LLM 모듈뿐 아니라 다음 작업인 문진 엔진 `runCare`와 위험 표현 사전(안전 규칙)도 들어간다. 팀원 3의 상담 API 서버는 이 모듈을 불러다 쓴다(서버 위치는 팀원 3과 합의).

```
care_engine/
  package.json
  README.md
  llm/
    index.mjs              공개 함수: classifySymptom(), extractProfileUpdates()
    config.mjs             환경변수 읽기, 시간 예산, 버전
    provider.mjs           제공업체 인터페이스와 선택(LLM_PROVIDER)
    providers/
      gemini.mjs           ← API 연결 자리 (나중에)
      openai.mjs           ← API 연결 자리 (나중에)
      mock.mjs             테스트용. 기록해 둔 응답을 돌려줌
    ref-data.mjs           증상·동의어 데이터 읽기
    normalize.mjs          문자열 정규화
    pii.mjs                전화번호·이메일·주민번호 패턴 가리기
    candidates.mjs         후보 생성 (사전 기반)
    schemas.mjs            출력 스키마 (두 업체 공통 부분집합)
    prompts/
      symptom_v1.mjs
      profile_v1.mjs
    validate.mjs           출력 검사
    confirm-question.mjs   후보 → followUp 질문
    errors.mjs             오류 종류
    __tests__/             node:test
  eval/
    cases/*.jsonl          평가 사례 (가짜 사례만)
    run_eval.mjs
  docs/
    LLM모듈_설계.md
    prompts/
    reports/
  (다음 작업) engine/      runCare, 안전 규칙
```

언어는 프론트와 같은 JS(.mjs), 테스트는 프론트와 같은 `node:test`.

---

## 4. 제공업체 인터페이스 (API를 끼우는 유일한 자리)

```js
// provider.mjs
/**
 * @typedef {Object} StructuredRequest
 * @property {string} system          시스템 지시문
 * @property {string} user            사용자 입력(이미 PII 가림)
 * @property {object} schema          schemas.mjs의 공통 스키마
 * @property {string} schemaName      예: 'symptom_pick_v1'
 * @property {number} timeoutMs
 * @property {AbortSignal} signal     프론트 취소와 연결
 *
 * @typedef {Object} StructuredResult
 * @property {boolean} ok
 * @property {object=} data           파싱된 JSON (ok=true일 때)
 * @property {('timeout'|'rate_limit'|'server'|'network'|'blocked'|'bad_json'|'aborted'|'quota'|'auth'|'bad_request')=} error
 * @property {{provider:string, model:string, latencyMs:number, inputTokens?:number, outputTokens?:number}} meta
 */

/** @returns {{name:string, model:string, generateStructured(req:StructuredRequest):Promise<StructuredResult>}} */
export function getProvider() { /* LLM_PROVIDER = gemini | openai | mock */ }
```

각 어댑터가 할 일은 이것뿐이다:
1. 공통 스키마를 업체 형식으로 넘긴다. Gemini는 `responseMimeType: application/json` + 스키마, OpenAI는 ~~`response_format: json_schema`~~ **Responses API `text.format: {type:'json_schema', name, schema, strict: true}`** *(11/15 L4 반영)*.
2. ~~`temperature: 0`~~ 모델 **버전명**을 고정한다(별칭 금지). *(11/15 L4 반영)* OpenAI는 `reasoning.effort: none`, `max_output_tokens: 400`, `store: false`. `temperature`는 기본으로 보내지 않는다(`LLM_TEMPERATURE`로 켤 수 있음, 스모크에서 0을 받는 것은 확인).
3. 업체 오류를 위 `error` 값으로 바꾼다. 예외를 밖으로 던지지 않는다. *(11/15 L4 반영)* 추가: 429 `insufficient_quota` → `quota`, 401·403·키 없음 → `auth`, 400·404·422 → `bad_request`(셋 다 재시도 안 함). 거절(refusal) → `blocked`, `status: incomplete` → `bad_json`.
4. 응답 원문과 입력을 **로그에 남기지 않는다.** 오류는 짧은 code 문자열만 남긴다.

### 공통 스키마 규칙 (두 업체 모두 통과하는 부분집합)
- `type`, `properties`, `required`, `enum`(문자열), `items`, `additionalProperties:false`만 쓴다.
- **모든 속성을 `required`에 넣는다.** OpenAI strict 모드는 선택 속성을 허용하지 않는다. "없음"은 빈 배열이나 `none` 같은 enum 값으로 나타낸다.
- `minItems`, `maxItems`, `pattern`, `maxLength`는 **쓰지 않는다.** 업체마다 지원 여부가 다르고 자료끼리도 엇갈린다. 개수·길이 제한은 `validate.mjs`가 강제한다.
- enum은 요청마다 그 요청의 후보 ID로 만든다.

---

## 5. 증상 후보 분류

### 5-1. 입력 범위
- 보내는 것: **사전 매칭에 실패한 사용자 메시지 텍스트만.** `profile`, `intake`, `previousReport`, 위치는 보내지 않는다.
- 보내기 전 조건: 외부 AI 이용 동의가 **업체명이 들어간 버전으로** 유효할 것(BACKEND.md 465행).
  - *(11/15 L4 반영)* 동의 객체 형식: `{granted: true, provider: '<업체명>', version: '<동의문 버전>', healthInfo: true}`. `true` 같은 포괄 동의는 거절한다.
  - *(11/15 L4 반영)* **개발용 동의(MVP)**: `consent`가 아예 없고 `LLM_DEV_CONSENT=true`이면 `{granted:true, provider:<현재 업체>, version:'dev-assumed', healthInfo:true}`로 간주하고 meta에 `consentSource:'dev'`를 남긴다. 실제 consent 값이 오면 개발용 동의는 무시하고 엄격하게 검사한다. **운영 전 `LLM_DEV_CONSENT`를 끄고 팀원 3의 동의 기능과 연결해야 한다.**
- `pii.mjs`가 전화번호·이메일·주민번호 패턴을 `[번호]` 등으로 바꾼다(정규식, 결정적).
- 길이 상한 500자. 넘으면 마지막 500자.

### 5-2. 후보 생성 (`candidates.mjs`, LLM 없음)
1. 정규화: 공백 제거, 영문 소문자(사전 `term_norm`과 같은 규칙). *(11/15 L4 반영)* "반복 문장부호 제거"는 지웠다 — 파이프라인 규칙(NFKC → 소문자 → 공백 제거)이 기준이고, 사전 1,173행 모두 이 규칙과 일치한다.
2. 입력과 각 동의어의 **문자 2-gram Dice 계수**를 계산하고, 동의어가 입력 안에 부분 문자열로 있으면 1.0.
3. symptom_id별 최고 점수로 모은 뒤, 점수 내림차순 → 같으면 symptom_id 오름차순.
4. 상위 `K`개(기본 40)를 쓴다. fallback 증상 ID는 후보에 넣지 않는다(fallback은 엔진이 처리).
5. 성별을 이미 알면(T2 답) `ref.symptom.sex_restriction`이 맞지 않는 후보를 뺀다. 모르면 빼지 않는다.

*(11/15 L4 반영)* **기본값 `all`**: 초안 평가에서 `retrieve`가 바꿔 말한 표현 6/22를 후보에 넣지 못했다(OpenAI 실제 평가에서도 Recall@10 21/22 vs 16/22). `retrieve`는 `LLM_CANDIDATE_MODE=retrieve`로 남긴다. all에서 실제로 보내는 후보는 185개다(197개 − fallback 12 − 상위 증상 D20, 성별을 알면 더 준다). 아래 비교는 정식 평가셋으로 다시 한다.

**비교 실험(평가로 결정)**: `CANDIDATE_MODE = retrieve`(위 방식, K=40) vs `all`(197개 전부). 197개 전부는 표현을 바꿔 말한 경우("속이 뒤집힐 것 같아")를 덜 놓치지만 enum이 길어진다(Gemini 문서도 enum 값 수를 줄이라고 권함). `retrieve`는 후보에 정답이 없으면 끝이다. 둘 다 돌려 **Recall@10**과 실패율로 정한다.

### 5-3. LLM에 주는 후보 표기
```
D01 | 두통 | 머리가 아파, 머리 지끈
D02 | ...
```
- `ref.symptom.name_ko` + 동의어 최대 3개(사전 순서 고정). ICPC 원문·영어 이름은 넣지 않는다.

### 5-4. 출력 스키마 (`symptom_pick_v1`)
```json
{
  "type": "object",
  "properties": {
    "intent": {"type": "string", "enum": ["symptom", "facility_search", "medication_question", "other"]},
    "status": {"type": "string", "enum": ["matched", "no_match", "unclear"]},
    "picks":  {"type": "array", "items": {"type": "string", "enum": ["<요청마다 후보 ID>"]}}
  },
  "required": ["intent", "status", "picks"],
  "additionalProperties": false
}
```
- `picks`: 가까운 순서. 확인 질문에 최대 10개까지만 쓴다.
- 이유·설명 필드는 두지 않는다(출력이 짧을수록 빠르고 안정적이며, 사용자에게 보여줄 것도 아님).

### 5-5. 프롬프트 초안 (`prompts/symptom_v1.mjs`)
```
역할: 사용자가 쓴 한국어 문장을 아래 증상 목록의 ID에 연결한다.
규칙:
1. 목록에 있는 ID만 고른다. 목록에 없는 증상을 만들지 않는다.
2. 사용자가 실제로 말한 증상만 고른다. 원인·질환을 추측하지 않는다.
3. 가까운 순서로 최대 10개. 확실한 것이 없으면 status=no_match, picks=[].
4. 증상이 여러 개면 모두 고르되, 가장 불편해 보이는 것을 앞에 둔다.
5. 증상이 아니라 병원·약국 찾기면 intent=facility_search,
   약 복용·상호작용 질문이면 intent=medication_question.
6. 응급 여부는 판단하지 않는다.
증상 목록:
{candidates}
```
- 프롬프트는 버전 이름(`symptom_v1`)으로 관리하고, 바꾸면 버전을 올린다.

### 5-6. 결과 검사 (`validate.mjs`)
| 검사 | 실패 시 |
|---|---|
| JSON·스키마 형식 | `bad_json` → fallback |
| picks의 각 ID가 이번 후보 집합에 있음 | 없는 ID는 버림 |
| 중복 제거, 앞 10개만 | — |
| `status=matched`인데 picks가 비었음 | `no_match`로 바꿈 |
| `ref.symptom`에 존재 + 현재 `data_version` | 버림 |

### 5-7. 확인 질문 (`confirm-question.mjs`)
프론트 계약: **선택지 1~12개**, ID는 영문·숫자·`_`·`-` 1~80자, 문구 300자 이하. 그래서 증상 후보는 **최대 10개 + 고정 2개**다(인수인계 문서의 "12개 + 2개"는 계약을 넘으므로 고친다).

```json
{
  "followUp": {
    "id": "SYM_CONFIRM",
    "type": "singleChoice",
    "required": true,
    "label": {"ko": "말씀하신 증상과 가장 가까운 것을 하나 골라 주세요."},
    "options": [
      {"id": "sym_D01", "label": {"ko": "두통"}},
      {"id": "sym_none",   "label": {"ko": "해당하는 것이 없어요"}},
      {"id": "sym_unsure", "label": {"ko": "잘 모르겠어요"}}
    ]
  }
}
```
- 선택지 순서는 LLM 순서 그대로. 고정 2개는 항상 마지막.
- 후보가 1개뿐이어도 확인 질문을 거친다(자동 확정 안 함).
- 다음 요청에서 `sym_<id>` → 증상 확정. `sym_none`·`sym_unsure` → fallback 문진.

### 5-8. 실패 처리 (정상·비응급으로 보지 않는다)

| 상황 | 동작 | 로그 사유 |
|---|---|---|
| 동의 없음 | LLM 안 부름 → fallback 문진 | `no_consent` |
| 시간 초과 / 네트워크 / 업체 오류 | 재시도 조건 맞으면 1회, 아니면 fallback | `timeout` 등 |
| 형식 위반 | fallback | `bad_json` |
| no_match / unclear / picks 0개 | fallback | `no_match` |
| 업체 안전 필터 차단 | fallback | `blocked` |

fallback = 증상을 fallback으로 두고 F1~F3(`engine_condition: symptom_is_fallback`) 문진으로 들어간다. 2단계 안전 규칙은 이미 돌았으므로 응급 판정에는 영향이 없다.

### 5-9. 시간 예산
- 프론트가 요청 전체를 **8초**에 끊는다(BACKEND.md 26행).
- 서버 전체 예산 7초. LLM 1회 제한 4초. 남은 시간이 3초 이상일 때만 재시도(429·5xx·네트워크만, 형식 위반은 재시도 안 함).
- 프론트 `signal`을 provider까지 넘겨 취소되면 바로 멈춘다.

---

## 6. `profileUpdates` 추출

### 6-1. 언제 부르나
- reason=message이고 건강정보 처리 동의가 유효할 때만.
- ~~메시지에 신호어(살, 세, 나이, 약, 복용, 먹고 있, 알레르기, 앓, 진단, 수술, 병력 등, `config`에 목록)가 있을 때만 부른다.~~ *(11/15 L4 반영)* 메시지 원문(NFKC)이 아래 정규식 중 하나에 맞을 때만 부른다(`config.PROFILE_SIGNAL_PATTERNS`). "안녕하세요", "약국", "세상", "약속", "수술실"은 맞지 않는다. 없으면 LLM 호출 0회.
  - 나이: `\d{1,3}\s*(살|세)`, `만\s*\d{1,3}\s*세`, `나이`
  - 약: `약\s*(을|은|를)?\s*(먹|복용|처방)`, `복용`, `먹고\s*있`, `\S+약\s*(먹|복용)`
  - 알레르기: `알레르기`, `알러지`
  - 병력: `앓`, `진단\s*(받|을)`, `수술\s*(받|했)`, `병력`, `기저\s*질환`
  - 알려진 빈틈: "수술을 받았고"처럼 `수술` 뒤에 조사가 오면 맞지 않는다(초안 사례 c29). 넓힐지 팀 결정.
- 증상 분류와 **다른 호출**로 둔다(스키마가 작아지고 실패 원인을 나눠 볼 수 있음).

### 6-2. 출력 스키마 (`profile_extract_v1`)
```json
{
  "type": "object",
  "properties": {
    "items": {"type": "array", "items": {
      "type": "object",
      "properties": {
        "field": {"type": "string", "enum": ["age", "allergies", "medications", "history"]},
        "value": {"type": "string"},
        "messageIndex": {"type": "integer"},
        "quote": {"type": "string"}
      },
      "required": ["field", "value", "messageIndex", "quote"],
      "additionalProperties": false
    }}
  },
  "required": ["items"],
  "additionalProperties": false
}
```
- v1은 `set`만 만든다. `clear`는 만들지 않는다(사용자가 내 정보에서 직접 지움).

### 6-3. 프롬프트 핵심 규칙
1. 사용자가 **자기 정보로 직접 말한 것만.** 증상에서 약·질환을 추론하지 않는다(BACKEND.md 298행).
2. `quote`는 메시지에서 그대로 복사한 부분.
3. 다른 사람 이야기("엄마가 혈압약을…")는 상담 대상이 본인일 때 제외. 대상 판정은 문진 답(T1)을 엔진이 넘겨준다.
4. 없으면 `items: []`.

### 6-4. 검사 (가장 중요: 없는 건강정보를 만들어 내지 않게)
| 검사 | 실패 시 |
|---|---|
| `messageIndex`가 messages 범위 안 | 항목 버림 |
| `quote`가 그 메시지의 부분 문자열 — *(11/15 L4 반영)* **원문에 그대로 포함**(프론트가 `includes`로 검사하고 하나라도 틀리면 전체를 거절하므로. 1차 구현에서 정규화 후 포함 + 원문 포함 둘 다 요구) | 항목 버림 |
| `value`(정규화)가 `quote` 안에 있음. age는 quote 안 숫자와 같음 | 항목 버림 |
| age: 0~120 정수 문자열 | 항목 버림 |
| value 1~500자, 공백만 불가 | 항목 버림 |
| field 중복 → 첫 항목만, 최대 4개 | — |
| `id = "<field>-1"` 서버가 붙임, `operation = "set"`, `evidence.kind = "message"` | — |

항목 하나가 틀려도 응답 전체를 버리지 않고 그 항목만 버린다. 오류·시간 초과면 `profileUpdates`를 비워서 보낸다(사용자에게 별도 안내 없음).

---

### 6-5. 위험 신호 `risk_signal` *(11/17 LC 추가)*

- **원칙**: LLM은 판정하지 않는다. 확인 질문을 띄울지만 제안한다. 경보를 올리기만 하고 규칙 경보를 끄거나 낮추지 못하며 EMERGENCY_STOP을 만들지 못한다. 실패·시간 초과·동의 없음·허용 밖 값 → `none`(규칙만 동작).
- **호출 조건**(모두): `reason=message` / 그 요청에 위험 규칙 hit 없음 / 강한 민감 단서(`engine/constants.mjs` `SENSITIVE_NOTICE_CUE_RE`, 쓰임 제외 적용) 없음 / 그 대화에 민감 안내 선택 답 없음 / 동의·키·남은 시간. 대상은 **가장 최근 사용자 메시지 하나**. 넓은 단어(맞았·때리·위협·해치)만 있는 문장은 LLM으로 간다.
- **요청당 1번**: 같은 요청에 증상 분류도 필요하면 결합 스키마 `symptom_risk_v1`(증상 선택 + `risk_signal`) 한 번, 위험만 필요하면 `risk_signal_v1`(`{risk_signal}` 한 필드, 출력 상한 40토큰).
- **값**: `none`, `emergency`(별표 1 응급증상이 오늘 본인·함께 있는 사람에게), `self_harm`, `threat`, `violence`. 근거·이유는 받지 않는다.
- **프롬프트**: `prompts/risk_v2.mjs`, 결합은 `prompts/symptom_risk_v2.mjs`(11/17 LC4 dev 조정 1회: 게임·농담·사소한 이유 과장, 장난·놀이, 업무 압박, 가볍거나 일부러 한 일을 none 예시로). 애매하면 해당 신호(사용자 확인이 거른다). v1은 기록용.
- **엔진 처리**: emergency → `RISK_CONFIRM_<n>`, 민감 → `SENSITIVE_CHOICE_<n>`(`문진엔진_설계.md` §4-4). trace에 원문·민감 종류를 남기지 않는다.
- **평가**: `npm run eval:risk-llm`(`eval/risk_llm_eval.mjs`, `--cases`, `--no-llm` 규칙+단서만, `--no-text`), 비용 한도 $1, 첫 network·auth·quota 오류에서 멈춤. 결과: `docs/reports/risk_LC.md`.

## 7. 결정성·버전·로그

- 고정값: ~~`temperature 0`~~, 모델 버전명, 프롬프트 버전, 스키마 버전, `data_version`, 후보 순서(점수 → ID). *(11/15 L4 반영)* OpenAI는 추론 강도 `none`, temperature는 기본으로 보내지 않음. 초안 평가 반복 일치율 29/30.
- 결정성 범위(확정사항 그대로): **"같은 정규화 답 + 같은 데이터 버전 → 같은 결과"**는 엔진에서 보장한다. LLM 단계는 완전 결정적이지 않을 수 있으므로 평가에서 **반복 일치율**을 잰다. 원문·원문 해시는 캐시하지 않는다.
- 로그에 남기는 것: 요청 ID, reason, provider·model·prompt 버전, data_version, 후보 개수, picks ID, status, intent, 오류 종류, 지연 시간, 토큰 수.
- **남기지 않는 것**: 메시지 원문, quote, value, 업체 응답 원문.

---

## 8. 설정 (환경변수, `.env`에만)

| 이름 | 예 | 설명 |
|---|---|---|
| `LLM_PROVIDER` | `mock` / `gemini` / `openai` | |
| `LLM_MODEL` | (버전명) | 별칭 금지 |
| `GEMINI_API_KEY` / `OPENAI_API_KEY` | | 서버에서만 |
| `LLM_TIMEOUT_MS` | 4000 | |
| `LLM_BUDGET_MS` | 7000 | |
| `LLM_CANDIDATE_MODE` | `all`(기본, *(11/15 L4 반영)*) / `retrieve` | |
| `LLM_CANDIDATE_K` | 40 | retrieve일 때만 |
| `LLM_MAX_CONCURRENCY` | 2 | 무료 등급 속도 제한 대비(값만 읽음) |
| `LLM_REASONING_EFFORT` | `none`(기본) / `low` / `medium` / `high` | *(11/15 L4 반영)* |
| `LLM_TEMPERATURE` | 빈 값(기본, 보내지 않음) / `0` | *(11/15 L4 반영)* |
| `LLM_DEV_CONSENT` | `true`일 때만 켜짐 | *(11/15 L4 반영)* 개발용 동의. **운영 전 끈다** |
| `LLM_EVAL_BUDGET_USD` | 2 | *(11/15 L4 반영)* 평가 1회 비용 상한 |

---

## 9. 평가 (`eval/`)

### 9-1. 사례 형식 (JSONL, 가짜 사례만)
```json
{"id":"c001","text":"속이 울렁거리고 토할 것 같아요","gold_symptoms":["D09"],"gold_intent":"symptom","gold_emergency":false,"gold_profile":[]}
{"id":"c002","text":"저 32살이고 혈압약 먹어요. 머리가 띵해요","gold_symptoms":["D01"],"gold_intent":"symptom","gold_emergency":false,"gold_profile":[{"field":"age","value":"32"},{"field":"medications","value":"혈압약"}]}
```
- 정답 라벨은 원칙 3대로 두 평가자 독립 라벨링 → 일치한 것만 쓴다.
- 구성: 사전에 없는 표현 위주, 증상 아닌 입력(약국 찾기 등), 응급 표현, 건강정보가 섞인 문장, 다른 사람 이야기, 오타·띄어쓰기 오류.

### 9-2. 지표

| 지표 | 뜻 | 목표(초안) |
|---|---|---|
| 후보 Recall@K | 정답이 5-2 후보 안에 있는 비율 | 이게 상한선 |
| **Recall@10** | 정답이 확인 질문 선택지 안에 있는 비율 | 핵심 지표 |
| Top-1 | 첫 번째 후보가 정답 | 참고 |
| no_match 정확도 | 증상 없는 입력에 picks를 비우는 비율 | |
| 의도 정확도 | intent 일치 | |
| **응급 놓친 비율** | gold_emergency인데 안전 규칙이 안 걸린 비율 | **0** (LLM과 무관하게 따로 보고) |
| profile 정밀도 | 뽑은 항목 중 맞는 비율. **없는 정보를 만든 것 = 치명** | 우선 |
| profile 재현율 | 정답 중 뽑은 비율 | |
| 실패율 | 오류·시간 초과·형식 위반 | |
| 지연 p50·p95 | | p95 < 4초 |
| 반복 일치율 | 같은 사례 3회 실행 시 picks 일치 | |

### 9-3. 업체 비교
같은 사례·같은 프롬프트로 `gemini`, `openai`를 돌려 위 표를 나란히 만든다. 결정 기준: 응급 놓친 비율(둘 다 0이어야 함, LLM과 무관) → profile 정밀도 → Recall@10 → 실패율 → 지연.

---

## 10. 테스트 (API 없이 지금 가능)

- `mock.mjs`: 사례 ID별로 기록한 JSON을 돌려주고, 오류 종류(`timeout` 등)도 흉내 낸다.
- 단위 테스트: 정규화, PII 가리기, 후보 순서 결정성, 스키마에 후보 enum 들어가는지, 검사 규칙 각각, 확인 질문이 프론트 계약(1~12개, ID 형식)을 지키는지, 모든 실패 경로가 fallback으로 가는지, 로그에 원문이 없는지.
- 계약 테스트: 출력 JSON을 팀원 2의 계약 JSON Schema로 검사.

---

## 11. 정해야 할 것

*(11/15 L4 반영)* **결정됨**: 업체 OpenAI(Responses API), 모델 `gpt-5.4-mini-2026-03-17`, 추론 강도 `none`, `store:false`, 후보 기본값 `all`, 신호어는 정규식 패턴(6-1), quote는 원문 포함(6-4), 동의 객체 형식과 개발용 동의(5-1).

*(11/15 L4 반영)* **남은 것**:
- 정식 평가셋(2인 독립 라벨)으로 다시 재기 — 초안 30개는 혼자 단 라벨이라 참고값이다.
- `retrieve` vs `all` 최종 비교(정식 평가셋으로).
- 모델 비교(다른 스냅샷·추론 강도), temperature 0을 기본으로 할지.
- 실제 동의 기능 연결(팀원 3) 후 `LLM_DEV_CONSENT` 끄기.
- 동의어가 하나도 없는 후보 가능 증상 19개(retrieve에서는 후보에 못 오름; all에서는 이름으로 보임).
- 신호어 패턴 빈틈("수술을 받았고") 넓힐지.

아래는 1차 때 목록(1번 업체 결정은 위로 정리됨):

1. **제공업체 결정 전에 약관 확인(팀).** 확인한 Gemini API 추가 약관(2025년판, 현재판 재확인 필요)에는 ① 무료 등급(Unpaid) 입력·출력을 Google이 제품 개선에 쓰며 민감·개인정보를 넣지 말라는 조항, ② 18세 미만이 이용할 가능성이 있는 서비스에 쓰지 말라는 조항, ③ 임상 진료·의료 조언 제공에 쓰지 말라는 조항이 있다. 우리는 만 14세 이상이 이용하므로 ②가 걸린다. 무료 키는 가짜 사례 평가에만 쓰고(11/14 결정과 같음), 실사용 연결 전에 OpenAI 약관도 같은 항목으로 비교한다. 업체가 정해져야 동의문(위탁·국외이전)도 쓸 수 있다.
2. 서버 코드 위치(팀원 3).
3. `CANDIDATE_MODE`(평가 후).
4. 신호어 목록, 확인 질문 문구(팀 검토).
5. locale=en 입력: v1은 같은 흐름으로 처리하고 선택지 문구는 `name_ko`만 있음 → 영문 이름 칸이 필요한지.

---

## 12. 오늘 작업 순서

1. `normalize` · `pii` · `candidates` + 테스트
2. `schemas` · `prompts` · `validate` · `confirm-question` + 테스트
3. `provider` 인터페이스 + `mock` → `classifySymptom`, `extractProfileUpdates` 완성
4. `eval/` 틀과 사례 20개로 mock 실행
5. (업체 정해지면) 어댑터 1개 연결 → 같은 평가 실행 — *(11/15 L4 반영)* OpenAI 연결·초안 평가 완료(`docs/reports/llm_L4.md`)

## 참고
- ALTA 2025 Medical Normalization: https://preview.aclanthology.org/ingest-alta/2025.alta-main.18.pdf
- BeLink (2026): https://arxiv.org/html/2605.22501
- LLM as Entity Disambiguator (ACL 2025): https://preview.aclanthology.org/landing_page/2025.acl-short.25.pdf
- Infermedica NLP 안내: https://help.infermedica.com/intro-to-nlp-in-infermedica-api
- Gemini 구조화 출력: https://firebase.google.cn/docs/vertex-ai/structured-output
- Gemini API 추가 약관(2025-05-20판): https://ai.google.dev/gemini-api/terms-archive/terms_05_20_25
- Gemini API 추가 약관(2025-09-25판, 2025-10-07판): https://ai.google.dev/gemini-api/terms-archive/terms_09_25_25 , https://ai.google.dev/gemini-api/terms-archive/terms_10_07_25
- OpenAI strict 모드 제약: https://simonwillison.net/2024/Aug/6/openai-structured-outputs
