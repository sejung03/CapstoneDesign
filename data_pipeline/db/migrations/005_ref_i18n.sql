-- 005_ref_i18n.sql — 다국어 번역 표 (care_engine/docs/다국어_설계.md)
-- 한국어가 원본이다. 이 표는 en·zh·vi·uz 번역만 담는다(ko 행 없음).
-- 다시 실행해도 같은 상태가 된다(if not exists).

create table if not exists ref.text_i18n (
  target         text not null check (target in ('item', 'option', 'symptom', 'department', 'template')),
  key            text not null check (key ~ '^[A-Za-z0-9_.:-]{1,120}$'),
  locale         text not null check (locale in ('en', 'zh', 'vi', 'uz')),
  text           text not null check (char_length(text) between 1 and 2000),
  source_ko      text not null check (char_length(source_ko) between 1 and 2000),  -- 번역할 때의 한국어 원문(바뀌면 번역을 쓰지 않음)
  review_status  text not null check (review_status in ('draft', 'team_reviewed')),
  data_version   text not null references ref.data_version (version),
  primary key (target, key, locale)
);

-- ---------- 권한: 다른 ref 테이블과 같게(RLS + 읽기 정책 하나, 쓰기는 적재 스크립트만) ----------
alter table ref.text_i18n enable row level security;
drop policy if exists "public read" on ref.text_i18n;
create policy "public read" on ref.text_i18n for select to anon, authenticated using (true);
revoke all on ref.text_i18n from anon, authenticated;
grant select on ref.text_i18n to anon, authenticated;
