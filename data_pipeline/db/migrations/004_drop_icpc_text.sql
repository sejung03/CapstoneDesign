-- 004_drop_icpc_text.sql — ICPC-2 원본에서 온 칸을 ref.symptom에서 뺀다 (ICPC-2 저작권 대응)
--   icpc2_preferred : ICPC-2e 영어 rubric 이름
--   icd10_3         : ICPC-2e의 ICD-10 연결표를 3자리로 자른 것
-- 앱·함수·프론트는 두 칸을 쓰지 않는다(파이프라인 빌드는 data/processed의 CSV를 읽는다).
-- 001_ref_schema.sql 다음에 실행한다. 다시 실행해도 같은 상태가 된다(if exists).
-- 새 DB에서도 001 → 001b → 003 → 004 순서로 실행하면 같은 결과다.

alter table ref.symptom drop column if exists icpc2_preferred;
alter table ref.symptom drop column if exists icd10_3;
