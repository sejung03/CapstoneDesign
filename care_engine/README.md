# care_engine

의료 정보 도우미의 상담 엔진 폴더. 지금은 **LLM 모듈**(`llm/`)만 있다. 문진 엔진 `runCare`와 안전 규칙(위험 표현 사전)은 다음 작업으로 `engine/`에 들어간다.
설계: [docs/LLM모듈_설계.md](docs/LLM모듈_설계.md). 작업 보고: [docs/reports/](docs/reports/) (최신: [llm_L4.md](docs/reports/llm_L4.md)).

> ⚠️ **운영 전 반드시: `LLM_DEV_CONSENT`를 끄고 팀원 3의 동의 기능과 연결해야 한다.**
> `LLM_DEV_CONSENT=true`이면 `consent`가 없는 요청을 "동의한 것"으로 간주해 사용자 문장을 OpenAI로 보낸다(MVP 개발용, 가짜 문장만).

- 업체: **OpenAI Responses API**, 모델 `gpt-5.4-mini-2026-03-17`(날짜 고정 스냅샷), 추론 강도 `none`, `store: false`.
- 기본 제공업체는 `mock`(네트워크 없음). `LLM_PROVIDER=openai`일 때만 실제 API를 부른다. `gemini`는 자리만 있다.
- `npm test`는 네트워크를 쓰지 않는다(OpenAI 어댑터 테스트는 가짜 fetch).

## 폴더 구조

```
care_engine/
  package.json            의존성 없음(Node 22+ 내장 fetch만)
  .env                    (커밋 안 함) 키와 설정 — 아래 표
  llm/
    index.mjs             공개 함수 classifySymptom(), extractProfileUpdates()
    config.mjs            환경변수·시간 예산·버전·신호어 패턴·가격표
    provider.mjs          제공업체 선택(LLM_PROVIDER, 기본 mock)
    providers/
      openai.mjs          OpenAI Responses API 어댑터
      gemini.mjs          자리(미구현)
      mock.mjs            테스트·평가용 (입력 텍스트 → 응답) 맵
    cost.mjs              토큰 → 비용, 평가 전 예상 최대 비용
    ref-data.mjs          증상·동의어 시드 CSV 읽기, fallback 판정
    normalize.mjs         정규화(파이프라인 term_norm 규칙)
    pii.mjs               전화·이메일·주민번호·카드번호 가리기
    candidates.mjs        후보 생성(all / retrieve)
    schemas.mjs           출력 스키마(OpenAI strict 호환 부분집합) + 검사
    prompts/              symptom_v1, profile_v1
    validate.mjs          LLM 출력 검사
    confirm-question.mjs  후보 → 확인 질문(followUp) / 답 해석 / 계약 검사
    profile-trigger.mjs   건강정보 신호어 패턴 판정
    copy.mjs              사용자 문구 상수
    errors.mjs            오류 종류·재시도 대상·멈춤 대상
    __tests__/            node:test
  eval/
    cases/                평가 사례(JSONL, 가짜 사례만) — README 참고
    fixtures/             mock 응답
    run_eval.mjs          지표·비용 계산, 예산 안전장치
    smoke_openai.mjs      실제 호출 스모크(10건)
    compare.mjs           두 결과 나란히
    candidate_loo.mjs     후보 생성 leave-one-out(LLM 없음)
    out/                  결과(.gitignore) — 사례 원문 없음
  docs/                   설계·지시서·보고서
```

참조 데이터는 `../data_pipeline/db/seed/v2.1-20261113/`의 CSV를 읽는다(읽기만).

## 실행

```bash
cd care_engine
npm test                                  # 단위 테스트 전부(네트워크 없음)
npm run eval:smoke                        # OpenAI 실제 호출 10건 + temperature 시험 1건 (.env 필요)
npm run eval:openai -- --repeat 2         # OpenAI로 draft_v0 30개 평가 (기본 all 모드)
LLM_CANDIDATE_MODE=retrieve npm run eval:openai -- --repeat 2   # retrieve 비교용
node eval/compare.mjs eval/out/<a>.json eval/out/<b>.json
npm run eval -- --cases eval/cases/draft_v0.jsonl --provider mock --fixtures eval/fixtures/mock_v0.json --repeat 3
node eval/candidate_loo.mjs               # 후보 생성 Recall@k (사전 leave-one-out)
```

- `eval:smoke`·`eval:openai`는 `node --env-file=.env`로 `.env`를 읽는다. 키는 코드가 `process.env.OPENAI_API_KEY`로만 읽고 로그·결과 파일에 남기지 않는다.
- **비용 안전장치**: 실행 전 "예상 최대 비용"(위로 잡은 값)이 `LLM_EVAL_BUDGET_USD`(기본 $2)를 넘으면 실행하지 않는다. 실행 중 누적 비용이 넘으면 남은 사례를 건너뛴다(`stoppedByBudget`). `auth`·`quota`·`bad_request`가 나면 재시도 없이 그 자리에서 멈춘다(`stoppedByError`).
- 결과 파일(`eval/out/`)에는 사례 원문·quote·value가 없고 case id·증상 ID·숫자만 있다.
- 참고 비용(초안 30개 × 반복 2, all 모드): 약 $0.045. 사례 1회당 약 $0.0008(캐시 입력 비율 93%).

## `.env` 항목 (값은 저장소에 넣지 않는다)

| 이름 | 설명 | 기본(없을 때) |
|---|---|---|
| `OPENAI_API_KEY` | OpenAI API 키. 서버에서만 | 없으면 호출 안 함(`auth`) |
| `LLM_PROVIDER` | `mock` / `openai` / `gemini`(자리). 모르는 이름은 오류 | `mock` |
| `LLM_MODEL` | 모델 **날짜 고정 스냅샷 이름**. 날짜 없는 별칭이면 meta에 `modelWarning:'model_alias'` | openai면 `gpt-5.4-mini-2026-03-17` |
| `LLM_DEV_CONSENT` | `true`일 때만 개발용 동의 켜짐. **운영 전 끈다** | 꺼짐 |
| `LLM_REASONING_EFFORT` | `none` / `low` / `medium` / `high` | `none` |
| `LLM_TEMPERATURE` | 빈 값이면 요청에 넣지 않음. `0`~`2` | 넣지 않음 |
| `LLM_CANDIDATE_MODE` | `all`(증상 전부) / `retrieve`(사전 유사도 상위 K) | `all` |
| `LLM_CANDIDATE_K` | retrieve 후보 수 | 40 |
| `LLM_TIMEOUT_MS` | LLM 1회 제한 | 4000 |
| `LLM_BUDGET_MS` | 서버 전체 시간 예산 | 7000 |
| `LLM_MAX_CONCURRENCY` | 값만 읽음(동시성 제한 미구현) | 2 |
| `LLM_EVAL_BUDGET_USD` | 평가 1회 비용 상한 | 2 |

## runCare에서 쓰는 법

```js
import {classifySymptom, extractProfileUpdates} from '../llm/index.mjs';

// 프론트 요청의 signal과 서버 마감 시각을 그대로 넘긴다. 둘 중 먼저 오는 쪽에서 멈춘다.
const deadlineAt = Date.now() + 7000;            // 서버 전체 예산 안쪽(설정 LLM_BUDGET_MS와 더 이른 쪽이 쓰인다)
const signal = req.signal;                       // 프론트 취소(AbortSignal). 취소되면 'aborted' fallback

// consent: 팀원 3의 동의 기능이 연결되면 {granted:true, provider:'openai', version:'<업체명이 들어간 동의문 버전>', healthInfo:true}
//          연결 전(MVP)에는 넘기지 않고 LLM_DEV_CONSENT=true로 돌린다 → meta.consentSource === 'dev'
const r = await classifySymptom({text, sex, consent, signal, deadlineAt, requestId});
```

`classifySymptom`은 예외를 던지지 않고 아래 셋 중 하나를 돌려준다.

| 결과 | 뜻 | 엔진이 할 일 |
|---|---|---|
| `{status:'confirm', followUp, meta}` | 증상 후보를 골랐다 | `followUp`(확인 질문, BACKEND.md followUp 계약 통과)을 그대로 응답에 싣는다. 사용자의 답은 `parseSymptomConfirm`(`confirm-question.mjs`)으로 해석해 증상 ID를 얻고, 그 ID로 문진을 이어간다. "해당 없음"·"모르겠음"·이상한 답이면 fallback 문진 |
| `{status:'fallback', reason, meta}` | 동의 없음·시간 초과·업체 오류·형식 위반·후보 없음(`no_match`)·차단 | **정상·비응급으로 보지 않는다.** fallback 문진(일반 질문)으로 간다. `reason`은 로그용 |
| `{status:'route', intent, meta}` | 증상이 아니다(`facility_search` / `medication_question` / `other`) | 병원·약국 찾기, 약 질문 안내 등 해당 흐름으로 넘긴다 |

```js
// 건강정보: 사용자 메시지 배열. 신호어 패턴에 맞는 메시지만 PII를 가려 보낸다(없으면 호출 0회).
const p = await extractProfileUpdates({messages, consent, signal, deadlineAt, requestId});
// → {items /* BACKEND.md 0.18.0 profileUpdates, 실패하면 [] */, meta}
```

- 동의는 **현재 업체 이름과 동의문 버전이 있어야** 인정한다(`true` 같은 포괄 동의는 거절 → `no_consent`). 실제 consent 값이 오면 `LLM_DEV_CONSENT`는 무시된다.
- `meta`: provider·model·promptId·schemaId·dataVersion·candidateMode·candidateCount·latencyMs·attempts·error·consentSource·modelWarning·tokens(입력·캐시·출력·추론)·providerError(HTTP 상태와 오류 code만). 원문은 없다.
- 로그(`deps.log`)에는 원문·quote·value를 넣지 않는다. 비용은 `estimateCostUsd(r.meta)`(`llm/cost.mjs`).
- 응급 판단은 LLM이 하지 않는다. 안전 규칙(위험 표현 사전)은 LLM 호출 **전에** 엔진이 돌린다.

## 운영 전 체크리스트

1. [ ] `LLM_DEV_CONSENT`를 끈다(지우거나 `false`).
2. [ ] 팀원 3의 동의 기능과 연결: 업체명(OpenAI)이 들어간 동의문 버전, 처리위탁·국외이전 고지(BACKEND.md "외부 AI 업체 미확정 시 연결 기준"). `consent` 객체를 `classifySymptom`·`extractProfileUpdates`에 넘긴다.
3. [ ] 모델 스냅샷 확인: `LLM_MODEL`이 날짜 고정 이름인지(`modelWarning`이 없어야 함), 스냅샷 지원 종료 일정, 가격표(`config.mjs` `MODEL_PRICES_USD_PER_1M`, 출처 https://developers.openai.com/api/docs/pricing).
4. [ ] OpenAI 조직의 사용 한도(월 한도·알림)를 지원비 예산 안으로 설정, 키는 서버 환경변수에만.
5. [ ] OpenAI 약관·데이터 처리(설계 11-1과 같은 항목) 확인. 요청은 `store:false`.
6. [ ] 정식 평가셋(2인 독립 라벨)으로 `npm run eval:openai` 다시 실행.
