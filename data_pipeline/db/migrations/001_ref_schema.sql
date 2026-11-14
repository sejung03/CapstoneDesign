-- 001_ref_schema.sql — ref 스키마: 앱이 읽는 참조 데이터(증상·사전·진료과 추천)
-- 근거: docs/prompts/6단계_Supabase_1차적재_프롬프트.md, docs/prompts/7단계_DB마무리_프롬프트.md(D1 보완 A·B)
-- 다시 실행해도 같은 상태가 된다(if not exists, drop policy if exists 후 create).
-- 데이터는 pipeline/06b_load_supabase.py가 db/seed/<data_version>/*.csv에서 넣는다.
-- 넣지 않는 것: 질환 테이블, 경로 A 중간 결과, AI Hub 답변 문장, 사용자 원문.

create schema if not exists ref;

-- ---------- 버전·출처 ----------
create table if not exists ref.data_version (
  version     text primary key,
  created_at  timestamptz not null default now(),
  note        text
);

create table if not exists ref.source (
  source_id     text primary key check (source_id ~ '^S[0-9]+$'),
  name          text not null,
  version       text,
  url           text,
  license       text,
  note          text,
  data_version  text not null references ref.data_version (version)
);

-- ---------- 진료과 ----------
create table if not exists ref.department (
  dept_id       text primary key check (dept_id ~ '^[a-z_]+$'),
  name_ko       text not null unique,
  hira_code     text,
  nmc_code      text,
  is_guidable   boolean not null,
  sex_only      text check (sex_only in ('female', 'male')),     -- dept_sex (산부인과: female)
  max_age       int check (max_age between 0 and 120),          -- dept_age (소아청소년과: 18)
  search_key    text unique,                                    -- 프론트 departments.mjs의 key (보완 A)
  data_version  text not null references ref.data_version (version)
);

-- ---------- 119 주증상 범주 ----------
create table if not exists ref.triage_category (
  id            int primary key check (id between 1 and 33),
  name_ko       text not null,
  grp           text not null check (grp in ('질환', '손상', '기타')),
  page_start    int,
  page_end      int,
  data_version  text not null references ref.data_version (version)
);

-- ---------- 표준 증상 ----------
create table if not exists ref.symptom (
  symptom_id           text primary key check (symptom_id ~ '^([A-Z][0-9]{2}(-[0-9]{2})?|EX[0-9]{2})$'),
  parent_id            text references ref.symptom (symptom_id),
  is_parent            boolean not null,
  icpc2_code           text,
  icpc2_preferred      text,
  chapter              text,
  chapter_ko           text,
  name_ko              text not null,
  body_part_ui         text not null,
  sex_restriction      text check (sex_restriction in ('female', 'male')),
  icd10_3              text[],
  triage_category_ids  int[],
  is_injury            boolean not null,
  fallback_group       text check (fallback_group in ('injury', 'pediatric', 'general')),
  source_id            text not null references ref.source (source_id),
  data_version         text not null references ref.data_version (version)
);

-- ---------- 일상 표현 사전 ----------
create table if not exists ref.symptom_synonym (
  id            int primary key,
  symptom_id    text not null references ref.symptom (symptom_id),
  term          text not null check (char_length(term) between 1 and 30),
  term_norm     text not null,                                  -- 공백 제거
  term_type     text not null check (term_type in ('대표', '동의어', 'span')),
  span_group    int,                                            -- 같은 span 표현끼리 같은 번호
  source_id     text not null references ref.source (source_id),
  data_version  text not null references ref.data_version (version),
  check ((term_type = 'span') = (span_group is not null))
);

-- ---------- 증상별 진료과 추천 (성별·나이를 모를 때 = 기본) ----------
create table if not exists ref.symptom_department (
  symptom_id        text primary key references ref.symptom (symptom_id),
  path_used         text not null check (path_used in ('B', 'B+A', 'A', 'none', 'rule', 'parent')),
  rec1_dept_id      text references ref.department (dept_id),
  rec1_level        text check (rec1_level in ('clinic', 'hospital', 'rule', 'override', 'path_a')),
  rec1_share        numeric,
  rec2_dept_id      text references ref.department (dept_id),
  rec2_level        text check (rec2_level in ('clinic', 'hospital', 'rule', 'override', 'path_a')),
  rec2_share        numeric,
  rec3_dept_id      text references ref.department (dept_id),
  rec3_level        text check (rec3_level in ('clinic', 'hospital', 'rule', 'override', 'path_a')),
  rec3_share        numeric,
  clinic_ranking    jsonb not null default '[]'::jsonb,         -- [{dept_id, share, patients}] 경로 B 의원급 전체 순위
  hospital_ranking  jsonb not null default '[]'::jsonb,         -- [{dept_id, share, patients}] 경로 B 병원급 전체 순위
  dept_rule         text,
  fallback          boolean not null,
  pediatric_top     boolean not null,
  er_share          numeric,
  hira_indistinct   boolean,
  top_a             text references ref.department (dept_id),
  top_b             text references ref.department (dept_id),
  agree             boolean,
  data_version      text not null references ref.data_version (version),
  check ((rec1_dept_id is null) = (rec1_level is null)),
  check ((rec2_dept_id is null) = (rec2_level is null)),
  check ((rec3_dept_id is null) = (rec3_level is null)),
  check (not fallback or rec1_dept_id is null)
);

-- ---------- 성별·나이 경우별 추천 (보완 B, 파이프라인에서 미리 계산) ----------
-- (sex, age_band) = (unknown, unknown) 결과는 ref.symptom_department의 rec1~rec3와 같다.
-- fallback 증상과 상위 증상(parent)은 행이 없다.
create table if not exists ref.symptom_department_variant (
  symptom_id    text not null references ref.symptom (symptom_id),
  sex           text not null check (sex in ('female', 'male', 'unknown')),
  age_band      text not null check (age_band in ('child', 'adult', 'unknown')),   -- child = 만 18세 이하
  rank          int not null check (rank between 1 and 3),
  dept_id       text not null references ref.department (dept_id),
  level         text not null check (level in ('clinic', 'hospital', 'rule', 'override', 'path_a')),
  share         numeric,
  data_version  text not null references ref.data_version (version),
  primary key (symptom_id, sex, age_band, rank)
);

-- ---------- fallback 진료과 ----------
create table if not exists ref.fallback_department (
  grp           text not null check (grp in ('injury', 'pediatric', 'general')),
  rank          int not null check (rank >= 1),
  dept_id       text not null references ref.department (dept_id),
  n_support     int,
  data_version  text not null references ref.data_version (version),
  primary key (grp, rank)
);

-- ---------- 앱 설정 ----------
create table if not exists ref.app_config (
  key           text primary key,
  value         jsonb not null,
  note          text,
  data_version  text not null references ref.data_version (version)
);

-- ---------- 인덱스 ----------
create index if not exists symptom_synonym_term_norm_idx  on ref.symptom_synonym (term_norm);
create index if not exists symptom_synonym_symptom_id_idx on ref.symptom_synonym (symptom_id);
create index if not exists symptom_parent_id_idx          on ref.symptom (parent_id);

-- ---------- 권한: 읽기 전용 ----------
-- 모든 테이블 RLS + 읽기 정책 하나. 쓰기는 적재 스크립트(직접 DB 연결)만 한다.
do $$
declare
  t text;
begin
  foreach t in array array['data_version', 'source', 'department', 'triage_category', 'symptom',
                           'symptom_synonym', 'symptom_department', 'symptom_department_variant',
                           'fallback_department', 'app_config']
  loop
    execute format('alter table ref.%I enable row level security', t);
    execute format('drop policy if exists "public read" on ref.%I', t);
    execute format('create policy "public read" on ref.%I for select to anon, authenticated using (true)', t);
  end loop;
end
$$;

grant usage on schema ref to anon, authenticated;
revoke all on all tables in schema ref from anon, authenticated;
grant select on all tables in schema ref to anon, authenticated;
-- 나중에 이 스키마에 만드는 테이블에 Supabase 기본 권한(쓰기)이 붙지 않게 한다
alter default privileges in schema ref revoke all on tables from anon, authenticated;
