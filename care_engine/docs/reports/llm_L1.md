# LLM 모듈 L1 보고 — 기반 모듈

> 2026-11-15. 브랜치 `llm-module`. 지시서 `docs/prompts/LLM모듈_1차_프롬프트.md` L1.
> 네트워크 호출·API 키·.env·npm 패키지 없음. 사용자 원문은 이 보고서에 없다(사전 term만 인용).

## 1. 파일 목록

| 파일 | 내용 |
|---|---|
| `package.json` | `test: node --test`, `eval: node eval/run_eval.mjs`, 의존성 없음 |
| `.gitignore` | `eval/out/`, `.env`, `.env.*`, `node_modules/` (루트 .gitignore는 건드리지 않음) |
| `llm/ref-data.mjs` | `parseCsv`, `loadRefData({source:'csv', dir})`, `fallbackSymptomIds` |
| `llm/normalize.mjs` | `normalizeTerm`, `normalizeInput`, `tailChars` |
| `llm/pii.mjs` | `maskPii` |
| `llm/candidates.mjs` | `buildCandidates`, `formatCandidatesForPrompt`, `dice`, `scoreTerm` |
| `eval/candidate_loo.mjs` | 사전 leave-one-out (`node eval/candidate_loo.mjs`) → `eval/out/candidate_loo.json` |
| `llm/__tests__/*.test.mjs` | ref-data 10, normalize 6, pii 8, candidates 11 |

빈 폴더 `llm/providers`, `llm/prompts`, `eval/cases`, `eval/fixtures`는 git이 빈 폴더를 추적하지 않으므로 L2·L3에서 파일과 함께 생긴다.

## 2. 테스트

`npm test` → **35개 통과 / 0 실패**.

## 3. fallback 판정 기준과 목록

`001b_ref_functions.sql`의 `ref.recommend_departments`가 `is_fallback=true`를 돌려주는 조건을 그대로 옮겼다.
1. `ref.symptom_department.fallback = true` → `fallbackReason: 'department_fallback'`
2. 요청한 (sex, age_band) 조합의 `ref.symptom_department_variant` 행이 없음 → `'no_variant'`

후보 생성은 성별·나이와 상관없이 한 번 판정하므로 (2)는 **9개 조합 중 하나라도 없으면 fallback**으로 보수적으로 적용했다. 시드 v2.1-20261113에서 (2)에 걸리는 것은 D20 하나뿐이고(모든 조합 없음), 나머지 185개는 9개 조합이 모두 있어서 판정이 조합에 따라 달라지는 증상은 없다.

**fallback 12개**: A16, B04, D20, D20-04, K01, K02, L04, L12, R01, T04, T29, X20
(1)에 해당하는 11개는 `symptom.csv`의 `fallback_group`이 채워진 11개와 같다.

## 4. is_parent 처리

- `is_parent=true`는 **D20(입·혀·입술 불편)** 하나. 자식은 D20-01~04.
- **후보에서 뺀다.** 근거: ① DB 함수 주석이 "상위 증상 D20(path_used=parent, 추천 없음)… 앱이 부위를 되묻는다"라고 적어 두었고 실제로 진료과 variant 행이 없어 fallback이 된다. ② 확인 질문에서 D20을 고르면 추천이 나오지 않으므로 자식 증상을 고르게 하는 것이 맞다. ③ D20은 동의어 행도 없다.
- 판정은 `isCandidate = !isFallback && !isParent`로 따로 둬서, 나중에 다른 상위 증상이 생겨 fallback이 아니어도 빠진다.
- 자식 D20-01~03은 후보 가능, D20-04(입마름)는 fallback이라 제외.

## 5. normalizeTerm 일치 검사

- 규칙 출처: `data_pipeline/pipeline/01e_merge_labels.py` `norm()` = `"".join(unicodedata.normalize("NFKC", term).lower().split())` (`03c_merge_labels_t3.py`도 이 함수를 import). `06a_build_seed.py`는 값을 그대로 옮긴다.
- JS 구현: NFKC → `toLowerCase()` → Python `str.split()`이 공백으로 보는 문자 29개 제거.
- **사전 1,173행 모두 `normalizeTerm(term) === termNorm` (불일치 0행).**
- 설계 5-2의 "반복 문장부호 제거"는 파이프라인 코드에 없다. 지시대로 파이프라인 규칙을 따랐고 문장부호는 지우지 않는다(테스트로 고정). → "지시에 없던 판단" 1.

## 6. leave-one-out Recall@k

대상: 후보가 될 수 있는 증상(fallback·상위 증상 제외)의 동의어 **1,164행**(fallback 증상 동의어 9행 제외). 한 행을 색인에서 빼고 그 term을 입력으로 넣음, `mode=retrieve`.

| k | 맞힘 | Recall@k |
|---|---|---|
| 10 | 929 / 1164 | **0.798** |
| 20 | 962 / 1164 | 0.827 |
| 40 | 967 / 1164 | 0.831 |
| 60 | 967 / 1164 | 0.831 |

term_type별 Recall@40

| term_type | 맞힘 | Recall@40 |
|---|---|---|
| 동의어 | 892 / 1062 | 0.840 |
| span | 53 / 68 | 0.779 |
| 대표 | 22 / 34 | 0.647 |

### 놓친 경향 (k=40에서 197행)
- **순위에서 밀린 경우는 0건.** 놓친 197행은 모두 점수 0이라 후보에 아예 없다(그래서 R@40 = R@60). 즉 retrieve의 한계는 K가 아니라 "글자 겹침이 전혀 없음"이다.
- 사유: 같은 증상의 다른 동의어와 2-gram이 하나도 안 겹침 172행, 그 증상의 유일한 동의어라 빼면 색인에 아무것도 없음 25행(예: D12 변비, L15 무릎 통증, S23 탈모).
- 길이: 2글자 이하 54, 3~4글자 97, 5글자 이상 46 — 짧은 한자어(압통·오한·실신·흉통·복시)가 많다.
- 글자가 겹치지 않아 놓친 예시 20개(term → 정답 ID): 압통→A01, 오한→A02, 열감→A03, 실신→A06, 혹→A08, 흉통→A11, 기타 전신 증상→A29, 메스꺼움→D09, 변실금→D17, 치통→D19, 혀 증상→D20-01, 복수→D29, 눈곱→F03, 눈부심→F05, 복시→F05, 눈 따가움→F13, 안진→F14, 눈 깜빡임→F16, 눈꺼풀 처짐→F16, 귀 먹먹함→H13
- **동의어 행이 하나도 없는 후보 가능 증상 19개**는 retrieve로는 절대 후보에 오르지 않는다(`mode='all'`에서만): F17, F18, F29, H05, P02, P15, P16, P18, P23, S12, S13, S14, S18, W01, W03, W05, W17, W18, X12. 화상·벌레 물림·임신 중 출혈 같은 표현이 여기에 걸린다. → "지시에 없던 판단" 3.
- 참고(커밋하지 않은 일회성 계산): 각 증상의 name_ko를 색인에 더하면 평가 행이 1,349행(name_ko 행 포함)으로 바뀌고 R@10 0.835, R@40 0.874, 유일 행 사유 25→19. 분모가 달라 직접 비교값은 아니다.

**주의: 이 값은 "사전과 글자가 비슷한 표현"에 대한 대리 지표다.** 사용자가 바꿔 말한 표현("속이 뒤집힐 것 같아")의 재현율은 이보다 낮을 수 있으며, 팀 평가셋(2인 독립 라벨)으로 다시 재야 한다.

## 7. 지시에 없던 판단

1. **normalizeTerm에 설계 5-2의 "반복 문장부호 제거"를 넣지 않음.** 지시가 "파이프라인 규칙과 똑같이"를 우선했고, 넣으면 사전 term_norm과 달라진다(예: `통증(부위불명)`). 다른 선택지: 입력 쪽에만 문장부호 정리를 추가 → 사전과 대칭이 깨지므로 하지 않았다. 설계 문서 문구를 파이프라인에 맞게 고칠지 팀 확인 필요.
2. **fallback 판정에 `symptom_department.csv`와 `symptom_department_variant.csv`도 읽음.** 지시서는 CSV 3개만 적었지만 DB 함수와 같은 기준을 만들려면 이 두 파일이 필요하다. 다른 선택지: `symptom.csv`의 `fallback_group`만 사용 → 지금은 11개로 같지만 D20(variant 없음)을 놓치고, 시드가 바뀌면 DB와 어긋날 수 있다.
3. **variant "조합 하나라도 없으면 fallback"**(보수적). DB는 요청의 성별·나이 조합별로 판정한다. 지금 데이터에서는 결과가 같다(D20만 해당). 다른 선택지: 성별·나이를 받아 조합별로 판정 → 후보 함수에 나이가 필요해져 범위 밖.
4. **symptom_department 행이 없는 증상도 fallback(`no_department_row`)으로 처리.** DB 함수는 이 경우 빈 결과를 돌려준다(추천 불가). 지금 데이터에는 해당 없음.
5. **색인은 지시대로 동의어 행만 쓰고 name_ko는 넣지 않음.** 그 결과 동의어 없는 19개 증상은 retrieve 후보에 못 오른다. 다른 선택지: name_ko를 색인에 추가(위 참고 수치). 설계 5-3이 프롬프트에 name_ko를 보여 주므로 색인에 넣는 것이 자연스럽지만 지시 범위를 넘으므로 결정을 팀에 남긴다. 이 증상들은 retrieve 0개 → `mode='all'` 재시도(L3)나 fallback 문진으로 간다.
6. **Dice는 2-gram 다중집합**(같은 2-gram이 여러 번 나오면 개수 기준 교집합). "길이 1이면 1-gram"은 각 문자열마다 적용(입력이 1글자면 입력만 1-gram). 다른 선택지: 집합 기준 → 반복 표현("지끈지끈")에서 점수가 달라진다.
7. **동의어 비교는 사전의 termNorm에 normalizeTerm을 한 번 더 건 값**(멱등이라 결과 같음).
8. **formatCandidatesForPrompt**: name_ko와 같은지와 앞서 나온 동의어 중복은 **정규화 후** 비교해서 건너뜀. term 안의 줄바꿈·`|`는 공백으로 바꿔 줄 형식을 지킴. 동의어가 없으면 `ID | name_ko` 두 칸.
9. **PII**: 주민번호는 구분자(하이픈·공백)가 있으면 날짜 모양 검사 없이 가리고, 붙여 쓴 13자리는 앞 6자리가 날짜 모양일 때만 가린다. 카드번호는 16자리 붙여 쓴 것도 가린다. 대표번호(1588-xxxx)는 구분자가 있을 때만. 휴대폰은 앞 0(또는 +82) 필수 — 숫자 나열 오탐 방지. 더 많이 가리는 쪽을 택했다.
10. **parseCsv는 열 수가 머리글과 다르면 오류**를 던진다(조용히 넘기지 않음). data_version.csv가 1행이 아니면 오류.
11. 데이터 행의 `data_version`이 현재 버전과 다르면 그 행을 빼고 `warnings`에 남긴다(지금은 0행).
12. 작업 중 Write 도구가 소스의 ` ` 표기를 실제 문자로 바꿔 넣어 파일이 깨진 일이 있었다. 보이지 않는 공백 문자는 코드 포인트 숫자로 적도록 바꿨다(작업기록 참고).
