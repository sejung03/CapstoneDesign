-- 007_app_department_choice.sql — 검색에 적용한 진료과 횟수(app.department_choice)
-- 002 머리말의 "조회한 진료과는 저장하지 않는다"를 바꾼다. 진료과 이력은 건강 상태를 드러낼 수 있어
-- 건강정보 저장 동의(healthProcessing + healthStorage)가 있을 때만 쌓고, 동의를 철회하면 건강정보와 함께 지운다.
-- 근거: frontend/signup-consent.mjs의 healthStorage 항목(목적·수집 항목에 "검색에 적용한 진료과와 그 횟수").
-- 저장하는 것: 진료과 검색 키(frontend/departments.mjs의 key)와 횟수, 마지막으로 센 시각. 날짜별 기록은 두지 않는다.
-- 다시 실행해도 같은 상태가 된다(if not exists, create or replace, drop ... if exists 후 create).

create table if not exists app.department_choice (
  user_id        uuid not null references app.account (user_id) on delete cascade,
  department_key text not null check (department_key ~ '^[a-z_]{1,40}$'),
  choice_count   integer not null default 1 check (choice_count between 1 and 100000),
  updated_at     timestamptz not null default now(),
  primary key (user_id, department_key)
);

alter table app.department_choice enable row level security;
revoke all on app.department_choice from public, anon, authenticated;
grant select, insert, update, delete on app.department_choice to authenticated;

-- 읽기·지우기: 본인 행. 쓰기: 본인 행 AND 건강정보 처리·저장 동의
drop policy if exists "own select" on app.department_choice;
create policy "own select" on app.department_choice for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "own delete" on app.department_choice;
create policy "own delete" on app.department_choice for delete to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists "own insert with consent" on app.department_choice;
create policy "own insert with consent" on app.department_choice for insert to authenticated
  with check ((select auth.uid()) = user_id
    and (select private.has_consent('healthProcessing')) and (select private.has_consent('healthStorage')));
drop policy if exists "own update with consent" on app.department_choice;
create policy "own update with consent" on app.department_choice for update to authenticated
  using ((select auth.uid()) = user_id
    and (select private.has_consent('healthProcessing')) and (select private.has_consent('healthStorage')))
  with check ((select auth.uid()) = user_id
    and (select private.has_consent('healthProcessing')) and (select private.has_consent('healthStorage')));

-- 횟수 하나 올리기. 동의가 없으면 아무것도 쓰지 않고 null을 돌려준다(오류가 아니다).
-- security invoker: 위 RLS가 그대로 걸린다.
create or replace function app.record_department_choice(p_department text)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if not ((select private.has_consent('healthProcessing')) and (select private.has_consent('healthStorage'))) then
    return null;
  end if;
  insert into app.department_choice (user_id, department_key)
  values ((select auth.uid()), p_department)
  on conflict (user_id, department_key) do update
    set choice_count = least(app.department_choice.choice_count + 1, 100000),
        updated_at = now()
  returning choice_count into v_count;
  return v_count;
end;
$$;
revoke all on function app.record_department_choice(text) from public, anon;
grant execute on function app.record_department_choice(text) to authenticated;

-- 002의 철회 트리거 함수를 바꾼다: 건강정보와 함께 진료과 횟수도 지운다
create or replace function private.on_consent_withdrawn()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.item in ('healthStorage', 'healthProcessing') and not new.agreed then
    delete from app.health_profile h where h.user_id = new.user_id;
    delete from app.department_choice d where d.user_id = new.user_id;
  end if;
  return new;
end;
$$;
revoke all on function private.on_consent_withdrawn() from public, anon, authenticated;

notify pgrst, 'reload schema';
