# data_pipeline — 의료 정보 도우미 AI 기준 데이터

증상 → 진료과 안내에 쓰는 기준 데이터(표준 증상, 일상 표현 사전, 진료과 추천)를 만드는 파이프라인이다.
방법과 결정 사항은 팀 내부 문서(확정사항 및 방법론)에 있다(저장소에는 포함하지 않는다).

- 모든 경로는 `data_pipeline/` 기준 상대 경로다. 스크립트는 `data_pipeline/`에서 `python pipeline/<파일>`로 돌린다.
- 여러 번 돌려도 결과가 같다(정렬 고정, 출력 CSV는 utf-8-sig).

## 폴더 구조

```
data_pipeline/
├── pipeline/              스크립트 (실행 순서는 아래 표)
├── config/                규칙·기준값·입출력 경로 (YAML), 이름 확정표 name_final_v2_1.csv
├── labels/                두 평가자(Claude Code, Codex)의 독립 라벨링 입력과 결과 — 아래 "라벨" 표
│   └── v2/ v3/ v4/
│       ├── inputs/        라벨링에 실제로 쓴 입력(항목·선택지·규칙)
│       ├── claude/        Claude Code 결과
│       └── codex/         Codex 결과
├── data/
│   ├── raw/               원본 (git 제외, 각자 받아 둔다)
│   ├── interim/           중간 산출물 (git 제외, 스크립트가 다시 만든다)
│   ├── frozen/            다시 만들지 않는 고정 입력 (아래 표)
│   └── processed/         최종 결과 v2/ v3/ v4/
├── reports/               빌드 보고서 (AI Hub 답변 문장은 넣지 않는다)
└── docs/                  설계 문서, 단계별 프롬프트 (확정사항 및 방법론은 팀 내부 문서로 저장소에 없음)
```

### `data/frozen/` 고정 입력

예전 단계(v1, 2A-1)에서 만든 결과로, 지금 파이프라인에서는 다시 만들지 않고 읽기만 한다.

| 파일 | 내용 | 읽는 스크립트 | git |
|---|---|---|---|
| `step1_symptom_candidates.csv` | 1단계 증상 후보 222개 (v2 라벨링 입력의 출처) | 01d, 01e | 올림 |
| `standard_symptoms_v1.csv`, `candidate_to_standard_v1.csv` | 표준 증상 v1(폐기, 기록용)과 후보 대응 | 01d, 01e(`v1_to_v2_map.csv`) | 올림 |
| `symptom_department_v2.csv` | 2A-1 결과(경로 B만, v2 163개). ICD-10 연결에서 나온 칸(icd10_3_list, codes_used)은 지웠다 | 04b(교차검증 미리보기), step2c(보고서 비교) | 올림 |
| `phrases_claude.csv`, `phrases_codex.csv` | S3-2에서 두 도구가 AI Hub 표본 답변을 읽고 뽑은 구절 | 03b (codex는 재현율 확인용, 없어도 됨) | **제외** (AI Hub 유래) |

## 실행 순서

라벨링 단계(표의 "라벨링")는 다시 하지 않고 `labels/`의 결과를 그대로 쓴다.
입력을 "만드는" 스크립트(01d, 03c_label_inputs_t3, 04a)는 `data/interim/`에 쓰고,
합치기 스크립트(01e, 03c_merge_labels_t3, 04b)는 `labels/`에서 읽는다.

| 순서 | 스크립트 | 하는 일 | 출력 |
|---|---|---|---|
| 1'-a | `01b_icpc2_extract.py` | ICPC-2 증상 코드 320개 추출, 제외 규칙 적용(240개 남음) | `data/interim/v2/icpc2_symptoms_all.csv` |
| 1'-b | `01c_icpc2_kcd_link.py` | ICD-10 → 상병마스터(KCD)·심평원 통계 연결, 3자리 코드 공유 표시 | `data/interim/v2/icpc2_kcd_link.csv` |
| 1'-c | `01d_label_inputs.py` | v2 라벨링 입력 만들기 | `data/interim/v2/label_*.csv`, `labeling_guide.md` |
| 1'-d | (라벨링) | 두 평가자가 서로 결과를 보지 않고 T1·T2 라벨링 | `labels/v2/<평가자>/T1.csv`, `T2.csv` (입력은 `labels/v2/inputs/`) |
| 1'-e | `01e_merge_labels.py` | 두 라벨을 합쳐 표준 증상 v2 생성 | `data/processed/v2/*.csv`, `reports/v2_review_*.csv`, ICPC 연결 `data/interim/v2/standard_icpc_link_v2.csv` |
| S3-1 | `03a_extract_symptom_answers.py` | AI Hub "증상" 답변 추출 + 질환별 표본 | `data/interim/v3/symptom_answers.csv` 외 |
| S3-2 | `03b_candidate_phrases.py` | 후보 구절 추출(규칙 + `data/frozen/phrases_claude.csv`) | `data/interim/v3/candidate_phrases.csv` |
| S3-3 | `03c_label_inputs_t3.py` | T3 라벨링 입력 만들기(띄어쓰기 표기 합침) | `data/interim/v3/label_*_T3.csv`, `labeling_guide_T3.md` |
| S3-4 | (라벨링) | 두 평가자가 각각 T3 라벨링 | `labels/v3/<평가자>/T3.csv` (입력은 `labels/v3/inputs/`) |
| S3-5a | `03c_merge_labels_t3.py` | T3 합치기(v2 T1 규칙) + 이름 확정 → 표준 증상 v2.1, 사전 v3 | `data/processed/v3/term_to_symptom_T3.csv`, `standard_symptoms_v2_1.csv`, `symptom_synonym_v3.csv`, ICPC 연결 `data/interim/v3/standard_icpc_link_v2_1.csv` |
| S3-5b | `03c_match_all.py` | 증상 답변 전체에 사전 v3 매칭 → 질환별 증상 | `data/processed/v3/disease_symptom.csv`, `reports/step3_build.md` |
| S3-5c | `03d_name_check_v2_1.py` | v2.1 이름 점검 목록(name_status=check인 증상) | `reports/name_check_v2_1.csv` |
| S4-1 | `04a_dept_label_inputs.py` | AI Hub 진료과 표기 → 라벨링 입력 만들기 | `data/interim/v4/` |
| S4-2 | (라벨링) | 두 평가자가 각각 진료과 표기 라벨링 | `labels/v4/<평가자>/dept.csv` (입력은 `labels/v4/inputs/`) |
| S4-3 | `04b_path_a.py` | 진료과 정리표(alias) → 질환별 진료과 → 경로 A | `data/processed/v4/department_alias.csv`, `disease_department.csv`, `symptom_department_path_a.csv` |
| 2A | `step2a_department.py` | 경로 B(심평원 통계)를 v2.1 증상으로 계산 | `data/processed/v4/symptom_department_path_b.csv`, `data/interim/v4/symptom_department_path_b_codes.csv`(쓴 코드), `data/interim/v4/code_chapter_spread.csv` |
| 2A-2 | `step2c_combine.py` | 경로 A + B 합치기 → 최종 진료과 추천, fallback 진료과 | `data/processed/v4/symptom_department_final.csv`, `fallback_departments.csv`, `reports/2A2_build.md` |

한 번에 돌리기 (bash):

```bash
cd data_pipeline
for s in 01b_icpc2_extract 01c_icpc2_kcd_link 01d_label_inputs 01e_merge_labels \
         03a_extract_symptom_answers 03b_candidate_phrases 03c_label_inputs_t3 \
         03c_merge_labels_t3 03c_match_all 03d_name_check_v2_1 \
         04a_dept_label_inputs 04b_path_a step2a_department step2c_combine; do
  python pipeline/$s.py || break
done
```

- 필요한 패키지: Python 3, `openpyxl`, `ruamel.yaml` (`pip install openpyxl ruamel.yaml`)
- `03a`는 AI Hub 분할 zip(약 330MB)을 읽어서 몇 분 걸린다. 질환 수 564(기대값 562) 경고는 정상이다. 근거: 팀 내부 문서(확정사항 및 방법론) 4-2.
- 01e·03d가 쓰는 `reports/v2_review_*.csv`, `reports/name_check_v2_1.csv`는 사람이 볼 점검 목록이라 저장소에는 넣지 않았다. 필요하면 다시 만든다.
- 1단계(step1_*)·2A-1(v2)·2B 스크립트는 이 폴더에 없다. 그 결과 중 지금 쓰는 것은 `data/frozen/`에 있다.

## 라벨 (`labels/`)

두 평가자(Claude Code, Codex)가 같은 입력·규칙으로 서로의 결과를 보지 않고 라벨링했다. 합치기 규칙은 팀 내부 문서(확정사항 및 방법론) 4.3.

| 폴더 | 과제 | 항목 | 선택지 | 결과 컬럼 | 합치는 스크립트 → 결과 |
|---|---|---|---|---|---|
| `labels/v2/` T1 | 한국어 증상 표현 → ICPC-2 증상 코드 | `label_items_T1.csv` 235개 (step1 후보 + v1 추가 표현) | `label_options_T1.csv` 240코드 + NONE·AMBIGUOUS | item_id, icpc2_code, confidence, note | 01e → `term_to_icpc2.csv`, `symptom_synonym_v2.csv` |
| `labels/v2/` T2 | ICPC-2 코드 → 119 주증상 범주 + 한국어 이름 제안 | `label_items_T2.csv` 240코드 | `label_options_T2_triage.csv` 범주 0~33 | code, triage_category, name_ko_proposal, note | 01e → `standard_symptoms_v2.csv` |
| `labels/v3/` T3 | AI Hub 증상 답변 구절 → ICPC-2 코드(D20 하위 코드 포함) | `label_items_T3.csv` 1,122개 (10개 이상 답변에 나온 구절) | `label_options_T3.csv` 244코드 + NONE·AMBIGUOUS | item_id, icpc2_code, confidence, note | 03c_merge_labels_t3 → `term_to_symptom_T3.csv`, `standard_symptoms_v2_1.csv`, `symptom_synonym_v3.csv` |
| `labels/v4/` dept | AI Hub 진료과 표기 → 표준 진료과 | `dept_raw_values.csv` 50개 | `label_options_dept.csv` 의원급 표시과목 + 추가 과 + DROP·AMBIGUOUS | raw_value, dept, note | 04b → `department_alias.csv` |

- `labels/v3/inputs/label_items_T3.csv`는 저장소에 AI Hub 문장이 남지 않도록 예문(example) 칸을 지웠다. 합치기에는 그 칸을 쓰지 않는다.
- `labels/v2/inputs/label_items_T2.csv`, `label_options_T1.csv`, `labels/v3/inputs/label_options_T3.csv`는 ICPC-2 원본 문구(preferred·inclusion·exclusion)를 지우고 `code`, `chapter_ko`만 남겼다(합치기는 code만 읽는다).
  평가자가 실제로 본 전체 입력은 ICPC-2e 원본을 `data/raw/icpc2/`에 둔 뒤 `01d`, `03c_label_inputs_t3`를 돌리면 `data/interim/`에 그대로 다시 만들어진다(2026-11-14 바이트 단위로 확인).
- 표준 증상 파일(`data/processed/v2/standard_symptoms_v2.csv`, `v3/standard_symptoms_v2_1.csv`)에는 ICPC-2 원본에서 온 칸(영어 이름, ICD-10 연결표와 거기서 나온 값)이 없다.
  그 칸은 `data/interim/.../standard_icpc_link_*.csv`(git 제외)에 있고, 읽는 스크립트가 `pipeline/icpc_link.py`로 다시 붙인다. 시드(`06a`)는 이 칸 없이 만들 수 있다.
- `labels/v4/inputs/label_options_dept.csv`는 라벨링 당시 파일이다. 지금 04a를 돌리면 `의학유전학과`의 `excluded_in_2a`가 true로 나온다(2A 제외 규칙이 나중에 바뀜). 04b는 과 이름만 읽으므로 결과에는 영향이 없다.

## 원본 데이터 받기 (`data/raw/`)

원본은 재배포할 수 없어서 저장소에 없다. 각자 받아서 `data/raw/`에 아래 이름 그대로 둔다(스크립트는 파일 이름의 키워드로 찾는다).

| 데이터 | 받는 곳 | 둘 위치 |
|---|---|---|
| AI Hub 「초거대AI 사전학습용 헬스케어 질의응답」(71762) Validation(VL) | AI Hub(aihub.or.kr) 가입·이용 신청 후 다운로드. 분할 파일 `VL.zip.part0` … 그대로 둔다(이름 변경 불필요) | `data/raw/VL.zip.part0` … |
| 건강보험심사평가원 상병마스터 | 공공데이터포털(data.go.kr) | `data/raw/건강보험심사평가원_상병마스터_20250930.csv` |
| 심평원 병원급 이상 진료과목별 상병 통계 | 공공데이터포털 | `data/raw/건강보험심사평가원_병원급이상 진료과목별 상병 통계_20251231.csv` |
| 심평원 의원급 표시과목별 상병 통계 | 공공데이터포털 | `data/raw/건강보험심사평가원_의원급 표시과목별 상병 통계_20251231.csv` |
| ICPC-2e v7.0 (영어판) | Norwegian Directorate of eHealth (ehelse.no) | `data/raw/icpc2/icpc-2e-v7.0.xlsx` |
| 119 구급상황관리센터 상담 매뉴얼(2020) | 소방청 자료 (각자 확보) | 스크립트는 읽지 않는다. 주증상 범주 33개는 `config/triage_119.yaml`에 옮겨 두었다 |

- 심평원 파일 이름은 `상병마스터`, `의원급`+`표시과목`, `병원급`+`진료과목`이 들어가면 된다. 인코딩은 cp949·utf-8-sig 모두 읽는다.
- 원본을 다른 곳에 두려면 환경 변수 `MH_RAW_DIR`에 그 폴더를 지정한다(상대 경로면 `data_pipeline/` 기준). 없으면 `data/raw/`.

```bash
MH_RAW_DIR=/path/to/raw python pipeline/01b_icpc2_extract.py   # bash
$env:MH_RAW_DIR = "D:\path\to\raw"                              # PowerShell
```

## `.env` 설정

`.env.example`을 `.env`로 복사해서 값을 채운다. `.env`는 git에 올리지 않는다.

| 키 | 용도 |
|---|---|
| `SUPABASE_DB_URL` | 마이그레이션·적재·검증용 DB 연결(Session pooler, 5432). `06b`·`06c`·`06e`·`07a`가 변수로만 읽는다 |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | 검증 스크립트(`06e`·`07a`)의 REST 호출 |
| `MH_RAW_DIR` (선택) | 원본 폴더 위치. 1~4단계 스크립트는 `.env`를 자동으로 읽지 않으므로 셸 환경 변수로 지정한다 |

## DB 구성 (Supabase, 6·7단계)

| 스키마 | 내용 | 권한 |
|---|---|---|
| `ref` | 참조 데이터: 증상·사전·진료과·추천(성별·나이 경우별 포함)·fallback·앱 설정, 함수 `ref.recommend_departments` | anon·authenticated는 select와 함수 실행만. 쓰기는 적재 스크립트만 |
| `app` | 회원 데이터: account, consent_event(+ consent_current 뷰), favorite, search_setting, health_profile | authenticated만, 본인 행만(RLS). anon 권한 없음 |
| `private` | 트리거·security definer 함수(Data API에 노출하지 않음) | authenticated는 usage와 `has_consent` 실행만 |

Data API의 Exposed schemas에는 `ref`, `app`을 넣는다(`private`는 넣지 않는다).

실행 순서 (`data_pipeline/`에서, `pip install "psycopg[binary]"` 필요):

```bash
python pipeline/06a_build_seed.py                     # 시드 CSV → db/seed/<data_version>/ (접속 없음)
python pipeline/06d_build_intake_seed.py              # 문진 시드(config/intake_v1.yaml, D5 검사 포함)
python pipeline/06f_build_i18n_seed.py                # 다국어 번역 시드(config/i18n_v1.csv → text_i18n.csv, care_engine/docs/다국어_설계.md)
python pipeline/06c_run_migrations.py db/migrations/001_ref_schema.sql db/migrations/001b_ref_functions.sql \
                                      db/migrations/003_ref_intake.sql db/migrations/004_drop_icpc_text.sql                                       db/migrations/005_ref_i18n.sql
python pipeline/06b_load_supabase.py --dry-run        # 행 수·컬럼 순서·FK 검사 (접속 없음)
python pipeline/06b_load_supabase.py                  # ref 적재 (문진 포함, 한 트랜잭션)
python pipeline/06e_verify_ref.py                     # → reports/step6_load.md
python pipeline/07b_verify_intake.py                  # → reports/step7_intake.md
python pipeline/06c_run_migrations.py db/migrations/002_app_schema.sql
python pipeline/07a_verify_app.py                     # → reports/step7_app_schema.md (가짜 사용자로 확인 후 rollback)
```

- `004_drop_icpc_text.sql`은 `ref.symptom`에서 ICPC-2 원본에서 온 칸(`icpc2_preferred`, `icd10_3`)을 뺀다(아래 ICPC-2 사용 고지).

- 마이그레이션은 다시 실행해도 같은 상태가 된다. `06c ... --rollback`은 실행해 보고 되돌린다.
- 진료과 이름 → `dept_id`는 `config/department_id.csv`, 프론트 검색 키는 `config/dept_search_key.csv`
  (`06a --refresh-search-key`가 `../frontend/departments.mjs`를 읽어 다시 만든다).

## 데이터 원칙

- `data/raw/` 원본은 읽기만 한다. 수정·이동·삭제하지 않는다.
- AI Hub 원본과 샘플, `data/interim/`, `.env`, AI Hub 유래 구절(`data/frozen/phrases_*.csv`)은 커밋하지 않는다(`.gitignore`).
- 질환 단위 데이터(`data/processed/v3/disease_symptom.csv`, `v4/disease_department.csv`, `v4/symptom_department_path_a.csv`)는 커밋하지 않고 DB에도 올리지 않는다. 스크립트로 다시 만든다.
- `reports/`와 커밋되는 파일에는 AI Hub 답변 문장을 넣지 않는다. 예시가 필요하면 `data/interim/`에 둔다.
- 사용자 원문을 저장하는 컬럼이나 파일은 만들지 않는다. 사용자에게 질환명·진단은 보여주지 않는다.
- 출력 CSV는 utf-8-sig. 한글 입력 파일은 cp949와 utf-8-sig를 모두 시도한다.

## ICPC-2 사용 고지

- ICPC-2(International Classification of Primary Care, 2nd edition)의 저작권은 WONCA(World Organization of Family Doctors)에 있고, WONCA International Classification Committee(WICC)가 관리한다.
- 사용한 파일: ICPC-2e v7.0 (2018-02-20), Norwegian Directorate of eHealth 배포
  (<https://ehelse.no/kodeverk-terminologi/icpc-2e--english-version>)
- 이 저장소는 한림대학교 캡스톤디자인의 비영리 학술 프로젝트다. ICPC-2 코드는 증상 식별자로만 쓰고,
  한국어 증상명은 팀이 작성했다(ICPC-2의 공식 한국어판이 아니다).
- ICPC-2 원본 파일과 원본 문구(영어 이름·포함/제외 기준·ICD-10 연결표 등)는 저장소에 포함하지 않는다.
  재현하려면 위 배포처에서 각자 받아 `data/raw/icpc2/`에 둔다(위 "원본 데이터 받기" 표).
- 이전 커밋에 들어간 원본 문구는 다음 커밋부터 정리하지만, 이전 커밋 이력에는 남아 있을 수 있다.
- 앱이 읽는 DB(`ref.symptom`)에는 ICPC-2 원본 문구 칸을 두지 않는다(`004_drop_icpc_text.sql`).

## 출처

- ICPC-2e v7.0 (International Classification of Primary Care, WONCA). 배포처: Norwegian Directorate of eHealth
- 건강보험심사평가원 상병마스터(2025-09-30), 병원급 이상 진료과목별·의원급 표시과목별 상병 통계(2025-12-31)
- AI Hub 초거대AI 사전학습용 헬스케어 질의응답 데이터, 119 상담 매뉴얼 주증상 범주 (상세는 팀 내부 문서(확정사항 및 방법론))

## TODO

- [ ] **ICPC-2 원본 문구 정리**: DB(`ref.symptom`)에서는 뺐다(004). 저장소의 labels·data/processed·config·reports에는
      아직 영어 원문(preferred·inclusion·exclusion)과 ICD-10 연결표가 남아 있다 → 정리 계획을 정한 뒤 진행.
- [ ] 원본 xlsx의 시트 이름이 `icpc-2e-v6..0`으로 되어 있다(파일명은 v7.0). 버전 확인 필요.
