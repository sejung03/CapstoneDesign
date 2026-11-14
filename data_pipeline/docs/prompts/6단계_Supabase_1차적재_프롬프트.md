# 6단계 프롬프트: Supabase 1차 적재 (증상·사전·진료과 추천)

> 2026-11-13. 이 문서의 스키마가 `DB구축_ClaudeCode_프롬프트.md` §5를 대신한다(1차 적재 범위).
> 2차 적재(응급 카드: 119 범주별 응급 대처·119에 알릴 내용·위험 키워드)는 2B·5단계 후 별도 문서로.
>
> 사용 순서
> 1. **사람이 할 일(대시보드)**: Supabase 프로젝트의 Data API 설정에서 Exposed schemas에 `ref` 추가. `.env`에 연결 정보 넣기
> 2. **S6-1 (Claude Code)**: 마이그레이션 SQL + 적재용 시드 CSV 만들기 → 멈춤(아직 DB에 쓰지 않음)
> 3. **S6-2 (Claude Code)**: 적재 → 검증 → 보고

---

## 설계 원칙

- **스키마 분리**: 앱이 읽는 참조 데이터는 `ref` 스키마에만 둔다. 사용자 데이터(있다면)는 다른 스키마.
  Supabase 문서도 전용 스키마로 API 노출 범위를 정하고, 내부 테이블은 노출하지 않는 방식을 권한다.
- **읽기 전용**: `anon`, `authenticated`에는 `select`만 준다. 모든 테이블에 RLS를 켜고 `select ... using (true)` 정책 하나만 둔다.
  쓰기는 적재 스크립트가 서비스 키(또는 직접 DB 연결)로만 한다.
- **넣지 않는 것**: 질환 테이블(`disease`, `disease_symptom`, `disease_department`), 경로 A 중간 결과, AI Hub 답변 문장.
  질환은 내부 계산용이고 사용자에게 보여주지 않는다는 원칙 때문이다. 이 파일들은 저장소의 `data/processed/`에만 남긴다.
- **사용자 원문 저장 컬럼 없음.**
- **버전**: 모든 테이블에 `data_version` 컬럼(예: `v2.1-20261113`). 다시 적재할 때는 한 트랜잭션에서 비우고 다시 넣는다(멱등).

## 1차 적재 테이블 (`ref` 스키마)

```
ref.data_version(version PK, created_at, note)
ref.source(source_id PK, name, version, url, license, note)
    -- S1 AI Hub 71762, S2 HIRA 병원급, S3 HIRA 의원급, S4 상병마스터, S5 119 매뉴얼, S6 팀 문진, S7 ICPC-2e v7.0

ref.department(dept_id PK, name_ko UNIQUE, hira_code, nmc_code NULL, is_guidable bool,
               sex_only text NULL,      -- 산부인과: 'female' (dept_sex)
               max_age int NULL,        -- 소아청소년과: 18 (dept_age)
               data_version)

ref.triage_category(id PK 1~33, name_ko, grp('질환'|'손상'|'기타'), page_start, page_end, data_version)
    -- 1차에는 이름만. 응급 대처 내용은 2차 적재

ref.symptom(symptom_id PK,             -- ICPC 코드(D02), 하위(D20-01), 예외(EX01)
            parent_id NULL, is_parent bool,
            icpc2_code, icpc2_preferred, chapter, chapter_ko,
            name_ko, body_part_ui, sex_restriction('female'|'male'|NULL),
            icd10_3 text[], triage_category_ids int[],
            is_injury bool, fallback_group('injury'|'pediatric'|'general'|NULL),
            source_id, data_version)

ref.symptom_synonym(id PK, symptom_id FK, term, term_norm,   -- term_norm = 공백 제거
                    term_type('대표'|'동의어'|'span'), span_group NULL,  -- 같은 span 표현끼리 묶는 번호
                    source_id, data_version)
    -- 한 글자 표현은 그대로 넣는다(앱 입력 처리는 앱 쪽 규칙)

ref.symptom_department(symptom_id PK FK, path_used('B'|'B+A'|'A'|'none'|'rule'|'parent'),
                       rec1_dept_id, rec1_level('clinic'|'hospital'|'rule'|'override'), rec1_share,
                       rec2_dept_id, rec2_level, rec2_share,
                       rec3_dept_id, rec3_level, rec3_share,
                       clinic_ranking jsonb, hospital_ranking jsonb,   -- 런타임 성별·나이 필터 후 보충용
                       dept_rule, fallback bool, pediatric_top bool, er_share,
                       hira_indistinct bool, top_a, top_b, agree,
                       data_version)

ref.fallback_department(grp('injury'|'pediatric'|'general'), rank, dept_id, n_support NULL, data_version, PK(grp, rank))

ref.app_config(key PK, value jsonb, note, data_version)
    -- min_share 기준값, dept_sex, dept_age, 외상 판정 범주, 응급 버튼 항상 표시 등 앱이 읽을 규칙
```

---

## S6-1 — Claude Code: 마이그레이션과 시드

```
6단계(Supabase 1차 적재)를 시작한다. 이번에는 S6-1까지만 하고 멈춰. DB에는 아직 쓰지 않는다.
설계는 docs/6단계_Supabase_1차적재_프롬프트.md를 따른다(이 파일을 먼저 읽어).

1. 마이그레이션 SQL → db/migrations/001_ref_schema.sql
   - create schema ref; 위 테이블 전부(PK, FK, CHECK 제약 포함)
   - 모든 테이블: alter table ... enable row level security;
     create policy "public read" on ref.<t> for select to anon, authenticated using (true);
   - grant usage on schema ref to anon, authenticated;
     grant select on all tables in schema ref to anon, authenticated;
     insert/update/delete 권한은 anon·authenticated에 주지 않는다
   - 인덱스: symptom_synonym(term_norm), symptom_synonym(symptom_id), symptom(parent_id)
2. 시드 CSV → db/seed/v2.1-20261113/*.csv (테이블마다 1개, 컬럼 순서는 SQL과 같게)
   - 입력: standard_symptoms_v2_1.csv, symptom_synonym_v3.csv(이름 반영본), symptom_department_final.csv,
     symptom_department_path_b.csv(clinic/hospital_ranking), fallback_departments.csv, department_alias 결과의 표준 과 목록,
     config/recommend.yaml(app_config로 옮길 값), config/triage_119.yaml
   - 진료과는 이름 대신 dept_id로 바꿔 넣는다. 표준 과 목록에 없는 이름이 나오면 멈추고 보고
   - hira_code는 심평원 코드테이블에서 채우고, nmc_code는 비워 둔다(팀원2와 결정 예정)
   - AI Hub 답변 문장이 시드에 들어가지 않았는지 검사(30자 넘는 term이 있으면 목록 보고)
   - 생성은 pipeline/06a_build_seed.py, 다시 돌려도 같은 결과
3. 적재 스크립트 → pipeline/06b_load_supabase.py (이번에는 만들기만, 실행하지 않음)
   - .env의 SUPABASE_DB_URL(직접 연결 문자열)로 접속. 키·주소를 코드나 로그에 찍지 않는다
   - 한 트랜잭션: 해당 data_version 행 삭제 → 테이블 순서대로 넣기(FK 순서) → 커밋
   - --dry-run 옵션: 접속 없이 시드 파일 행 수와 FK 검사만

보고: 테이블별 시드 행 수, FK 검사 결과, 30자 넘는 term 목록, 표준 과 목록에 없던 이름(있으면)
```

---

## S6-2 — Claude Code: 적재와 검증

```
S6-1 산출물로 적재하고 검증해줘.
사전 조건: Supabase 대시보드에서 Exposed schemas에 ref를 추가했고, .env에 SUPABASE_DB_URL, SUPABASE_URL, SUPABASE_ANON_KEY가 있다.

1. 마이그레이션 실행(001_ref_schema.sql). 이미 있으면 건너뛰는지 확인
2. python pipeline/06b_load_supabase.py --dry-run → 이상 없으면 실제 적재
3. 검증 → reports/step6_load.md
   - 테이블별 DB 행 수 = 시드 행 수
   - anon 키로 REST 조회: ref.symptom 5행 읽기 성공
   - anon 키로 insert 시도: 실패해야 정상(권한 오류 확인)
   - 표본 조회 3개: "D02"의 동의어·추천, span 표현 하나("목 통증"), fallback 증상 하나
   - 사용자 원문 저장 컬럼이 없는지(모든 컬럼 이름 목록)
4. 키와 접속 정보는 보고서에 쓰지 않는다
```
