# 7단계 D5 문진 적재 검증

- data_version: `v2.1-20261113` (ref 1차 시드와 같은 버전·폴더)
- 원본: `config/intake_v1.yaml` → `pipeline/06d_build_intake_seed.py`(D5 검사 후 시드 CSV)
- 마이그레이션: `db/migrations/003_ref_intake.sql` (실행 후 롤백으로 점검 → 적용 → 다시 실행해도 오류 없음)
- 적재: `pipeline/06b_load_supabase.py`(ref 전체를 한 트랜잭션으로). 검증: `pipeline/07b_verify_intake.py`
- 접속 정보와 키는 이 보고서에 쓰지 않는다.

## 1. 테이블별 행 수 (DB = 시드)

| 테이블 | 시드 | DB | 일치 |
|---|---|---|---|
| questionnaire | 1 | 1 | 예 |
| questionnaire_item | 46 | 46 | 예 |
| questionnaire_answer_option | 114 | 114 | 예 |
| questionnaire_enable_when | 45 | 45 | 예 |
| safety_rule | 4 | 4 | 예 |
| safety_rule_condition | 4 | 4 | 예 |
| output_mapping | 54 | 54 | 예 |
| item_topic | 15 | 15 | 예 |

- RLS 켜진 문진 테이블: 8 / 8, anon·authenticated 권한: SELECT

## 2. publishable 키로 REST 조회 (Accept-Profile: ref)

- Q0 문항: HTTP 200 → `Q0` 현재 119 신고가 필요하다고 생각되는 응급 상황인가요? (type choice, required True, flow start)
- Q0·N1·N2 선택지: HTTP 200, 8행
  - N1 `yes` 예, 괜찮아요
  - N1 `no` 아니요, 이상해요
  - N1 `unknown` 잘 모르겠어요
  - N2 `yes` 예, 숨쉬기 괜찮아요
  - N2 `no` 아니요, 숨쉬기 힘들어요
  - N2 `unknown` 잘 모르겠어요
  - Q0 `yes` 예
  - Q0 `no` 아니요
- 안전 규칙(조건 포함, 테이블 관계로 함께 조회): HTTP 200, 4개

| priority | rule_id | 조건 | result | terminal | 119 범주 |
|---|---|---|---|---|---|
| 10 | R-Q0-EMERGENCY | Q0 = yes | EMERGENCY_STOP | True | — |
| 20 | R-N1-CONSCIOUSNESS | N1 in no, unknown | URGENT_NOTICE | True | 12 |
| 30 | R-N2-BREATHING | N2 in no, unknown | URGENT_NOTICE | True | 15 |
| 40 | R-N3-RED-FLAGS | N3 in yes, unknown | URGENT_NOTICE | True | — |

- `POST ref.safety_rule` insert 시도: HTTP 401 42501 (permission denied for table safety_rule) → 거부됨(정상)

## 3. D5 검사 재실행 (`pipeline/intake_check.py`)

- **config/intake_v1.yaml**: 통과 — 문항 46개, 안전 규칙 4개, 결과 매핑 54개, 질문 주제 15개
- **DB에서 다시 만든 문서**: 통과 — 문항 46개, 안전 규칙 4개, 결과 매핑 54개, 질문 주제 15개
  - flow별 문항: {'detail': 21, 'emergency': 11, 'fallback': 3, 'pain': 4, 'safety': 3, 'start': 1, 'target': 3}
  - todo 문항(선택지 비움, v1 엔진은 건너뜀): N6-2, N9-1, N10-1, P2, P3, F1
  - 위험 답 → 안전 규칙: Q0=yes → R-Q0-EMERGENCY; N1=no → R-N1-CONSCIOUSNESS; N1=unknown → R-N1-CONSCIOUSNESS; N2=no → R-N2-BREATHING; N2=unknown → R-N2-BREATHING; N3=yes → R-N3-RED-FLAGS; N3=unknown → R-N3-RED-FLAGS

## 결과

문제 없음.
