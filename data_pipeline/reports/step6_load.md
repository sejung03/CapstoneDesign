# 6단계 적재 검증 (ref 스키마)

- data_version: `v2.1-20261113`
- 마이그레이션: `db/migrations/001_ref_schema.sql` → `001b_ref_functions.sql` (`pipeline/06c_run_migrations.py`, 한 트랜잭션. 두 번 실행해도 오류 없음)
- 적재: `pipeline/06b_load_supabase.py` (한 트랜잭션: 같은 버전 삭제 → FK 순서로 COPY. 두 번 적재해도 같은 행 수)
- 검증: `pipeline/06e_verify_ref.py`. 접속 정보와 키는 이 보고서에 쓰지 않는다.

## 1. 테이블별 행 수 (DB = 시드)

| 테이블 | 시드 | DB | 일치 |
|---|---|---|---|
| data_version | 1 | 1 | 예 |
| source | 8 | 8 | 예 |
| department | 28 | 28 | 예 |
| triage_category | 33 | 33 | 예 |
| symptom | 197 | 197 | 예 |
| symptom_synonym | 1598 | 1598 | 예 |
| symptom_department | 197 | 197 | 예 |
| symptom_department_variant | 3016 | 3016 | 예 |
| fallback_department | 5 | 5 | 예 |
| app_config | 13 | 13 | 예 |
| questionnaire | 1 | 1 | 예 |
| questionnaire_item | 27 | 27 | 예 |
| questionnaire_answer_option | 89 | 89 | 예 |
| questionnaire_enable_when | 26 | 26 | 예 |
| safety_rule | 4 | 4 | 예 |
| safety_rule_condition | 4 | 4 | 예 |
| output_mapping | 37 | 37 | 예 |
| item_topic | 15 | 15 | 예 |
| text_i18n | 1760 | 1760 | 예 |

## 2. 표본 조회 (DB)

- **D02 명치 통증**: 동의어 = 상복부 통증, 속 불편감, 포만감, 상복부 불편감, 상복부불편감, 위통, 조기 포만감, 상복부 불쾌감, 상부 복통, 명치
  - 추천(path_used=B+A): 내과 / 산부인과 / —
- **span 표현 "목 통증"**: span_group 9 → L01 목(뒷목) 통증·불편, R21 목 안 통증·이물감
- **fallback 증상 A16 심하게 보채는 아기**: fallback_group=pediatric → fallback 진료과 소아청소년과
  - fallback 증상 전체 11개: A16 심하게 보채는 아기(pediatric), B04 피가 잘 나거나 멎지 않음(general), D20-04 입마름(general), K01 심장 부위 통증(general), K02 가슴 조임·압박감(general), L04 가슴 근육·갈비뼈 통증(general), L12 손·손가락 통증·불편(general), R01 숨 쉴 때 가슴 통증(general), T04 영유아 수유·식사 문제(pediatric), T29 기타 영양·대사 증상(저체중 등)(general), X20 유두 증상(분비물·통증 등)(general)

## 3. 읽기·쓰기 권한 — DB 안에서 role anon

- ref.symptom 5행 읽기: 5행 (A01 온몸·여러 곳 통증, A02 오한·몸 떨림, A03 발열, A04 피로·기운 없음, A05 몸이 안 좋음) → 성공
- ref.symptom insert 시도: 42501 permission denied for table symptom → 거부됨(정상)
- ref.app_config insert 시도: 42501 permission denied for table app_config → 거부됨(정상)
- insert 시도 뒤 DB에 남은 테스트 행: 0

## 4. ref.recommend_departments — DB 안에서 role anon

| 확인 | 증상 | 인자 | 결과 |
|---|---|---|---|
| 성별 제한 없는 증상 중 산부인과가 있는 것 | D01 배 아픔 | `{"p_sex": "female"}` | 1. 내과(internal, clinic) / 2. 산부인과(obgyn, clinic) |
| 성별 제한 없는 증상 중 산부인과가 있는 것 | D01 배 아픔 | `{"p_sex": "male"}` | 1. 내과(internal, clinic) |
| 소아청소년과가 1위인 증상 | A02 오한·몸 떨림 | `{"p_age": 5}` | 1. 소아청소년과(pediatrics, clinic) / 2. 내과(internal, clinic) / 3. 산부인과(obgyn, clinic) |
| 소아청소년과가 1위인 증상 | A02 오한·몸 떨림 | `{"p_age": 30}` | 1. 내과(internal, clinic) / 2. 산부인과(obgyn, clinic) |
| 소아청소년과가 1위인 증상 | A02 오한·몸 떨림 | `(기본)` | 1. 소아청소년과(pediatrics, clinic) / 2. 내과(internal, clinic) / 3. 산부인과(obgyn, clinic) |
| fallback 증상 | A16 심하게 보채는 아기 | `(기본)` | is_fallback=true (1행) |
| 상위 증상(추천 없음) | D20 입·혀·입술 불편 | `(기본)` | is_fallback=true (1행) |
| 허용값이 아닌 성별 | D01 배 아픔 | `{"p_sex": "x"}` | 1. 내과(internal, clinic) / 2. 산부인과(obgyn, clinic) |
| 허용값이 아닌 성별 | D01 배 아픔 | `{"p_sex": "unknown"}` | 1. 내과(internal, clinic) / 2. 산부인과(obgyn, clinic) |

- female 결과에 산부인과 있음: 예
- male 결과에 산부인과 없음: 예
- age 5 결과에 소아청소년과 있음: 예
- age 30 결과에 소아청소년과 없음: 예
- age null 결과 = age 5 결과: 예
- fallback 증상: 행 1개, is_fallback=true: 예
- D20: 행 1개, is_fallback=true: 예
- 허용값이 아닌 성별 = unknown 결과: 예

## 5. 읽기·쓰기 권한 — publishable 키 REST

- ref.symptom 5행 읽기: 5행 (A01 온몸·여러 곳 통증, A02 오한·몸 떨림, A03 발열, A04 피로·기운 없음, A05 몸이 안 좋음) → 성공
- ref.symptom insert 시도: HTTP 401 42501 (permission denied for table symptom) → 거부됨(정상)
- ref.app_config insert 시도: HTTP 401 42501 (permission denied for table app_config) → 거부됨(정상)
- insert 시도 뒤 DB에 남은 테스트 행: 0

## 6. ref.recommend_departments — publishable 키 REST

| 확인 | 증상 | 인자 | 결과 |
|---|---|---|---|
| 성별 제한 없는 증상 중 산부인과가 있는 것 | D01 배 아픔 | `{"p_sex": "female"}` | 1. 내과(internal, clinic) / 2. 산부인과(obgyn, clinic) |
| 성별 제한 없는 증상 중 산부인과가 있는 것 | D01 배 아픔 | `{"p_sex": "male"}` | 1. 내과(internal, clinic) |
| 소아청소년과가 1위인 증상 | A02 오한·몸 떨림 | `{"p_age": 5}` | 1. 소아청소년과(pediatrics, clinic) / 2. 내과(internal, clinic) / 3. 산부인과(obgyn, clinic) |
| 소아청소년과가 1위인 증상 | A02 오한·몸 떨림 | `{"p_age": 30}` | 1. 내과(internal, clinic) / 2. 산부인과(obgyn, clinic) |
| 소아청소년과가 1위인 증상 | A02 오한·몸 떨림 | `(기본)` | 1. 소아청소년과(pediatrics, clinic) / 2. 내과(internal, clinic) / 3. 산부인과(obgyn, clinic) |
| fallback 증상 | A16 심하게 보채는 아기 | `(기본)` | is_fallback=true (1행) |
| 상위 증상(추천 없음) | D20 입·혀·입술 불편 | `(기본)` | is_fallback=true (1행) |
| 허용값이 아닌 성별 | D01 배 아픔 | `{"p_sex": "x"}` | 1. 내과(internal, clinic) / 2. 산부인과(obgyn, clinic) |
| 허용값이 아닌 성별 | D01 배 아픔 | `{"p_sex": "unknown"}` | 1. 내과(internal, clinic) / 2. 산부인과(obgyn, clinic) |

- female 결과에 산부인과 있음: 예
- male 결과에 산부인과 없음: 예
- age 5 결과에 소아청소년과 있음: 예
- age 30 결과에 소아청소년과 없음: 예
- age null 결과 = age 5 결과: 예
- fallback 증상: 행 1개, is_fallback=true: 예
- D20: 행 1개, is_fallback=true: 예
- 허용값이 아닌 성별 = unknown 결과: 예

## 7. ref 스키마 모든 컬럼 (사용자 원문 저장 컬럼 없음 확인)

- `ref.app_config`: key, value, note, data_version
- `ref.data_version`: version, created_at, note
- `ref.department`: dept_id, name_ko, hira_code, nmc_code, is_guidable, sex_only, max_age, search_key, data_version
- `ref.fallback_department`: grp, rank, dept_id, n_support, data_version
- `ref.item_topic`: id, question, system, system_version, code, data_version
- `ref.output_mapping`: id, from_type, question, rule_id, when_code, slot, value, data_version
- `ref.questionnaire`: id, version, title, source, data_version
- `ref.questionnaire_answer_option`: link_id, code, order_no, display_ko, display_en, data_version
- `ref.questionnaire_enable_when`: id, link_id, question, operator, answer, data_version
- `ref.questionnaire_item`: link_id, questionnaire_id, order_no, text_ko, text_en, item_type, required, enable_behavior, flow, ui, source, todo, engine_condition, data_version
- `ref.safety_rule`: rule_id, priority, combine, result, terminal, triage_category_id, message_key, evidence_source, evidence_page, evidence_note, review_status, data_version
- `ref.safety_rule_condition`: id, rule_id, question, operator, answers, data_version
- `ref.source`: source_id, name, version, url, license, note, data_version
- `ref.symptom`: symptom_id, parent_id, is_parent, icpc2_code, chapter, chapter_ko, name_ko, body_part_ui, sex_restriction, triage_category_ids, is_injury, fallback_group, source_id, data_version
- `ref.symptom_department`: symptom_id, path_used, rec1_dept_id, rec1_level, rec1_share, rec2_dept_id, rec2_level, rec2_share, rec3_dept_id, rec3_level, rec3_share, clinic_ranking, hospital_ranking, dept_rule, fallback, pediatric_top, er_share, hira_indistinct, top_a, top_b, agree, data_version
- `ref.symptom_department_variant`: symptom_id, sex, age_band, rank, dept_id, level, share, data_version
- `ref.symptom_synonym`: id, symptom_id, term, term_norm, term_type, span_group, source_id, data_version
- `ref.text_i18n`: target, key, locale, text, source_ko, review_status, data_version
- `ref.triage_category`: id, name_ko, grp, page_start, page_end, data_version

사용자 입력·대화 원문을 담는 컬럼은 없다. `term`은 사전 표현이다(30자 이하 CHECK).

## 8. 함수와 테이블 권한

- `ref.recommend_departments`: security invoker, volatility s, 설정 `search_path=""`, anon 실행 True, authenticated 실행 True
- `anon`의 ref 테이블 권한: SELECT
- `authenticated`의 ref 테이블 권한: SELECT
- RLS 켜진 테이블: 19 / 19

## 결과

문제 없음.
