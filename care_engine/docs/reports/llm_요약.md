# LLM 모듈 1차(L1~L3) 요약

> 2026-11-15, 브랜치 `llm-module`(main `2db6315`에서 분기), push 안 함. 자세한 내용: [llm_L1.md](llm_L1.md), [llm_L2_L3.md](llm_L2_L3.md), [작업기록.md](작업기록.md).

## 1. 단계별 결과

| 단계 | 완료 | `npm test` | 커밋 |
|---|---|---|---|
| L1 기반(ref-data·normalize·pii·candidates·leave-one-out) | ✅ | 35 통과 / 0 실패 | `937a2e5` care_engine: L1 기반 모듈 (ref-data, normalize, pii, candidates, leave-one-out) |
| L2 스키마·프롬프트·검사·확인 질문·신호어 | ✅ | 81 통과 / 0 실패 | `c39d412` care_engine: L2 스키마·프롬프트·검사·확인 질문·건강정보 신호어 |
| L3 제공업체 자리·공개 함수·평가 틀 | ✅ | **127 통과 / 0 실패** | `7154ba9` care_engine: L3 제공업체 자리·공개 함수·평가 틀 |
| 요약 | ✅ | 127 통과 | 이 파일을 담은 마지막 커밋(`git log -1`) |

"진짜 멈춤"(같은 실패 3회)은 없었다. 테스트 실패는 3번 있었고 모두 1회에 고쳤다: 보이지 않는 줄 구분 문자로 파일이 깨짐(L1), 테스트 코드 변수 이름 가림(L2), 내가 잘못 센 테스트 기대값 19→18(L3, 지시서·설계 값 아님).

## 2. 후보 생성 leave-one-out (사전 1,164행, retrieve)

| k | 10 | 20 | 40 | 60 |
|---|---|---|---|---|
| Recall@k | **0.798** | 0.827 | 0.831 | 0.831 |

term_type별 R@40: 동의어 0.840, span 0.779, 대표 0.647. 놓친 197행은 **모두 점수 0**(글자 겹침 없음 172, 유일한 동의어 25)이라 K를 늘려도 안 오른다. 사전과 글자가 비슷한 표현에 대한 대리 지표이며, 바꿔 말한 표현은 팀 평가셋으로 다시 재야 한다.

## 3. mock 평가 (draft_v0 30개, `--repeat 3`) — 파이프라인 검증용, LLM 성능 아님

| 후보 R@10~60 | 보낸 후보에 정답 | Recall@10 | Top-1 | no_match | 의도 | profile 정밀도 / 재현율 | 실패율(사유) | 응급 놓침 | 반복 일치 |
|---|---|---|---|---|---|---|---|---|---|
| 15/22 | 16/22 | 15/22 | 14/22 | 8/8 | 26/30 | 4/5 / 4/4 | **4/30** (timeout 2, bad_json 2) | 미측정 | 30/30 |

모든 값이 fixture 설계(정답 포함 20·없음 4·형식 위반 2·timeout 2·엉뚱한 ID 2)에서 손으로 계산한 값과 같고, 테스트로 고정했다. 로그·평가 결과 파일에 원문·quote·value가 없음을 고유 표지 문자열로 검사해 통과했다.

## 4. 지시에 없던 판단 — 확인할 것부터

1. **동의 객체 형식** `{granted, provider, version, healthInfo}` — 업체명·버전 없는 포괄 동의는 거절. 서버(팀원 3)와 형식 합의가 필요하다. (L2_L3 §7-1)
2. **동의어가 하나도 없는 후보 가능 증상 19개**(F17·F18·F29·H05·P02·P15·P16·P18·P23·S12·S13·S14·S18·W01·W03·W05·W17·W18·X12)는 retrieve 후보에 절대 오르지 않는다. 지시대로 name_ko를 색인에 넣지 않았다. 넣으면 R@40이 대략 0.87(분모가 달라 참고값). (L1 §7-5)
3. **profile quote는 원문 그대로 포함까지 요구**: 프론트가 `includes`로 검사하고 하나라도 틀리면 전체를 거절하기 때문(설계는 정규화 후 포함). (L2_L3 §6-3)
4. **fallback 판정에 CSV 2개를 더 읽음**(symptom_department, variant) — DB 함수와 같게 하려고. fallback 12개: A16 B04 D20 D20-04 K01 K02 L04 L12 R01 T04 T29 X20. 상위 증상 D20도 후보에서 뺌. (L1 §3·4)
5. **normalizeTerm에 "반복 문장부호 제거"를 넣지 않음** — 파이프라인 코드에 없는 규칙이다. 사전 1,173행 모두 일치. 설계 문구를 고칠지 결정이 필요하다. (L1 §7-1)
6. **신호어 '세'·'살'·'약'이 너무 넓다** — "안녕하세요", "약국"도 추출 호출을 부른다. 목록은 설계 그대로 두었다. (L2_L3 §7-16)
7. 건강정보는 신호어 있는 메시지만 PII를 가려 보냄 / 다른 사람 이야기는 항상 제외 / `no_match`·`unclear`의 picks는 버림 / field 중복은 원래 첫 항목만 / 이상한 확인 답은 `reason:'invalid'` / 모르는 LLM_PROVIDER는 오류 / 동시성 제한은 미구현. (L2_L3 §7)
8. 프롬프트: symptom_v1 후보 목록을 system에서 user로 옮김(system 고정), profile_v1에 항목 설명을 덧붙임, en 문구는 만들지 않음. (L2_L3 §6)

## 5. 다음에 결정할 것

1. `CANDIDATE_MODE`(retrieve vs all) — 초안 사례에서 바꿔 말한 표현 6/22가 retrieve 후보에 정답이 없다. 정식 평가셋으로 두 모드를 비교한다.
2. 동의어 없는 19개 증상의 처리: name_ko 색인 추가 또는 사전 보강.
3. 신호어 목록과 확인 질문 문구(팀 검토), locale=en 문구.
4. 동의 객체 형식과 서버 코드 위치(팀원 3).
5. 평가셋: draft_v0를 2인 독립 라벨 정식 셋으로 교체(팀원 2·3).
6. 업체 결정(약관 확인 포함) → L4: `providers/gemini.mjs`·`openai.mjs` 연결과 실제 평가, 동시성 제한 구현.

## 6. 변경 범위 확인

`git diff --stat main...llm-module` (요약 커밋 전, 45개 파일 / +3,901줄; 요약 커밋에서 이 파일 추가와 작업기록 수정이 더해진다):

```
 care_engine/.gitignore                             |   6 +
 care_engine/README.md                              |  96 +++++
 care_engine/docs/LLM모듈_설계.md                   | 385 +++++++++++++++++++++
 care_engine/docs/prompts/LLM모듈_1차_프롬프트.md   | 222 ++++++++++++
 care_engine/docs/reports/llm_L1.md                 |  92 +++++
 care_engine/docs/reports/llm_L2_L3.md              | 109 ++++++
 care_engine/docs/reports/작업기록.md               |  53 +++
 care_engine/eval/__tests__/run_eval.test.mjs       |  76 ++++
 care_engine/eval/candidate_loo.mjs                 |  88 +++++
 care_engine/eval/cases/README.md                   |  25 ++
 care_engine/eval/cases/draft_v0.jsonl              |  30 ++
 care_engine/eval/compare.mjs                       |  41 +++
 care_engine/eval/fixtures/mock_v0.json             |  51 +++
 care_engine/eval/run_eval.mjs                      | 240 +++++++++++++
 care_engine/llm/__tests__/candidates.test.mjs      | 103 ++++++
 care_engine/llm/__tests__/config.test.mjs          |  43 +++
 .../llm/__tests__/confirm-question.test.mjs        |  87 +++++
 care_engine/llm/__tests__/index.test.mjs           | 282 +++++++++++++++
 care_engine/llm/__tests__/normalize.test.mjs       |  44 +++
 care_engine/llm/__tests__/pii.test.mjs             |  59 ++++
 care_engine/llm/__tests__/profile-trigger.test.mjs |  26 ++
 care_engine/llm/__tests__/prompts.test.mjs         |  24 ++
 care_engine/llm/__tests__/provider.test.mjs        | 101 ++++++
 care_engine/llm/__tests__/ref-data.test.mjs        |  64 ++++
 care_engine/llm/__tests__/schemas.test.mjs         |  76 ++++
 care_engine/llm/__tests__/validate.test.mjs        | 192 ++++++++++
 care_engine/llm/candidates.mjs                     | 106 ++++++
 care_engine/llm/config.mjs                         |  66 ++++
 care_engine/llm/confirm-question.mjs               |  90 +++++
 care_engine/llm/copy.mjs                           |  20 ++
 care_engine/llm/errors.mjs                         |  21 ++
 care_engine/llm/index.mjs                          | 271 +++++++++++++++
 care_engine/llm/normalize.mjs                      |  35 ++
 care_engine/llm/pii.mjs                            |  36 ++
 care_engine/llm/profile-trigger.mjs                |  16 +
 care_engine/llm/prompts/profile_v1.mjs             |  27 ++
 care_engine/llm/prompts/symptom_v1.mjs             |  27 ++
 care_engine/llm/provider.mjs                       |  36 ++
 care_engine/llm/providers/gemini.mjs               |  20 ++
 care_engine/llm/providers/mock.mjs                 |  93 +++++
 care_engine/llm/providers/openai.mjs               |  21 ++
 care_engine/llm/ref-data.mjs                       | 160 +++++++++
 care_engine/llm/schemas.mjs                        | 107 ++++++
 care_engine/llm/validate.mjs                       | 125 +++++++
 care_engine/package.json                           |   9 +
 45 files changed, 3901 insertions(+)
```

- **care_engine/ 밖에서 바뀐 파일: 0개** (`git -c core.quotepath=false diff --name-only main...llm-module`에서 `care_engine/`로 시작하지 않는 경로 0). 처음에 quotepath 없이 세었을 때 3개로 나왔는데, 한글 파일명이 따옴표로 감싸져 패턴에 안 맞은 오탐이었다.
- `eval/out/`은 커밋에 없음(`care_engine/.gitignore`). 루트 `.gitignore`, `frontend/`, `data_pipeline/`은 손대지 않았다. `.env`는 만들거나 열지 않았다.
- 작업 트리에 커밋하지 않은 파일이 2개 있다: `data_pipeline/docs/행동온톨로지_인계.md`(작업 전부터 있던 파일)와 루트 `.claude/`(작업 중 생겼고, 내가 만든 것이 아니다 — Claude Code 설정 폴더로 보임). 둘 다 건드리지 않았다.
