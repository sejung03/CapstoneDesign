# 1'단계 프롬프트: ICPC-2 기반 표준 증상표 v2 만들기

> 사용 순서
> 1. **P1 (Claude Code)**: 준비, 영향 범위 조사 → 멈추고 보고
> 2. **P2 (라벨링)**: 같은 지시문을 **Claude Code 새 세션**과 **Codex**에서 각각 따로 실행
> 3. **P3 (Claude Code)**: 두 라벨 합치기 → v2 생성 → 기존 파일 수정 → 보고
>
> 폴더: 스크립트는 기존 `pipeline/` 폴더에 둔다(`pipeline/` 대신). 119 범주 33개는 DB 지시서 §4.3 목록이 기준이다.
>
> 시작 전에 할 일: `C:\Users\hsjen\Downloads\ICPC-2e-v7.0\` 폴더 전체를 프로젝트의 `data/raw/icpc2/`에 복사해 두세요.

---

## P1 — Claude Code: 준비와 영향 범위 조사

```
우리 프로젝트(의료 정보 도우미 AI)의 표준 증상 목록을 v1(내가 임의로 묶은 95개)에서
ICPC-2(WONCA 국제 1차진료 분류) 기반 v2로 바꾼다. 이번 작업은 P1(준비)까지만 하고 멈춰서 보고해.

## 지켜야 할 원칙
- data/raw/ 원본은 수정·이동·삭제 금지. 읽기만 한다.
- AI Hub 원본, data/interim/, .env는 커밋하지 않는다(.gitignore 확인).
- 기존 v1 파일은 지우지 않는다. archive 폴더로 옮기지 말고 그대로 두고, 나중에 README에 "폐기됨(v2로 대체)"만 표시한다.
- 사용자 원문을 저장하는 컬럼이나 파일은 만들지 않는다.
- 추측으로 채우지 말고, 모르면 보고서에 "확인 필요"로 적는다.
- 스크립트는 여러 번 돌려도 같은 결과가 나와야 한다(멱등). 출력 CSV는 utf-8-sig, 한글 입력은 cp949와 utf-8-sig를 모두 시도한다.

## 입력
- data/raw/icpc2/icpc-2e-v7.0.xlsx
  (시트 1개, 컬럼: Code, preferred, shortTitle, inclusion, exclusion, criteria, consider, note, icd10)
- 표준 증상 v1: standard_symptoms_v1.csv, candidate_to_standard_v1.csv
  (프로젝트 안 위치를 찾아서 사용. 없으면 멈추고 알려줘)
- 1단계 후보: step1_symptom_candidates.csv (222개)
- R코드 진료과 비율: r_codes_named.csv
- 심평원 상병마스터: data/raw/ 안의 "건강보험심사평가원_상병마스터_20250930" 파일
- 심평원 병원급·의원급 진료과목별 상병 통계 (data/raw/)
- 119 상담 매뉴얼 주증상 범주 33개 (기존 DB 지시서 §4.3 목록)

## 할 일

### 1. ICPC-2 증상 코드 추출 → pipeline/01b_icpc2_extract.py
- Code가 "영문자 1개 + 숫자 2개"이고 숫자가 01~29인 행만 고른다
  (component 1 = 증상·호소. 320개여야 함. 아니면 보고).
- 장(chapter) 이름 컬럼을 붙인다:
  A 전신, B 혈액, D 소화기, F 눈, H 귀, K 순환기, L 근골격, N 신경, P 정신,
  R 호흡기, S 피부, T 내분비·대사, U 비뇨, W 임신·출산·가족계획, X 여성 생식기,
  Y 남성 생식기, Z 사회 문제
- icd10 컬럼을 "; "로 나눠 리스트로 만들고, 3자리 코드(icd10_3)도 따로 만든다.
- 앱 안내 대상에서 빼는 규칙(결정적 규칙, config/icpc2_filter.yaml에 둔다):
  - Z장 전체(사회 문제는 진료과 안내 대상이 아님)
  - preferred가 "Fear"로 시작하는 코드(질병에 대한 걱정. "Fear of …" 37개 + X27 여성 생식기·유방 질환 걱정(기타))
  - preferred가 "Limited function/disability"로 시작하는 코드(기능 제한)
  - 이 규칙으로 빠진 코드는 excluded_reason을 남기고 목록을 보고서에 싣는다.
  - 검증값: Z장 27개, Fear 38개(Fear of 37 + X27), Limited function 16개(겹침은 Z27: Z장·Fear) → 남는 코드 240개.
    다르게 나오면 멈추고 보고한다.
- 공유 묶음: 3자리 코드 하나 = 묶음 하나(79개). 증상 하나가 여러 묶음에 속할 수 있으므로 목록으로 저장한다.
- 출력: data/interim/v2/icpc2_symptoms_all.csv
  (code, chapter, chapter_ko, preferred, short_title, inclusion, exclusion,
  icd10_list, icd10_3_list, excluded, excluded_reason)

### 2. ICD-10 → KCD·심평원 연결 확인
- 상병마스터에 icd10 코드(4자리, 3자리)가 있는지 확인하고, 있으면 KCD 한글명을 붙인다.
- 심평원 병원급·의원급 통계에 그 3자리 코드의 환자 수가 있는지 표시한다.
- **여러 ICPC 코드가 같은 3자리 코드를 공유하는 경우**(예: D01·D02·D06 → R10)를
  hira_shared_code=true로 표시하고, 공유하는 코드끼리 묶음 번호를 붙인다.
  심평원 통계로는 이 코드들을 구분할 수 없다는 뜻이다.
- 출력: data/interim/v2/icpc2_kcd_link.csv

### 3. 라벨링 입력 파일 만들기 (라벨 자체는 하지 않는다)
- data/interim/v2/label_items_T1.csv: 매핑할 한국어 증상 표현
  - step1 후보 222개 + v1의 added_common 13개 (v1 보류 5개는 222개 안에 이미 있음). term_ko 기준 중복 제거
  - 컬럼: item_id(T1-001…), term_ko, source(step1/added_common/held), v1_symptom_id(있으면)
- data/interim/v2/label_options_T1.csv: 고를 수 있는 선택지
  - 1번에서 excluded=false인 ICPC 코드 + "NONE"(증상이 아님/해당 코드 없음) + "AMBIGUOUS"(둘 이상에 걸쳐 애매함)
  - 컬럼: code, chapter_ko, preferred, inclusion, exclusion (영어 원문 그대로)
- data/interim/v2/label_items_T2.csv: excluded=false인 ICPC 코드 전체
  (code, chapter_ko, preferred, inclusion, exclusion)
- data/interim/v2/label_options_T2_triage.csv: 119 주증상 범주 1~33 + 0(해당 없음)
- data/interim/v2/labeling_guide.md: 아래 "라벨링 규칙" 전문을 그대로 저장

라벨링 규칙 (labeling_guide.md에 그대로 넣기):
---
[T1] 한국어 증상 표현 → ICPC-2 코드
- 각 item에 대해 label_options_T1.csv 안의 code 하나만 고른다. 목록에 없는 코드는 쓰지 않는다.
- 판단 기준은 preferred, inclusion, exclusion 문구다. exclusion에 해당하면 그 코드를 고르지 않는다.
- 같은 증상의 부위·성격이 표현에 드러나면 더 구체적인 코드를 고른다
  (예: "명치 통증" → D02, "배 아픔" → D01).
- 질병명·검사·약 이름 등 증상이 아니면 NONE.
- 두 코드 이상에 똑같이 걸치면 AMBIGUOUS. 억지로 고르지 않는다.
- 출력 컬럼: item_id, icpc2_code, confidence(high/low), note(한 줄, 선택)

[T2] ICPC-2 코드마다 두 가지
(a) triage_category: label_options_T2_triage.csv에서 그 증상이 주증상인 119 범주를 고른다.
    여러 개면 ";"로 나열한다. 없으면 0.
(b) name_ko_proposal: 일반인이 이해하는 짧은 한국어 증상명(예: "명치 통증", "콧물·코막힘").
    진단명처럼 들리는 말은 쓰지 않는다.
- 출력 컬럼: code, triage_category, name_ko_proposal, note
---

### 4. v1 → v2 영향 범위 조사 → reports/v2_impact.md
프로젝트 전체에서 아래를 검색해서, 고쳐야 할 파일과 위치(줄 번호)를 표로 정리한다.
- "standard_symptoms_v1", "candidate_to_standard_v1", "SYM0"(v1 symptom_id), "kcd_codes",
  "symptom_id", "RCODE_MAP", "MERGE_GROUPS", "r_codes_seed", "triage_category"
- 특히 다음은 반드시 확인한다:
  a. pipeline/step1_merge.py (RCODE_MAP, MERGE_GROUPS, TRIAGE): v1 묶음 규칙. v2에서는 쓰지 않는다
  b. 2단계 프롬프트/스크립트(2A 진료과 추천): 입력이 v1 kcd_codes → v2 icd10_3_list로 바뀜
  c. config/recommend.yaml: 증상 파일 경로, symptom_id 형식
  d. 2B 문진 YAML(data/curated/questionnaire/): SYM id를 참조하는지
  e. DB 지시서(DB구축 프롬프트 md)의 §5 스키마 symptom 테이블, §8 작업 순서
  f. README의 실행 순서
- 각 항목에 "수정 내용(예정)"과 "P3에서 자동 수정 가능/사람 결정 필요"를 적는다.

## 보고 (여기서 멈춤)
- ICPC 증상 코드 수, 제외된 코드 수와 목록, 남은 선택지 수
- 상병마스터·심평원 통계에 없는 ICD-10 코드 목록
- 심평원 3자리 코드를 공유하는 묶음 수와 예시 5개
- 라벨링 입력 파일 경로와 행 수
- v2_impact.md 요약(수정할 파일 수, 사람 결정이 필요한 항목)
```

---

## P2 — 라벨링 (Claude Code 새 세션, Codex 각각 따로)

> 두 도구에 **같은 지시문**을 넣고, `{TOOL}` 자리만 각각 `claude` / `codex`로 바꿔서 실행하세요.
> Claude Code는 P1을 한 세션이 아니라 **새 세션**에서 실행하세요.

```
data/interim/v2/labeling_guide.md를 읽고 그 규칙대로 라벨링해.

- 입력: data/interim/v2/label_items_T1.csv, label_options_T1.csv,
        label_items_T2.csv, label_options_T2_triage.csv
- 출력: data/interim/v2/labels/{TOOL}/T1.csv, data/interim/v2/labels/{TOOL}/T2.csv
- data/interim/v2/labels/ 아래의 다른 폴더는 절대 열지 마. 다른 평가자 결과를 보면 안 된다.
- 선택지 파일에 없는 코드는 쓰지 마. 모든 item에 한 줄씩 빠짐없이 답한다.
- 스크립트로 규칙을 만들어 자동 분류하지 말고, item마다 직접 판단해서 작성한다.
  (단, 파일 읽기·쓰기에는 스크립트를 써도 된다)
- 끝나면 T1의 NONE·AMBIGUOUS 개수와 T2의 triage 연결 개수만 짧게 알려줘.
```

---

## P3 — Claude Code: 합치기, v2 생성, 기존 파일 수정

```
P2 라벨링 결과 두 개(data/interim/v2/labels/claude/, labels/codex/)를 합쳐서
표준 증상 v2를 만들고, reports/v2_impact.md에 정리한 파일들을 수정해.
원칙은 P1과 같다(원본 수정 금지, v1 파일 삭제 금지, 멱등, utf-8-sig).

## 1. 합치기 → pipeline/01e_merge_labels.py (규칙은 config/v2_merge.yaml)
T1 (표현 → ICPC 코드)
- 두 평가자가 같은 코드(NONE·AMBIGUOUS 제외) → status=agreed, 채택
- 둘 다 NONE → status=none, 버림
- 그 외(코드가 다름, 한쪽이라도 AMBIGUOUS) → status=disagree, 동의어에서 제외
  (런타임에서 LLM 해석 + 확인 질문으로 처리할 대상)
- 출력: data/processed/v2/term_to_icpc2.csv
  (item_id, term_ko, source, code_claude, code_codex, final_code, status)

T2 (코드별 119 범주, 한국어명)
- triage_category: 두 결과의 **합집합**을 쓴다. 응급 연결을 놓치지 않기 위해서다.
  한쪽에만 있는 연결은 triage_status=one_rater로 표시한다.
  - 예외: "기타" 범주 18·32·33은 **두 평가자가 모두 고른 경우만** 인정한다(config의 weak_categories).
    한쪽만 고른 18·32·33은 버린다. (2026-11-12: codex가 18을 기본값처럼 139개에 붙인 것을 확인하고 추가한 규칙)
- name_ko 결정 순서:
  1) 이 코드에 agreed로 매핑된 T1 표현 중 step1 출현 빈도가 가장 높은 표현
     (빈도 정보가 없으면 v1 name_ko)
  2) 1)이 없고 두 평가자의 name_ko_proposal이 같으면 그 이름
  3) 둘 다 아니면 claude 제안을 임시로 쓰고 name_status=check 표시
     (codex 제안도 name_ko_alt에 남긴다)

## 2. v2에 포함할 코드 정하기
- 포함 조건(하나라도 만족): T1에서 agreed로 매핑된 표현이 1개 이상 /
  T2에서 119 범주가 연결됨 / v1 added_common 항목이 agreed로 매핑된 코드
- 위 조건을 만족하지 않는 ICPC 코드는 v2에 넣지 않고 icpc2_symptoms_all.csv에만 남긴다
  (나중에 3단계 562×5 추출에서 나오면 추가한다).
- ICPC가 너무 잘게 나눈 코드(예: 관절별 L08, L15…)는 **지금 합치지 않는다.**
  2A에서 진료과 분포를 본 뒤, 분포가 같은 코드끼리만 합치고 근거를 남긴다.
- ICPC에 맞는 코드가 없는데 v1에 있던 증상(예: 자살 생각, 틱, 여드름)은
  symptom_id를 "EX01", "EX02"… 로 따로 만든다(ICPC X장 코드와 겹치지 않게).
  예외는 라벨링 결과 v1 항목이 unmapped일 때만 만들고, config/symptom_exceptions.yaml에
  이름·ICD-10·119 범주·이유를 적는다. 자살 생각은 라벨 결과와 관계없이 119 범주 14와 반드시 연결한다.

## 3. 표준 증상 v2 파일 → data/processed/v2/standard_symptoms_v2.csv
컬럼:
symptom_id (= ICPC 코드, 예외는 EX01…), icpc2_code, icpc2_preferred, chapter, chapter_ko,
name_ko, name_status, name_ko_alt, body_part_ui, icd10_list, icd10_3_list,
kcd_name_ko, hira_has_data, hira_shared_code, hira_shared_codes(다른 ICPC 코드와 공유하는 3자리 코드 목록),
triage_category, triage_status, n_terms_agreed, source, note

- body_part_ui: config/body_part_ui.yaml의 "장 → 화면 그룹" 기본값을 쓰고,
  예외만 코드별로 덮어쓴다. 기본값:
  A→전신, B→전신, D→배, F→눈, H→귀, K→가슴, L→팔다리·허리, N→머리·신경,
  P→마음, R→코·목·가슴, S→피부, T→전신, U→소변, W→임신, X→여성, Y→남성
  예외 예: D19·D20(치아·잇몸, 입·혀) → 입·치아 / L01(목) → 목·어깨 / L02·L03 → 허리·등
  (예외 목록은 yaml에 근거 한 줄과 함께 적는다)
- 동의어 파일: data/processed/v2/symptom_synonym_v2.csv
  (symptom_id, term, term_norm, term_type(대표/동의어), source, status=agreed)

## 4. v1 대응표 → data/processed/v2/v1_to_v2_map.csv
- v1 symptom_id마다 그 구성 표현(members)이 T1에서 agreed로 간 ICPC 코드 목록을 적는다.
- 구분: one_to_one / split(v1 1개 → v2 여러 개) / merged(v1 여러 개 → v2 1개) / unmapped
- 요약 수치를 보고서에 넣는다.

## 5. 기존 파일 수정 (reports/v2_impact.md 기준)
자동으로 수정할 것:
a. pipeline/step1_merge.py: 코드는 그대로 두고, 파일 맨 위 주석에
   "v1 전용. v2부터 사용하지 않음(ICPC-2 기반 01b/01c로 대체)" 추가
b. config/recommend.yaml: 증상 입력 경로 → standard_symptoms_v2.csv,
   증상 코드 컬럼 → icd10_3_list, symptom_id 형식 → ICPC 코드
c. 2A(진료과 추천) 스크립트/프롬프트 입력부:
   - 증상 하나에 3자리 코드가 여러 개면 심평원 환자 수를 코드별로 합산(중복 없이)
   - hira_shared_code=true인 증상은 결과에 hira_indistinct=true를 남긴다.
     이런 증상의 최종 순위는 AI Hub 경로 A를 우선하고, 심평원 경로 B는 교차검증 참고로만 쓴다
     (2A 단계에서 적용. P3에서는 표시 컬럼만 준비)
   - 증상 파일 경로는 config/recommend.yaml에 둔다
   - 출력 파일명은 symptom_department_v2.csv
d. 2B 문진 YAML: SYM 형식 id를 참조하면 v1_to_v2_map으로 바꾼다.
   one_to_one이 아닌 경우는 바꾸지 말고 목록만 보고한다.
e. DB 지시서 md(저장소 안의 사본):
   - §5 symptom 테이블 → symptom(id, icpc2_code, name_ko, chapter, body_part_ui,
     icd10_codes, triage_category_ids, hira_shared_group, status, source_id)
   - §8 작업 순서에 "1'. 표준 증상 v2(ICPC-2) 완료" 추가, v1은 폐기 표시
   - source 표에 S8: ICPC-2e v7.0 (Norwegian Directorate of eHealth) 추가
f. README: 실행 순서에 01b → (P2 라벨링) → 01c 추가, v1 폐기 표시,
   ICPC-2 출처와 "배포 전 라이선스 확인 필요" TODO 추가

사람이 결정해야 해서 수정하지 않고 보고만 할 것:
- d에서 one_to_one이 아닌 문진 참조
- name_status=check인 증상 목록
- triage_status=one_rater인 연결 목록

## 6. 보고 → reports/v2_build.md
- T1: 전체 수, agreed / none / disagree 개수
- T2: triage 연결 수(양쪽 일치 / 한쪽만)
- v2 증상 수(ICPC + 예외), 장별 개수
- v1 대응: one_to_one / split / merged / unmapped 개수와 split 예시
- hira_shared_code 증상 수
- 수정한 파일 목록과 각각 무엇을 바꿨는지
- 사람이 볼 목록 3가지(문진 참조, name check, one_rater) 경로
```

---

## 이번 단계에서 수정되는 것 한눈에 보기

| 대상 | 수정 내용 | 방식 |
|---|---|---|
| `standard_symptoms_v1.csv`, `candidate_to_standard_v1.csv` | 그대로 둠, README에 폐기 표시 | 자동 |
| `pipeline/step1_merge.py` | v1 전용 주석 추가 | 자동 |
| `config/recommend.yaml` | 입력 경로·코드 컬럼·id 형식을 v2로 | 자동 |
| 2A 진료과 추천 | 다중 코드 합산, 공유 코드 표시, 출력 v2 | 자동 |
| 2B 문진 YAML | SYM id → ICPC id (1:1만) | 자동 + 보고 |
| DB 지시서 §2·§5·§8 | ICPC 출처, symptom 스키마, 순서 | 자동 |
| README | 실행 순서, 출처, 라이선스 TODO | 자동 |
| 새 설정 | `icpc2_filter.yaml`, `v2_merge.yaml`, `body_part_ui.yaml` | 신규 |
| 새 스크립트 | `01b_icpc2_extract.py`, `01e_merge_labels.py` | 신규 |
