# 표준 증상 v2 생성 결과 (P3)

- 작성일: 2026-11-12
- 스크립트: `pipeline/01e_merge_labels.py` (규칙: `config/v2_merge.yaml`, `config/body_part_ui.yaml`, `config/symptom_exceptions.yaml`)
- 입력: P2 라벨 `data/interim/v2/labels/claude/`, `labels/codex/` (각 T1 235행, T2 240행)
- 수치 원본: `data/interim/v2/v2_build_stats.json` (스크립트가 만든다. 다시 돌려도 같은 결과)
- 주의: claude 라벨은 P1을 진행한 세션에서 만들었다(지시서의 "새 세션" 조건과 다름).

## 1. T1 (한국어 표현 → ICPC-2 코드)

| 전체 | agreed | agreed_partial | agreed_span | none | disagree |
|---|---|---|---|---|---|
| 235 | **167** | 18 | 13 | 20 | 17 |

- agreed: 두 평가자가 같은 코드를 고름. none: 둘 다 NONE.
- 후보 집합 일치 규칙(2026-11-12 추가, `config/v2_merge.yaml`의 `t1_candidate_overlap`): 평가자별 후보 집합(고른 코드, AMBIGUOUS면 note에 적은 코드)의 교집합이 1개면 agreed_partial, 2개 이상이면 agreed_span(그 코드들 모두에 매핑). 이 규칙으로 disagree 48개 중 31개가 살아났다. 기존 agreed·none 결과는 그대로다.
- disagree 17개는 동의어에 넣지 않았다. 런타임에서 LLM 해석 + 확인 질문으로 처리할 대상이다. 이 중 "질 출혈", "목·가슴 통증"은 codex가 AMBIGUOUS의 note에 코드를 적지 않아 교집합을 낼 수 없었다.
- 전체 목록: `data/processed/v2/term_to_icpc2.csv` (span은 final_code에 코드가 "; "로 여러 개)

### agreed_span 표현 13개

| 표현 | 코드 |
|---|---|
| 골반 통증 | X01, Y02 |
| 생식기 이상 | X29, Y29 |
| 목 통증 | L01, R21 |
| 발진 | S06, S07 |
| 킁킁거림 | P10, R08 |
| 피부 반점 | S06, S08 |
| 구역·구토 | D09, D10 |
| 기타 순환·호흡 증상 | K29, R29 |
| 기타 신경·근골격 증상 | L29, N29 |
| 뇌졸중 의심(한쪽 마비·말 어눌) | N18, N19 |
| 성장·발달 지연 | P22, T10 |
| 요도 분비물 | X29, Y03 |
| 혈변·검은 변 | D15, D16 |

## 2. T2 (ICPC 코드 → 119 범주, 한국어명)

| 항목 | 수 |
|---|---|
| 인정된 연결(코드×범주) | 86 |
| └ 양쪽 일치 | 69 |
| └ 한쪽만(one_rater) | 17 |
| 버려진 weak 연결(18·32·33을 한쪽만 고름) | **135** (전부 codex의 18) |
| 119 범주가 하나라도 연결된 코드 | 78 / 240 |

- 범주 18은 두 평가자가 모두 고른 4개 코드(A04, A05, A29, N17)에만 남았다.
- "자살 생각·이상 행동"은 두 평가자 모두 P29로 답했고, P29에는 범주 14가 연결되어 있다(강제 연결 규칙도 걸어 둠).

### one_rater 연결 17개 (사람 확인 필요)

| 코드 | 이름(v2 한국어) | 범주 | 고른 평가자 |
|---|---|---|---|
| A29 | 졸림·자주 넘어짐 등 기타 전신 증상 | 28 추락/낙상 | codex |
| F17 | 안경 관련 불편 | 21 눈 손상/질환 | codex |
| L02 | 등 통증 | 11 비외상성 요통 | codex |
| P16 | 만취 | 14 정신/행동장애/자살 | claude |
| P20 | 기억력·집중력 저하 | 12 의식장애/실신 | codex |
| P22 | 아이의 행동·발달 문제 | 14 정신/행동장애/자살 | codex |
| P23 | 청소년 행동 문제 | 14 정신/행동장애/자살 | codex |
| R04 | 호흡 이상(무호흡·코골이 등) | 8 심정지/호흡정지 | codex |
| S07 | 온몸 발진·붉어짐 | 9 알러지 | claude |
| S12 | 벌레 물림·쏘임 | 23 동물 교상 | claude |
| S17 | 까짐·긁힘·물집 | 29 출혈/열상 | codex |
| W01 | 임신인지 궁금함(생리 늦어짐) | 13 임신/분만/낙태 | codex |
| W03 | 임신 중 출혈 | 7 비외상성 출혈 | codex |
| W05 | 입덧 | 10 오심/구토 | codex |
| W17 | 출산 후 출혈 | 7 비외상성 출혈 | codex |
| X02 | 생리통 | 6 복통 | codex |
| X03 | 배란통(생리 사이 통증) | 6 복통 | codex |

- 이 중 F17, P23, S12, S17, W01, X03 6개 코드는 **이 연결 하나 때문에 v2에 들어갔다**(agreed 표현이 없음). 연결을 빼면 v2에서도 빠진다.

## 3. v2 증상 수

- **159개** = ICPC 코드 157 + 예외 2 (`data/processed/v2/standard_symptoms_v2.csv`)
- 240개 중 나머지 83개 코드는 포함 조건(agreed·agreed_partial·agreed_span 표현 1개 이상 / 119 범주 연결)을 만족하지 않아 `icpc2_symptoms_all.csv`에만 남아 있다.
- 후보 집합 일치 규칙으로 새로 들어온 코드 13개: D23, D25, K05, K07, L01, L29, R08, S04, S06, X29, Y02, Y03, Y29

| 장 | A 전신 | B 혈액 | D 소화기 | F 눈 | H 귀 | K 순환기 | L 근골격 | N 신경 | P 정신 | R 호흡기 | S 피부 | T 내분비 | U 비뇨 | W 임신 | X 여성 | Y 남성 | 예외 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 수 | 12 | 2 | 20 | 12 | 6 | 6 | 15 | 9 | 16 | 13 | 14 | 6 | 8 | 6 | 9 | 3 | 2 |

| 포함 근거(source) | 수 |
|---|---|
| 표현만 | 79 (그중 added_common 포함 5) |
| 표현 + 119 범주 | 46 (그중 added_common 포함 7) |
| 119 범주만 | 32 |
| 예외 | 2 |

- 동의어 파일 `symptom_synonym_v2.csv`: 213행 (동의어 161, 대표 26, span 26, 예외 대표명 2 포함). span 표현은 코드마다 한 행씩 들어간다.
- 관절별 코드(L08, L15 등)는 합치지 않았다. 2A 분포를 본 뒤 결정한다.
- K07(발·다리 부종)의 body_part_ui는 예외로 "팔다리·허리"다(`config/body_part_ui.yaml`).

### 예외 증상 (`config/symptom_exceptions.yaml`)

| id | 이름 | v1 | ICD-10 | 119 범주 | 이유 |
|---|---|---|---|---|---|
| EX01 | 여드름 | SYM056 | L70 | — | ICPC-2에 증상 코드 없음(S96은 진단 코드). 두 평가자 모두 NONE |
| EX02 | 두드러기 | SYM093 | L50 | 9 | ICPC-2에 증상 코드 없음(S98은 진단 코드). 두 평가자 모두 NONE |

- 예외는 "v1 항목이 unmapped이고 구성 표현을 두 평가자 모두 NONE으로 답한 경우"만 만들었다.
- 틱(SYM015)과 자살 생각(SYM014)은 ICPC 코드로 매핑되어(P10 등, P29) 예외가 되지 않았다.

### 이름(name_ko)

규칙(2026-11-12 변경): T1 표현은 이름에 쓰지 않고 동의어로만 쓴다. 두 평가자의 name_ko_proposal이 같으면 그 이름, 다르면 claude 제안을 쓰고 codex 제안을 name_ko_alt에 남긴다.

| name_status | 수 | 뜻 |
|---|---|---|
| agreed | 39 | 두 평가자 제안이 같음 |
| check | 118 | 제안이 다름 → claude 제안을 임시로 씀 (codex 제안은 name_ko_alt) |
| exception | 2 | 예외 증상 |

- check 118개에는 "발열 / 열이 남", "눈 모양·색 변화 / 눈의 모양·색 변화"처럼 표현만 조금 다른 것이 많다.
- 동의어 파일에서 term_type=대표(표현이 name_ko와 글자까지 같은 것)는 26개다.

## 4. v1 대응 (`data/processed/v2/v1_to_v2_map.csv`)

| one_to_one | split | merged | unmapped |
|---|---|---|---|
| 45 (예외 2 포함) | 27 | 23 | 0 |

- split 예시:
  - SYM031 복통 → D01 배 아픔, D02 명치 통증, D06 아랫배·옆배 통증, X01 여성 생식기·골반 통증, Y02 고환·음낭 통증 ("골반 통증"이 X01·Y02 span)
  - SYM058 관절통 → L08 어깨 통증·불편, L15 무릎 통증·불편, L16 발목 통증·불편, L20 관절 통증·부기
  - SYM077 목 아픔(인후통) → D21 삼키기 어려움, L01 목(뒷목) 통증·불편, R21 목 아픔·목 이물감 ("목 통증"이 L01·R21 span, "삼킴 통증"이 D21)
  - SYM087 혈변·검은 변 → D15 검은 변, D16 변에 피가 섞임
  - SYM051 발진 → S06 피부 한 곳의 발진·붉어짐, S07 온몸 발진·붉어짐
  - SYM046 요도 분비물 → X29 기타 여성 생식기 증상, Y03 요도 분비물(남성)
- merged 예시: SYM062·063·064·067(시력 저하, 시야 좁아짐, 겹쳐 보임, 눈부심) → F05 시야 흐림·시력 저하 / SYM073·084·085(콧물, 코막힘, 재채기) → R07 콧물·코막힘·재채기 / SYM013 환각·SYM014 자살 생각 → P29 환각·이상 행동 등 기타 정신 증상
- 이전에 unmapped였던 4개: SYM021 부기 → K07(one_to_one), SYM046·SYM051·SYM087 → split.
### 성별로 갈리는 span

`sex_restriction`(규칙: `config/v2_merge.yaml` — X·W장 female, Y장 male, 그 외와 예외 증상은 none)이 코드마다 다른 span 표현이다. 동의어 파일에도 `sex_restriction` 컬럼이 있으므로, 런타임에서 사용자 성별에 맞는 행만 쓰면 된다.

| 표현 | 코드 (sex_restriction) |
|---|---|
| 골반 통증 | X01 여성 생식기·골반 통증 (female) / Y02 고환·음낭 통증 (male) |
| 생식기 이상 | X29 기타 여성 생식기 증상 (female) / Y29 기타 남성 생식기 증상 (male) |
| 요도 분비물 | X29 기타 여성 생식기 증상 (female) / Y03 요도 분비물(남성) (male) |

- 나머지 span 10개는 모든 코드가 none이다.
- v2 전체: female 15, male 3, none 141.

## 5. 심평원 공유 코드

- `hira_shared_code=true`인 증상: **115 / 159**. 이 증상들은 2A 결과에 `hira_indistinct=true`로 표시된다.
- 공유 여부는 제외되지 않은 ICPC 코드 240개 기준이다(v2에 들어간 157개끼리만 따진 것이 아님).
- 159개 모두 심평원 통계에 환자 수가 있다(`hira_has_data=true`).

## 6. 수정한 파일

| 파일 | 바꾼 것 |
|---|---|
| `pipeline/step1_merge.py` | 맨 위 주석에 "v1 전용. v2부터 사용하지 않음(ICPC-2 기반 01b/01c로 대체)" 추가. 코드는 그대로 |
| `pipeline/step1_rcodes.py` | 맨 위 주석에 "v1 전용" 표시. 코드는 그대로 |
| `config/recommend.yaml` | `symptoms_file`(v2 파일), `symptom_code_column: icd10_3_list`, `symptom_code_separator`, `output_file` 추가 |
| `pipeline/step2a_department.py` | 증상 파일·코드 컬럼·출력 경로를 설정에서 읽음 / 코드 목록 중복 제거 후 코드별 환자수 합산 / `hira_indistinct` 컬럼 추가 / 출력 `symptom_department_v2.csv` / 메타는 `step2a_meta_v2.json`(v1 메타를 덮어쓰지 않음) |
| `data/curated/questionnaire/03_common.yaml` | N4 `symptom_mapping.target`을 v2 파일로, 주석을 v2 기준으로 수정. `report_field` 이름은 그대로 |
| `data/curated/questionnaire/04_pain.yaml` | 주석만 수정(부위 선택지는 v1 body_part 기준이며 v2 body_part_ui와 그룹 이름이 다름 — 확인 필요) |
| 팀 내부 문서(확정사항 및 방법론) | §2.3 출력 파일명, §3.4 머리말(v2 id 형식), §6 진행표의 1' 상태 |
| `reports/v2_impact.md` | P3 반영 결과 한 줄 추가 |
| `README.md` (새로 만듦) | 실행 순서, v1 폐기 표시, ICPC-2 출처, "배포 전 라이선스 확인 필요" TODO |
| `config/v2_merge.yaml`, `config/body_part_ui.yaml`, `config/symptom_exceptions.yaml`, `pipeline/01e_merge_labels.py` (새로 만듦) | 합치기 규칙과 스크립트 |

- 수정하지 않은 것:
  - **DB 지시서(§5, §8, source 표의 S8)**: 저장소에 사본이 없다(프로젝트 문서로 관리). 문서 쪽에서 직접 반영해야 한다.
  - `data/curated/standard_symptoms_v1.csv`, `candidate_to_standard_v1.csv`, `data/processed/symptom_department_v1.csv`: 그대로 둠.
- 확인차 실행한 것: `step2a_department.py`(v2 입력으로 159행 출력, fallback 0개), `step2b_validate.py`(errors 없음). **2A 결과 `data/processed/symptom_department_v2.csv`는 스크립트 동작 확인용으로 나온 것이고, 2A 단계의 검토는 아직 하지 않았다.**

## 7. 사람이 볼 목록

| 목록 | 경로 | 수 |
|---|---|---|
| 문진 YAML의 SYM id 참조 중 one_to_one이 아닌 것 | (없음) | 0 — 문진 YAML에 SYM id를 직접 적은 곳이 없다. N4는 증상 파일 경로만 참조한다 |
| name_status=check | `reports/v2_review_name_check.csv` | 118 (컬럼: symptom_id, icpc2_preferred, name_claude, name_codex, synonyms_top3) |
| triage_status=one_rater | `reports/v2_review_one_rater.csv` | 17 (위 2장 표와 같음) |
| v1 unmapped | `reports/v2_review_v1_unmapped.csv` | 0 (빈 파일) |

그 밖에 결정이 필요한 것:
1. `config/body_part_ui.yaml`의 L08(어깨) → 목·어깨: 지시서 예시에 없는 예외라 확인 필요. 턱(L07), 가슴 근골격(L04) 등은 기본값(팔다리·허리)으로 두었다.
2. 2B 통증 문진(04_pain.yaml)의 부위 선택지를 v2 body_part_ui 그룹에 맞출지.
