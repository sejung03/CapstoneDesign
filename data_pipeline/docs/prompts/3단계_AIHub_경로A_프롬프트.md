# 3단계 프롬프트: 사전 보강 + AI Hub 증상 추출 (경로 A의 재료)

> 방법 근거: 팀 내부 문서(확정사항 및 방법론) 4-2 (안정성 우선: 사전 기반 추출, LLM은 사전 만들 때만)
>
> 사용 순서
> 1. **S3-1 (Claude Code)**: 답변 추출, 표본 만들기, 현재 사전으로 매칭률 확인 → 멈추고 보고
> 2. **S3-2 (Claude Code)**: 후보 구절을 규칙으로 추출(2026-11-12 변경: LLM 직접 읽기 중단)
> 3. **S3-3 (Claude Code)**: 라벨링 입력 만들기 → 멈추고 보고
> 4. **S3-4 (라벨링)**: 같은 지시문을 Claude Code 새 세션과 Codex에서 각각 실행
> 5. **S3-5 (Claude Code)**: 라벨 합치기 → 사전 v3 → 전체 추출 → 질환별 증상 → 보고
>
> 진료과 계산(경로 A)과 경로 B 결합은 이 단계가 아니라 4단계(진료과 이름 정리)와 2A-2에서 한다.

---

## S3-1 — Claude Code: 준비

```
3단계를 시작한다. 이번에는 S3-1까지만 하고 멈춰서 보고해.

## 원칙 (지금까지와 같음)
- data/raw/ 원본은 읽기만 한다. AI Hub 원본·표본·data/interim/은 커밋하지 않는다.
- 멱등: 다시 돌려도 같은 결과. 무작위 추출은 seed=42 고정.
- AI Hub 답변 본문은 DB에 넣지 않는다. 내부 처리용으로만 쓰고, 최종 산출물에는 추출한 증상 id와 개수만 남긴다.
- 출력 CSV는 utf-8-sig. 팀 내부 문서(확정사항 및 방법론)는 고치지 않는다.

## 1. "증상" 답변 추출 → pipeline/03a_extract_symptom_answers.py
- 입력: AI Hub VL (data/raw/의 VL.zip.part0, AiHub_check.py의 iter_json 재사용)
- intention == "증상" 인 답변(HC-A)만. 기대값: 28,886개, 질환 562개 (다르면 보고)
- 출력: data/interim/v3/symptom_answers.csv
  (answer_key = fileName + "|" + disease_name.kor, disease_ko, disease_en, disease_category,
   department_raw(목록 그대로 JSON), text = intro + body + conclusion)

## 2. 표본 → data/interim/v3/sample_answers.csv
- 질환마다 5개씩 무작위(seed=42). 5개 미만인 질환은 전부. 컬럼: sample_id(S0001…), answer_key, disease_ko, text

## 3. 현재 사전으로 매칭률 확인 (파일 수정 없음, 보고만)
- 사전: data/processed/v2/symptom_synonym_v2.csv (+ standard_symptoms_v2.csv의 name_ko)
- 표본 답변에 단순 부분 문자열 매칭을 해서
  - 답변당 매칭된 증상 수 분포, 매칭 0개인 답변 수
  - 가장 많이 매칭된 증상 20개

## 4. 제외 규칙 초안 → config/symptom_exclusion.yaml
- 매칭된 표현 앞뒤 문맥으로 버리는 고정 규칙. 처음에는 아래만 넣는다:
  - 부정: 표현 뒤 10자 안에 "않", "없", "아니", "드물" 
  - 원인·위험요인 문장: 같은 문장에 "원인", "때문", "위험 요인", "유발"
  - 치료·약 문장: 같은 문장에 "치료", "복용", "처방", "부작용"
- 이 규칙을 적용했을 때 표본 매칭이 얼마나 줄어드는지만 보고(규칙 확정은 S3-5에서).

## 보고 (여기서 멈춤)
- 증상 답변 수, 질환 수, 표본 수
- 현재 사전 매칭률(매칭 0개 답변 비율)과 상위 20개
- 제외 규칙 적용 전/후 매칭 수와, 규칙으로 버려진 예시 10개(문장 일부)
```

---

## S3-2 — 표현 후보 추출 (규칙, Claude Code) ※ 2026-11-12 변경

> 처음 안(두 도구가 답변 2,759개를 직접 읽기)은 토큰이 너무 많이 들어 중단했다.
> 증상 답변은 대부분 증상을 쉼표로 나열하므로, 후보 구절은 스크립트로 뽑고
> LLM은 S3-4에서 **고유 구절 라벨링에만** 쓴다. 표본 대신 증상 답변 전체(28,886)를 쓸 수 있어 범위도 넓어진다.

```
S3-2를 규칙 기반으로 바꾼다. 두 도구가 직접 읽던 방식은 중단했다.
pipeline/03b_candidate_phrases.py를 만들어 증상 답변 전체(symptom_answers.csv)에서 후보 구절을 뽑아줘.
LLM은 쓰지 않는다. 규칙은 config/phrase_extract.yaml에 둔다.

1. 문장 나누기: 마침표·물음표·느낌표·줄바꿈 기준
2. 나열 항목 뽑기: 각 문장을 쉼표, 가운뎃점(·), "및", "또는", "그리고", "과/와 "(뒤에 공백)로 나눈다
3. 항목 다듬기: 앞뒤 공백·괄호 제거, 끝의 "등", "등의", "등이", "같은" 제거,
   끝 조사(이, 가, 을, 를, 은, 는, 도, 의, 으로, 로) 한 번 제거
4. 길이 2~15자인 항목만 남긴다. 숫자만·영문만인 항목은 버린다.
5. 집계: 구절마다 n_answers(나온 서로 다른 답변 수), n_diseases(나온 질환 수)
5-1. 추가 출처: 완료된 Claude 직접 추출 결과(data/interim/v3/phrases/claude/phrases.csv, 표본 2,759개 전체)의
   고유 구절을 후보에 합친다(source=script / claude_read / both).
   두 출처 모두 n_answers는 같은 방식으로 다시 센다: 증상 답변 전체에서 왼쪽 경계 규칙으로 그 구절이 나온 답변 수.
   Codex 부분 결과(200개)는 후보에 넣지 않고 재현율 확인에만 쓴다.
6. 기존 사전(v2 동의어 + name_ko)과 정확히 같은 구절은 known 표시
7. 출력: data/interim/v3/candidate_phrases.csv (phrase, source, n_answers, n_diseases, known, 예문 1개)

보고:
- 고유 구절 수, known 수
- n_answers 기준값별 남는 구절 수(≥3, ≥5, ≥10, ≥20) — 라벨링 대상은 1,500개 이하가 되는 기준으로 정한다
- 상위 50개 구절(증상이 아닌 것이 섞여도 괜찮음. S3-4에서 NONE으로 거름)
- 검증: 중단된 작업 결과(data/interim/v3/phrases/claude/, phrases/codex/의 부분 결과)의 고유 구절 중
  이 스크립트 후보에 포함된 비율(재현율 확인용). 포함 안 된 구절 예시 20개
```

---

## S3-3 — Claude Code: 합치기와 라벨링 입력

```
S3-2 결과(data/interim/v3/candidate_phrases.csv)로 S3-4 라벨링 입력을 만들어. 여기서 멈추고 보고해.

1. 라벨링 대상(2026-11-12 결정): known이 아니고, source가 claude_read 또는 both이며, n_answers ≥ 10 인 구절
   → data/interim/v3/label_items_T3.csv (item_id T3-0001…, phrase, source, n_answers, n_diseases, 예문) — 약 1,194개
   - script만인 구절은 라벨링하지 않는다(대부분 "증상", "치료", "있으며" 같은 문장 조각). 스크립트는 빈도 세기 도구로만 쓴다.
2. 나머지(n_answers < 10 또는 script만)는 data/interim/v3/phrases_rare.csv에 남긴다(사전에 넣지 않음).
3. 중단된 부분 결과(phrases/claude, phrases/codex)에만 있고 후보에 없는 구절은 쓰지 않는다(기록만).
5. 선택지: data/interim/v3/label_options_T3.csv
   = P1의 label_options_T1.csv(ICPC 240개 + NONE + AMBIGUOUS) + D20-01~D20-04
6. 라벨링 규칙: data/interim/v2/labeling_guide.md의 [T1]을 그대로 복사하되 한 줄 추가해서
   data/interim/v3/labeling_guide_T3.md로 저장:
   "AMBIGUOUS를 고를 때는 note에 후보 코드를 반드시 모두 적는다(예: AMBIGUOUS (R21, L01))."

보고: 총 구절, 고유 구절, known 수, 라벨링 대상 수, rare 수, by별 개수, 라벨링 대상 상위 30개
```

---

## S3-4 — 라벨링 (Claude Code 새 세션, Codex 각각)

```
data/interim/v3/labeling_guide_T3.md를 읽고 그 규칙대로 라벨링해.
- 입력: data/interim/v3/label_items_T3.csv, label_options_T3.csv
- 출력: data/interim/v3/labels/{TOOL}/T3.csv (item_id, icpc2_code, confidence, note)
- data/interim/v3/labels/ 아래 다른 폴더는 열지 마.
- 선택지에 없는 코드는 쓰지 마. 모든 item에 한 줄씩.
- 스크립트로 자동 분류하지 말고 item마다 직접 판단해.
- 200개씩 나눠 처리하고 묶음마다 T3.csv에 덧붙여 저장한다. 마지막으로 끝낸 item_id를
  data/interim/v3/labels/{TOOL}/progress.txt에 남기고, 멈추면 그다음부터 이어서 한다.
- 모든 item이 끝날 때까지 계속한다. 중간에 끝내야 하면 몇 번째까지 했는지 알려줘.
끝나면 NONE·AMBIGUOUS 개수만 알려줘.
```

---

## S3-5 — Claude Code: 사전 v3, 전체 추출, 질환별 증상

```
S3-4 라벨(labels/claude/T3.csv, labels/codex/T3.csv)로 사전 v3를 만들고 전체 추출까지 해줘.

1. 라벨 합치기: pipeline/01e_merge_labels.py의 T1 규칙(agreed / agreed_partial / agreed_span / none / disagree)을
   그대로 재사용한다(새 규칙 금지). 출력: data/processed/v3/term_to_symptom_T3.csv
2. 새 증상: agreed된 ICPC 코드가 v2에 없으면 v2.1로 추가한다.
   이름·119 범주는 v2 때 만든 T2 라벨 합치기 결과를 그대로 쓴다(새 라벨링 없음). 추가 목록을 보고.
3. 사전 v3: data/processed/v3/symptom_synonym_v3.csv = v2 사전 + T3 채택분 (source=aihub_T3)
4. 전체 추출 → pipeline/03c_match_all.py
   - symptom_answers.csv 전체(28,886)에 사전 v3를 부분 문자열 매칭
   - 긴 표현 우선(겹치면 긴 쪽만), 같은 답변에서 같은 증상은 1번만 센다
   - 왼쪽 경계 규칙: 표현 앞이 문장 시작·공백·문장부호일 때만 매칭(예: "뇌출혈" 안의 "출혈"은 매칭하지 않음). 오른쪽은 조사가 붙으므로 제한하지 않음
   - config/symptom_exclusion.yaml 규칙 적용(S3-1 검토 후 확정본). 아직 설정값만 있는
     ignore_keyword_inside_term(부정 단서가 다른 사전 표현 안에 있으면 무시), window_stop_chars(쉼표·가운뎃점·마침표에서 부정 범위 끊기),
     min_term_length: 2 를 이 스크립트에서 실제로 구현한다
   - span 표현은 연결된 증상 모두에 0.5씩 센다(질환별 비율 계산 때)
   - LLM은 쓰지 않는다
5. 질환별 증상 → data/processed/v3/disease_symptom.csv
   (disease_ko, symptom_id, n_answers_mentioned, n_symptom_answers, share, kept)
   kept = share ≥ 0.20 그리고 n_answers_mentioned ≥ 3 (기준값은 config/recommend.yaml의 path_a 절)
6. 보고 → reports/step3_build.md
   - T3 status별 개수, 새로 추가된 증상
   - 사전 v2 → v3 표현 수
   - 전체 답변 매칭률(매칭 0개 답변 비율) v2 사전 대비 v3 사전
   - 제외 규칙으로 버려진 매칭 수와 예시 10개
   - kept 질환-증상 쌍 수, 질환당 kept 증상 수 분포, kept 증상이 0개인 질환 목록
   - 증상별로 연결된 질환 수 상위·하위 20개, 연결된 질환이 0개인 v2 증상 목록
```
