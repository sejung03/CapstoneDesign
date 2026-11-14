-- 002_app_schema.sql — app 스키마(회원 데이터)와 private 스키마(트리거·내부 함수)
-- 근거: docs/7단계_사용자DB_설계.md §4, docs/prompts/7단계_DB마무리_프롬프트.md D3(이 지시서가 우선)
-- 다시 실행해도 같은 상태가 된다(if not exists, create or replace, drop ... if exists 후 create).
--
-- 저장하지 않는 것(칸을 만들지 않음): 대화 원문, 문진 답변, 증상, 분석서, 응급 위치,
--   상담 대상 성별·나이, 조회한 진료과·추천 결과.
-- 동의 의존 관계(healthStorage는 healthProcessing 필요)는 DB에서 강제하지 않는다. 서버가 검사한다.

create schema if not exists app;
create schema if not exists private;

revoke all on schema app from public, anon;
grant usage on schema app to authenticated;

-- private: Data API에 노출하지 않는다. anon에는 usage를 주지 않는다.
-- authenticated에는 usage만 준다: health_profile 정책이 private.has_consent()를 부르는데,
-- 정책은 호출한 사용자 권한으로 실행되어 스키마 usage가 없으면 "permission denied for schema private"가 난다.
-- 실행 권한은 has_consent 하나만 준다(아래).
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

-- ---------- 테이블 ----------
-- 계정: auth.users 1:1. 카카오 회원번호는 auth.identities에 있으므로 복제하지 않는다
create table if not exists app.account (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- 동의 기록: 추가만(append-only). 철회는 agreed=false 행을 새로 넣는다
create table if not exists app.consent_event (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references app.account (user_id) on delete cascade,
  policy_version text not null check (char_length(policy_version) between 1 and 80),
  item           text not null check (item in
                   ('terms', 'account', 'age14', 'healthProcessing', 'healthStorage', 'reportStorage')),
  agreed         boolean not null,
  created_at     timestamptz not null default now()
);
create index if not exists consent_event_user_item_created_idx
  on app.consent_event (user_id, item, created_at desc);

-- 항목별 최신 행. 같은 시각(같은 트랜잭션)에 들어온 행은 id가 큰 쪽이 최신
create or replace view app.consent_current with (security_invoker = true) as
select distinct on (user_id, item) user_id, item, agreed, policy_version, created_at
from app.consent_event
order by user_id, item, created_at desc, id desc;

-- 즐겨찾기: 프론트 connectFavorites 계약. 운영 상태·시간표·방문 이력은 넣지 않는다
create table if not exists app.favorite (
  user_id       uuid not null references app.account (user_id) on delete cascade,
  facility_id   text not null check (facility_id ~ '^[A-Za-z0-9_:.\-]{1,128}$'),
  facility_type text not null check (facility_type in ('hospital', 'pharmacy')),
  name_ko       text not null check (char_length(name_ko) between 1 and 300),
  name_en       text check (char_length(name_en) <= 300),
  address       text check (char_length(address) <= 500),
  created_at    timestamptz not null default now(),
  primary key (user_id, facility_id)
);

-- 검색 설정
create table if not exists app.search_setting (
  user_id    uuid primary key references app.account (user_id) on delete cascade,
  region     text check (char_length(region) <= 80),
  preference text not null default 'distance' check (preference in ('distance', 'open', 'access')),
  updated_at timestamptz not null default now()
);

-- 건강정보: healthStorage 동의가 있을 때만 읽기·쓰기(정책). 동의 철회 시 트리거가 삭제
create table if not exists app.health_profile (
  user_id      uuid primary key references app.account (user_id) on delete cascade,
  age          smallint check (age between 0 and 120),
  allergies    text check (char_length(allergies) <= 500),
  medications  text check (char_length(medications) <= 500),
  history      text check (char_length(history) <= 500),
  confirmed_at timestamptz,   -- 마지막 확인일(나이 재확인용)
  updated_at   timestamptz not null default now()
);

-- ---------- 함수 (private, security definer, search_path = '') ----------

-- auth.users insert 후 app.account 행 생성
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into app.account (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

-- 본인(auth.uid())의 해당 항목 최신 동의 값. 기록이 없으면 false
create or replace function private.has_consent(p_item text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select c.agreed from app.consent_current c
     where c.user_id = (select auth.uid()) and c.item = p_item),
    false)
$$;

-- 즐겨찾기 insert 전: 계정 행을 잠가 동시 요청에도 20개를 넘지 않게 한다
--   다른 사용자의 행이면 거부(아래 같은 기관 검사가 남의 즐겨찾기 존재를 알려 주지 않도록 먼저 막는다)
--   같은 기관이면 return null(오류 없이 아무것도 넣지 않음, 멱등)
--   이미 20개면 오류: SQLSTATE 23514(check_violation), 메시지 'favorite limit 20'
create or replace function private.favorite_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is not null and new.user_id is distinct from v_uid then
    raise exception using errcode = '42501', message = 'not your favorite';
  end if;
  perform 1 from app.account a where a.user_id = new.user_id for update;
  if exists (select 1 from app.favorite f
             where f.user_id = new.user_id and f.facility_id = new.facility_id) then
    return null;
  end if;
  if (select count(*) from app.favorite f where f.user_id = new.user_id) >= 20 then
    raise exception using errcode = '23514', message = 'favorite limit 20';
  end if;
  return new;
end;
$$;

-- healthStorage 또는 healthProcessing 철회(agreed=false)가 들어오면 그 사용자의 건강정보 삭제
create or replace function private.on_consent_withdrawn()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.item in ('healthStorage', 'healthProcessing') and not new.agreed then
    delete from app.health_profile h where h.user_id = new.user_id;
  end if;
  return new;
end;
$$;

-- update 때 updated_at 갱신
create or replace function private.touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- 실행 권한: public·anon·authenticated에서 모두 뺀 뒤 has_consent만 authenticated에 준다
-- (트리거 함수는 실행 권한 없이도 트리거로 실행된다)
revoke all on function private.handle_new_user()       from public, anon, authenticated;
revoke all on function private.has_consent(text)       from public, anon, authenticated;
revoke all on function private.favorite_limit()        from public, anon, authenticated;
revoke all on function private.on_consent_withdrawn()  from public, anon, authenticated;
revoke all on function private.touch_updated_at()      from public, anon, authenticated;
grant execute on function private.has_consent(text) to authenticated;

-- ---------- 트리거 ----------
drop trigger if exists mh_on_auth_user_created on auth.users;
create trigger mh_on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

drop trigger if exists favorite_limit on app.favorite;
create trigger favorite_limit
  before insert on app.favorite
  for each row execute function private.favorite_limit();

drop trigger if exists consent_withdrawn on app.consent_event;
create trigger consent_withdrawn
  after insert on app.consent_event
  for each row execute function private.on_consent_withdrawn();

drop trigger if exists touch_updated_at on app.search_setting;
create trigger touch_updated_at
  before update on app.search_setting
  for each row execute function private.touch_updated_at();

drop trigger if exists touch_updated_at on app.health_profile;
create trigger touch_updated_at
  before update on app.health_profile
  for each row execute function private.touch_updated_at();

-- ---------- RLS ----------
alter table app.account        enable row level security;
alter table app.consent_event  enable row level security;
alter table app.favorite       enable row level security;
alter table app.search_setting enable row level security;
alter table app.health_profile enable row level security;

-- account: select
drop policy if exists "own select" on app.account;
create policy "own select" on app.account for select to authenticated
  using ((select auth.uid()) = user_id);

-- consent_event: select, insert. update·delete 정책 없음
drop policy if exists "own select" on app.consent_event;
create policy "own select" on app.consent_event for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "own insert" on app.consent_event;
create policy "own insert" on app.consent_event for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- favorite: select, insert, delete
drop policy if exists "own select" on app.favorite;
create policy "own select" on app.favorite for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "own insert" on app.favorite;
create policy "own insert" on app.favorite for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "own delete" on app.favorite;
create policy "own delete" on app.favorite for delete to authenticated
  using ((select auth.uid()) = user_id);

-- search_setting: select, insert, update, delete
drop policy if exists "own select" on app.search_setting;
create policy "own select" on app.search_setting for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "own insert" on app.search_setting;
create policy "own insert" on app.search_setting for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists "own update" on app.search_setting;
create policy "own update" on app.search_setting for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists "own delete" on app.search_setting;
create policy "own delete" on app.search_setting for delete to authenticated
  using ((select auth.uid()) = user_id);

-- health_profile: 본인 행 AND healthStorage 동의
drop policy if exists "own select with consent" on app.health_profile;
create policy "own select with consent" on app.health_profile for select to authenticated
  using ((select auth.uid()) = user_id and (select private.has_consent('healthStorage')));
drop policy if exists "own insert with consent" on app.health_profile;
create policy "own insert with consent" on app.health_profile for insert to authenticated
  with check ((select auth.uid()) = user_id and (select private.has_consent('healthStorage')));
drop policy if exists "own update with consent" on app.health_profile;
create policy "own update with consent" on app.health_profile for update to authenticated
  using ((select auth.uid()) = user_id and (select private.has_consent('healthStorage')))
  with check ((select auth.uid()) = user_id and (select private.has_consent('healthStorage')));
drop policy if exists "own delete with consent" on app.health_profile;
create policy "own delete with consent" on app.health_profile for delete to authenticated
  using ((select auth.uid()) = user_id and (select private.has_consent('healthStorage')));

-- ---------- 테이블 권한 ----------
-- 기본 권한으로 붙었을 수 있는 것을 먼저 모두 뺀다. anon에는 아무 권한도 없다
revoke all on all tables in schema app from public, anon, authenticated;
alter default privileges in schema app revoke all on tables from public, anon, authenticated;

grant select                         on app.account         to authenticated;
grant select                         on app.consent_event   to authenticated;
-- created_at은 서버 시각(default)만 쓰게 한다: 최신 동의 판정을 사용자가 바꾸지 못하도록 컬럼 단위로 insert 허용
grant insert (user_id, policy_version, item, agreed) on app.consent_event to authenticated;
grant select                         on app.consent_current to authenticated;
grant select, insert, delete         on app.favorite        to authenticated;
grant select, insert, update, delete on app.search_setting  to authenticated;
grant select, insert, update, delete on app.health_profile  to authenticated;
