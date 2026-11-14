-- 003_ref_intake.sql — 문진 v1 (D5): 문항 정의 / 안전 규칙 / 결과 매핑 / 질문 주제
-- 원본: config/intake_v1.yaml → pipeline/06d_build_intake_seed.py → db/seed/<data_version>/questionnaire*.csv 등
-- 001_ref_schema.sql 다음에 실행한다. 다시 실행해도 같은 상태가 된다.
-- 문항 정의는 HL7 FHIR R4 Questionnaire를 참조한 제한된 스키마(FHIR 준수 아님).
-- 응급 판단은 문항이 아니라 safety_rule에 있고, 엔진이 답마다 먼저 평가한다.

-- ---------- 문항 정의 ----------
create table if not exists ref.questionnaire (
  id            text primary key,
  version       text not null,
  title         text not null,
  source        text not null,
  data_version  text not null references ref.data_version (version)
);

create table if not exists ref.questionnaire_item (
  link_id           text primary key check (link_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  questionnaire_id  text not null references ref.questionnaire (id),
  order_no          int not null unique,
  text_ko           text not null check (char_length(text_ko) between 1 and 300),
  text_en           text check (char_length(text_en) <= 300),
  item_type         text not null check (item_type in ('choice', 'string', 'display')),
  required          boolean not null,
  enable_behavior   text check (enable_behavior in ('all', 'any')),
  flow              text not null check (flow in ('start', 'emergency', 'safety', 'target', 'detail', 'pain', 'fallback')),
  ui                text check (ui in ('frontend')),
  source            text not null check (source in ('team_pdf', 'added')),
  todo              boolean not null default false,            -- 선택지 미정. v1 엔진은 건너뛴다
  engine_condition  text,                                      -- enable_when이 아니라 엔진이 내는 조건(예: symptom_is_fallback)
  data_version      text not null references ref.data_version (version)
);

create table if not exists ref.questionnaire_answer_option (
  link_id       text not null references ref.questionnaire_item (link_id),
  code          text not null check (code ~ '^[A-Za-z0-9_-]{1,80}$'),
  order_no      int not null,
  display_ko    text not null check (char_length(display_ko) between 1 and 300),
  display_en    text check (char_length(display_en) <= 300),
  data_version  text not null references ref.data_version (version),
  primary key (link_id, code),
  unique (link_id, order_no)
);

create table if not exists ref.questionnaire_enable_when (
  id            int primary key,
  link_id       text not null references ref.questionnaire_item (link_id),
  question      text not null references ref.questionnaire_item (link_id),
  operator      text not null check (operator in ('=', '!=', 'exists')),
  answer        text not null,                                 -- 선택지 code, exists면 'true'/'false'
  data_version  text not null references ref.data_version (version),
  check (link_id <> question)
);

-- ---------- 안전 규칙 ----------
create table if not exists ref.safety_rule (
  rule_id             text primary key check (rule_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  priority            int not null unique,                     -- 작을수록 먼저
  combine             text not null check (combine in ('all', 'any')),
  result              text not null check (result in ('EMERGENCY_STOP', 'URGENT_NOTICE')),
  terminal            boolean not null,                        -- true면 이후 진료과 추천 금지
  triage_category_id  int references ref.triage_category (id),
  message_key         text not null,
  evidence_source     text not null check (evidence_source in ('team_pdf', 'manual_119')),
  evidence_page       int,
  evidence_note       text not null,
  review_status       text not null check (review_status in ('draft', 'team_reviewed')),
  data_version        text not null references ref.data_version (version)
);

create table if not exists ref.safety_rule_condition (
  id            int primary key,
  rule_id       text not null references ref.safety_rule (rule_id),
  question      text not null references ref.questionnaire_item (link_id),
  operator      text not null check (operator in ('=', 'in')),
  answers       text[] not null check (cardinality(answers) >= 1),
  data_version  text not null references ref.data_version (version),
  check (operator <> '=' or cardinality(answers) = 1)
);

-- ---------- 결과 매핑 ----------
create table if not exists ref.output_mapping (
  id            int primary key,
  from_type     text not null check (from_type in ('answer', 'rule')),
  question      text references ref.questionnaire_item (link_id),
  rule_id       text references ref.safety_rule (rule_id),
  when_code     text,                                          -- 답 code 또는 'any'(from_type=answer)
  slot          text not null check (slot ~ '^(card|report|filter|detail|flow)\.[a-z_]+$'),
  value         text,                                          -- 없으면 답 code(또는 입력 내용)를 그대로
  data_version  text not null references ref.data_version (version),
  check ((from_type = 'answer' and question is not null and rule_id is null and when_code is not null)
      or (from_type = 'rule' and rule_id is not null and question is null))
);

-- ---------- 질문 주제 ("그 증상이 있다"는 뜻이 아님) ----------
create table if not exists ref.item_topic (
  id              int primary key,
  question        text not null references ref.questionnaire_item (link_id),
  system          text not null check (system in ('icpc2', 'symptom_id', 'triage_119')),
  system_version  text not null,
  code            text not null,
  data_version    text not null references ref.data_version (version)
);

create index if not exists questionnaire_enable_when_link_idx on ref.questionnaire_enable_when (link_id);
create index if not exists safety_rule_condition_rule_idx     on ref.safety_rule_condition (rule_id);
create index if not exists output_mapping_question_idx        on ref.output_mapping (question);

-- ---------- 권한: 다른 ref 테이블과 같게(읽기 전용) ----------
do $$
declare
  t text;
begin
  foreach t in array array['questionnaire', 'questionnaire_item', 'questionnaire_answer_option',
                           'questionnaire_enable_when', 'safety_rule', 'safety_rule_condition',
                           'output_mapping', 'item_topic']
  loop
    execute format('alter table ref.%I enable row level security', t);
    execute format('drop policy if exists "public read" on ref.%I', t);
    execute format('create policy "public read" on ref.%I for select to anon, authenticated using (true)', t);
    execute format('revoke all on ref.%I from anon, authenticated', t);
    execute format('grant select on ref.%I to anon, authenticated', t);
  end loop;
end
$$;
