# care_engine

의료 정보 도우미의 상담 엔진 폴더. 지금은 **LLM 모듈**(`llm/`)만 있다. 문진 엔진 `runCare`와 안전 규칙(위험 표현 사전)은 다음 작업으로 `engine/`에 들어간다.
설계: [docs/LLM모듈_설계.md](docs/LLM모듈_설계.md). 작업 보고: [docs/reports/](docs/reports/).

> **지금은 `mock` 제공업체로만 동작한다.** 네트워크 호출, API 키, `.env`를 쓰지 않는다. `gemini`·`openai`는 `not_implemented`를 돌려주는 자리만 있다.

## 폴더 구조

```
care_engine/
  package.json            의존성 없음(Node 20+ 내장 모듈만)
  llm/
    index.mjs             공개 함수 classifySymptom(), extractProfileUpdates()
    config.mjs            환경변수·시간 예산·버전·신호어
    provider.mjs          제공업체 인터페이스와 선택(LLM_PROVIDER, 기본 mock)
    providers/
      gemini.mjs          ← API 연결 자리(미구현)
      openai.mjs          ← API 연결 자리(미구현)
      mock.mjs            테스트·평가용 (입력 텍스트 → 응답) 맵
    ref-data.mjs          증상·동의어 시드 CSV 읽기, fallback 판정
    normalize.mjs         정규화(파이프라인 term_norm 규칙)
    pii.mjs               전화·이메일·주민번호·카드번호 가리기
    candidates.mjs        사전 기반 후보 생성(retrieve / all)
    schemas.mjs           출력 스키마(두 업체 공통 부분집합) + 검사
    prompts/              symptom_v1, profile_v1
    validate.mjs          LLM 출력 검사
    confirm-question.mjs  후보 → 확인 질문(followUp) / 답 해석 / 계약 검사
    profile-trigger.mjs   건강정보 신호어 판정
    copy.mjs              사용자 문구 상수
    errors.mjs            오류 종류·재시도 대상
    __tests__/            node:test
  eval/
    cases/                평가 사례(JSONL, 가짜 사례만) — README 참고
    fixtures/             mock 응답
    run_eval.mjs          지표 계산
    compare.mjs           두 결과 나란히
    candidate_loo.mjs     후보 생성 leave-one-out(LLM 없음)
    out/                  결과(.gitignore)
  docs/                   설계·지시서·보고서
```

참조 데이터는 `../data_pipeline/db/seed/v2.1-20261113/`의 CSV를 읽는다(읽기만).

## 실행

```bash
cd care_engine
npm test                                  # 단위 테스트 전부
npm run eval -- --cases eval/cases/draft_v0.jsonl --provider mock --fixtures eval/fixtures/mock_v0.json --repeat 3
node eval/compare.mjs eval/out/<a>.json eval/out/<b>.json
node eval/candidate_loo.mjs               # 후보 생성 Recall@k (사전 leave-one-out)
```

`npm run eval` 결과는 `eval/out/<타임스탬프>_<provider>.json`과 콘솔 표. 결과 파일에는 사례 원문이 없고 case id만 있다. mock 평가는 LLM 성능이 아니라 **파이프라인이 지표를 맞게 계산하고 실패를 맞게 처리하는지** 보는 것이다.

## 공개 함수

```js
import {classifySymptom, extractProfileUpdates} from './llm/index.mjs';

const consent = {granted: true, provider: 'mock', version: '<업체명이 들어간 동의문 버전>', healthInfo: true};
await classifySymptom({text, sex, consent, signal, deadlineAt});
// → {status:'confirm', followUp, meta} | {status:'fallback', reason, meta} | {status:'route', intent, meta}
await extractProfileUpdates({messages, consent, signal, deadlineAt});
// → {items /* BACKEND.md 0.18.0 profileUpdates */, meta}
```

- 동의는 **현재 업체 이름과 동의문 버전이 있어야** 인정한다(`true` 같은 포괄 동의는 거절 → `no_consent`).
- 모든 실패(동의 없음·시간 초과·업체 오류·형식 위반·후보 없음·차단)는 증상 분류에서 `fallback`, 건강정보 추출에서 `items: []`.
- 로그(`deps.log`)에는 원문·quote·value를 넣지 않는다.

## 설정(환경변수, 기본값)

| 이름 | 기본 | |
|---|---|---|
| `LLM_PROVIDER` | `mock` | `mock` / `gemini` / `openai` (모르는 이름은 오류) |
| `LLM_MODEL` | mock이면 `mock-v0` | 실제 업체는 **버전명**(별칭 금지) |
| `LLM_TIMEOUT_MS` | 4000 | 1회 제한 |
| `LLM_BUDGET_MS` | 7000 | 서버 전체 예산 |
| `LLM_CANDIDATE_MODE` | `retrieve` | `retrieve` / `all` |
| `LLM_CANDIDATE_K` | 40 | |
| `LLM_MAX_CONCURRENCY` | 2 | 값만 읽음(동시성 제한은 업체 연결 때 구현) |

## 업체 연결할 때(다음 단계)

바꿀 파일은 **2개**: `llm/providers/gemini.mjs`, `llm/providers/openai.mjs` (나머지는 그대로).

체크리스트(설계 4절):
1. [ ] 공통 스키마를 업체 형식으로 넘긴다 — Gemini `responseMimeType: application/json` + 스키마, OpenAI `response_format: json_schema` + `strict: true`
2. [ ] `temperature: 0`, 모델 **버전명** 고정(별칭 금지)
3. [ ] 업체 오류를 `timeout | rate_limit | server | network | blocked | bad_json | aborted`로 바꾸고 예외를 밖으로 던지지 않는다. `req.signal`·`req.timeoutMs`를 지킨다
4. [ ] 응답 원문과 입력을 로그에 남기지 않는다(meta에는 provider·model·latencyMs·토큰 수만)
5. [ ] API 키는 서버 환경변수에서만(`GEMINI_API_KEY` / `OPENAI_API_KEY`), 저장소에 넣지 않는다
6. [ ] 연결 전: 약관 확인(설계 11-1), 업체명이 들어간 동의문·처리위탁/국외이전 정리(BACKEND.md "외부 AI 업체 미확정 시 연결 기준")
7. [ ] 같은 사례로 `npm run eval -- --provider <업체>` → `compare.mjs`로 비교
