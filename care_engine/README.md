# care_engine

의료 정보 도우미의 상담 엔진 폴더. **문진 엔진**(`engine/`, 공개 함수 `runCare`)과 **LLM 모듈**(`llm/`)이 있다.
설계: [docs/문진엔진_설계.md](docs/문진엔진_설계.md), [docs/LLM모듈_설계.md](docs/LLM모듈_설계.md). 작업 보고는 `docs/reports/`(로컬 전용, 저장소에 넣지 않음).

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
  engine/                 문진 엔진(설계: docs/문진엔진_설계.md)
    index.mjs             공개 함수 runCare(payload, ctx, deps)
    intake-data.mjs       문진·규칙·매핑·진료과 시드 CSV 읽기 + 로드 때 검사(IntakeDataError)
    answers.mjs           답 정리(followUpAnswers), enableWhen(보이는 문항)
    rules.mjs             안전 규칙 결정표(priority hit policy)
    free-text.mjs         자유 입력 위험 표현 규칙(형식 검사·평가, 구두점·자모를 지운 두 번째 문자열도 검사)
    flow.mjs              다음 문항, 문항 → followUp
    slots.mjs             결과 매핑(card·filter·detail·report·flow)
    dictionary-match.mjs  사전 증상 매칭 기본 구현(팀원 2 모듈 자리, deps.matchSymptoms로 교체)
    facility-keywords.mjs 키워드 기관 찾기(LLM 없음, 11/17 EF: 약국 찾기만, 위험 단서로 막음)
    constants.mjs         ID로 읽는 데이터 문항 상수(T1·F2, 11/17 EF)
    identify.mjs          증상 확인(사전 → LLM → 확인 질문)
    recommend.mjs         진료과 추천(variant·fallback)
    summary.mjs           요약·119 정리 요약·약 정보 안내
    templates.mjs         엔진 질문·응급 안내·요약 문구(templates-v1, 팀 검토 전 초안)
    contract.mjs          응답 계약 검사(프론트 normalizeAssistantResponse 규칙)
    rules/
      free_text_v1.json         자유 입력 위험 표현 사전 v1(규칙 40개, draft, 11/17 R)
      facility_keywords_v2.json 키워드 기관 찾기 단서(초안, 11/17 EF: 엔진이 읽는 파일, riskCues 포함)
      facility_keywords_v1.json 이전 판(기록용, 엔진이 읽지 않음)
    __tests__/            node:test(네트워크 없음)
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
    engine_scenarios.mjs  문진 엔진 경로 시나리오 + 가짜 사용자 simulate()(테스트와 eval:paths가 같이 씀)
    engine_paths.mjs      경로별 질문 수 표(네트워크 없음)
    risk_eval.mjs         위험 표현 사전 평가(npm run eval:risk, 사례 id·rule_id만 출력)
    out/                  결과(.gitignore) — 사례 원문 없음
  docs/                   설계·지시서·보고서
```

참조 데이터는 `../data_pipeline/db/seed/v2.1-20261113/`의 CSV를 읽는다(읽기만).

## 실행

```bash
cd care_engine
npm test                                  # 단위 테스트 전부(네트워크 없음)
npm run eval:paths                        # 문진 엔진 경로별 질문 수 표 + eval/out/engine_paths_*.json (네트워크 없음)
npm run eval:risk                         # 위험 표현 사전 평가(risk_v1 153건 + 검토 회귀셋 199건), 통과 기준 못 맞추면 종료 코드 1
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
| `LLM_TIMEOUT_MS` | LLM 1회 제한 | 6000 (11/18, 이전 4000) |
| `LLM_BUDGET_MS` | 서버 전체 시간 예산 | 7000 |
| `LLM_MAX_CONCURRENCY` | 값만 읽음(동시성 제한 미구현) | 2 |
| `LLM_EVAL_BUDGET_USD` | 평가 1회 비용 상한 | 2 |

## 서버(팀원 3)가 runCare를 부르는 법

```js
import {runCare} from './care_engine/engine/index.mjs';

// 프론트 requestAssistant(payload, {signal})가 보낸 payload를 그대로 넘긴다.
const out = await runCare(payload, {
  signal,                                   // 프론트 취소(AbortSignal). 취소되면 error:'aborted'
  deadlineAt: Date.now() + 7000,            // 서버 마감 시각. 엔진은 이것과 now+7000ms 중 이른 쪽을 쓴다(프론트 8초 제한 안쪽)
  consent,                                  // 외부 AI 동의 객체(아래 "LLM 모듈" 절과 같음). 없으면 LLM은 no_consent → 일반 문진
  requestId,                                // 로그 연결용
}, {log: (event) => serverLog(event)});     // 선택: 'engine.run' 이벤트(원문 없음)

if (out.error) { /* 오류로 응답 → 프론트가 재시도 UI. 임의 추천을 만들지 않는다 */ }
else { respond(out.response); saveTrace(out.trace); }
```

| 입력 `payload` | 엔진이 쓰는 것 |
|---|---|
| `reason` | `message`·`followup`·`skip`·`previousReport`·`intake`. `recommendations`·그 밖 → `error:'unsupported_reason'` |
| `messages` | 사용자 문장 배열(안전 규칙·증상 확인·키워드 기관 찾기·건강정보 후보) |
| `followUpAnswers` | 선택 답 `{questionId, value}`. 같은 질문은 마지막 것, `value:null`은 미응답 |
| `locale` | `ko`(v1 문구는 한국어만) |
| `profile` | *(11/17 연결)* **만 나이(`age`)만** 쓴다: 상담 대상이 본인(T1=self)이고 T3 답이 없으면 0~120 정수 나이로 T3 구간을 채우고 묻지 않는다(`trace.prefilled:["T3"]`, 값은 남기지 않음). 알레르기·복용약·병력은 읽지 않는다 |
| `search`·`intake`·`previousReport` | **읽지 않는다**(previousReport는 신뢰할 수 없는 문서라 LLM에도 보내지 않음. search의 지역은 프론트가 조건 적용 때 그대로 유지) |

- `response`: 프론트 계약 객체만(`followUp` | `summary` | `search` | `emergency` | `profileUpdates`). 엔진의 계약 검사(`engine/contract.mjs`)를 통과한 것만 나간다. 질문은 매 응답 하나(`followUp`, singleChoice).
- `trace`(서버 저장·카드용, **사용자 원문 없음**): `engineVersion`, `templateVersion`, `dataVersion`, `questionnaireVersion`, `freeTextVersion`, `facilityKeywordsVersion`, `reason`, `phase`(`question`·`identify`·`emergency`·`start_choice`·`facility_keyword`·`complete`·`error`), `ruleHits`, `terminal`, `nextQuestionId`, `symptom{id, source, fallback, fallbackGroup}`, `slots{card, filter, detail, report, flow}`(각 값 `{value, question}`, 여러 값이면 배열), `skippedItems`, `llm{classify, profile}`, `warnings`. 119 신고 요약 카드는 `trace.slots.card`.
  - *(11/17 EF 반영)* `facilityKeyword`: 첫 요청에서 키워드 지름길을 본 결과 사유 코드 — `search`(약국 검색으로 보냄), `blocked_risk`(위험 단서), `no_pharmacy`(약국 표현 없음, 병원 찾기 문장 포함), `blocked_dict`·`blocked_symptom`·`blocked_medication`·`blocked_place`, `answered`·`no_message`. 보지 않은 요청은 `null`. 원문·걸린 단서는 남기지 않는다.
  - *(11/17 EF 반영)* `symptom.source`에 `sex_mismatch`(확정 증상의 성별 제한과 T2가 다름 → 증상 모름), `start_choice`(시작 선택을 무시하고 정상 흐름, LLM 없이 증상 모름)가 더해졌다.
  - *(11/17 EF 반영)* `warnings`(값 없이 코드만): `symptom_sex_mismatch`, `start_choice_overridden`(시작 선택의 검색 답이 있었지만 메시지에 사전 증상 매칭·증상 단서·위험 단서가 있어 정상 문진으로 감). 기존: `unknown_question:<id>`, `invalid_answer:<id>`, `unknown_message_key:<rule>`, `contract:…`, `profile_updates_invalid`, `data_load_failed`, `internal_exception`.
- 오류 코드(`out.error`, 이때 `response`는 null): `unsupported_reason`, `aborted`, `data`(시드·규칙 파일 로드·검사 실패), `contract`(응답이 계약을 못 지킴 — 버그), `internal`. 예외를 던지지 않는다. *(11/17 EF 반영)* `deps.now`·`deps.log`가 던져도 예외가 나가지 않는다(now 실패 → `Date.now()`, log 실패 무시).
- *(11/17 EF 반영)* **바로 search로 가는 첫 문장은 약국 찾기뿐이다.** 병원·의원·진료과 찾기 문장, 위험 표현(쓰러짐·호흡·응급·자해 등)이 든 문장은 Q0부터 묻는다. 병원 찾기는 안전·대상 질문 7개 뒤 LLM 의도 `facility_search`로 search가 나간다(동의가 없거나 LLM이 실패하면 일반 문진으로 간다).
- 시간: LLM은 요청당 최대 1번, 안전·대상 질문(Q0~T3) 동안 0번. LLM이 마감 뒤에 끝나면 기다리지 않고 "증상을 찾지 못했어요" 질문으로 간다.
- 응급: 안전 규칙(답 + 자유 입력)은 매 요청 맨 먼저 돈다. 걸리면 `emergency`(+ 119 정리용 E 문항 또는 정리 요약)만 나가고 진료과·search는 나가지 않는다. 응급 콘텐츠(`topicId`·영상)는 엔진이 넣지 않는다(팀원 3).
- 같은 입력이면 같은 응답·trace(상태 없음). 프론트가 매번 전체 메시지·답을 보내야 한다.
- 데이터는 기본이 `../data_pipeline/db/seed/v2.1-20261113/` CSV(읽기만, 시작 후 캐시). *(11/17 연결)* `loadIntakeDataFromRows(tables)`로 Supabase `ref` 표(REST JSON)에서도 같은 형식을 만든다(`source:"supabase"`, CSV와 같은 검사). `deps.refStore`로 넘기면 LLM 증상 후보도 같은 데이터를 쓴다. 프론트 서버(`frontend/lib/care-data-supabase.mjs`)는 10분 캐시로 Supabase를 읽고, 실패하면 시드 CSV로 동작한다. 2026-11-17 실제 DB로 만든 데이터는 CSV와 표마다 같았다.

**규칙 파일 자리**
- *(11/17 연결 완료)* 미응답 위험 질문 ID 유지: 프론트 `care-adapter.mjs`가 답하지 않은 `RISK_CONFIRM_<n>`·`SENSITIVE_CHOICE_<n>`를 다음 요청에 `{questionId,value:null}`로 보낸다(질문 ID만 페이지 메모리, 새 대화면 비움). 상세: `docs/reports/risk_LC_review.md` I3.
- *(11/17 연결)* 서버 연결: `frontend/app/api/care/route.js`(`lib/care-engine-server.mjs`). 동의는 외부 전송을 고지한 처리 안내 버전(`care-openai-1`)을 확인한 요청에만 `{granted:true, provider:<LLM_PROVIDER>, version, healthInfo:true}`로 넘기고, 그 밖에는 `{granted:false}`라 웹 경로에서는 `LLM_DEV_CONSENT`도 쓰이지 않는다. 지금 프론트는 원래 안내("외부 AI 업체에 제공하지 않습니다")를 쓰므로 웹에서는 LLM을 부르지 않는다. 개발 모드(`npm run dev`)에서만 `care_engine/.env`의 LLM 키를 읽는다(운영은 서버 환경변수).
- *(11/17 LC 반영)* **위험 LLM 보조·민감 안내 선택**: 민감 안내(규칙 hit·강한 민감 단서·LLM 민감 신호)는 첫 응답이 기관 안내 + `SENSITIVE_CHOICE_<n>`(`sens_end`·`sens_continue`), terminal:false. 규칙 hit와 강한 단서가 없는 `reason=message` 요청에서만 LLM이 최근 메시지 하나로 `risk_signal`을 주고(요청당 LLM 1번), emergency는 `RISK_CONFIRM_<n>`, 민감은 `SENSITIVE_CHOICE_<n>`. LLM은 규칙 경보를 끄거나 EMERGENCY_STOP을 만들지 못한다. 강한 단서(`SENSITIVE_NOTICE_CUE_RE`)가 있거나 `sens_continue` 뒤에는 그 대화에서 LLM을 부르지 않는다. 넓은 단어(맞았·때리·위협·해치)는 단서가 아니다(LCR1). trace: `llm.risk`(`{called, signal}` 또는 `{called, error}`), 민감이면 `sensitive:{kind:'sensitive_referral'}`만. 평가 `npm run eval:risk-llm`(`--no-llm`·`--cases`·`--no-text`).
- 자유 입력 위험 표현 규칙: `engine/rules/free_text_v1.json` (`{"version", "rules":[{rule_id:"FT-…", priority:1~9, patterns:[정규식], result, terminal, message_key, evidence, review_status}]}`). 패턴은 NFKC → 소문자 → 공백 제거한 메시지(와 거기서 구두점·이모지·홀로 쓴 자모를 지운 문자열)에 메시지마다 적용. *(11/17 R 반영)* 위험 표현 사전 v1: 규칙 40개(EMERGENCY_STOP 11 → 지금 119 문구, URGENT_NOTICE 28 → 119·응급실 문구, 자해·자살 생각 1 → 109 문구), 모두 `review_status: draft`. *(11/17 RF 반영)* 규칙 42개: ① EMERGENCY_STOP 11 → 지금 119(유지) ② 민감 안내 3(자해·자살 생각 109, 위협 112, 폭력 피해 1366) → 기관 안내만, 질문·진료과·summary·LLM 없음, trace에는 `{kind:"sensitive_referral"}`만 ③ 그 밖의 응급증상 28 → 응급 안내 + 확인 질문 `RISK_CONFIRM_<n>`(예: 응급 안내만 / 아니요: `emergency.active:false`로 해제 후 문진 계속 / 잘 모르겠어요·2번 무응답: 안내를 붙인 채 문진 계속, 요약 첫 줄 경고). 문맥 제외는 애매한 단어 바로 앞뒤 쓰임으로만. 근거는 `docs/위험표현_기준표.md`(응급의료법 시행규칙 별표1·119 상담 매뉴얼). 한 번 걸리면 메시지가 남아 있는 동안 매 요청 응급 안내만 나간다(상태 없음). trace·로그에는 rule_id만(원문·패턴 없음). 형식이 틀리면 `error:'data'`.
- 키워드 기관 찾기 단서: `engine/rules/facility_keywords_v2.json`(초안, 평가셋으로 고칠 것). *(11/17 EF 반영)* `riskCues`가 없으면 로드를 거부한다(`error:'data'`). v1 파일은 기록용.
- 엔진 문구: `engine/templates.mjs`(팀·교수님 검토 전 초안).

**이용 조건**
- HL7® FHIR® R4 Questionnaire(CC0)를 참조한 제한 스키마다. HL7의 보증을 받은 것이 아니며 "FHIR"·로고는 HL7 상표다.
- 안전 규칙 근거 중 「119구급상황관리센터 상담 매뉴얼」은 소방청 공공누리 제1유형(출처표시): 119구급상황관리센터 상담 매뉴얼(소방청, 2018 게시, 2020-03-13 확인).
- OpenAI 이용 정책(2026-11-20 시행판): LLM은 증상 후보 고르기만 하고 사용자가 확인한다. 진료과는 통계 규칙, 진단·질환명 없음, 요약에 "참고용" 문구.
- OMG DMN은 결정표 개념만 쓴다(명세 원문을 저장소에 넣지 않음).

## LLM 모듈을 runCare 안에서 쓰는 법

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
