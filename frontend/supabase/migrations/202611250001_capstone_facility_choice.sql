-- Run once in this project's Supabase SQL Editor as postgres, after 202611150001_capstone_behavior.sql.
-- Facility choice counts: how many times a signed-in user viewed directions or copied the phone number
-- of a facility. Only the count and the facility label are kept; no timestamps per action, no event log.
-- Basis: the required "account" consent in signup-consent.mjs lists these items.
begin;
create table public.capstone_facility_choice (
 user_id uuid not null references auth.users(id) on delete cascade,
 facility_id text not null check (facility_id ~ '^[A-Za-z0-9_:.-]{1,128}$'),
 type text not null check (type in ('hospital','pharmacy')),
 name jsonb not null check (jsonb_typeof(name)='object' and name ?& array['ko','en'] and jsonb_typeof(name->'ko')='string' and char_length(name->>'ko') between 1 and 300 and jsonb_typeof(name->'en')='string' and char_length(name->>'en') between 1 and 300),
 choice_count integer not null default 1 check (choice_count between 1 and 100000),
 updated_at timestamptz not null default now(),
 primary key(user_id,facility_id)
);
alter table public.capstone_facility_choice enable row level security;
revoke all on public.capstone_facility_choice from anon,authenticated;
grant select,insert,update,delete on public.capstone_facility_choice to authenticated;
create policy capstone_facility_choice_owner on public.capstone_facility_choice for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);

-- Adds one to the count (creates the row at 1). Keeps at most 50 facilities per user: the least recently
-- counted ones are dropped. Returns the new count, or null when the user turned personalization off.
create function public.capstone_record_facility_choice(facility jsonb) returns integer language plpgsql security invoker set search_path='' as $$
declare saved integer;
begin
 if auth.uid() is null then raise exception 'authentication_required'; end if;
 if jsonb_typeof(facility) is distinct from 'object' or exists(select 1 from jsonb_object_keys(facility) k where k not in ('id','type','name')) then raise exception 'invalid_facility'; end if;
 if exists(select 1 from public.capstone_search_setting s where s.user_id=auth.uid() and s.personalization_enabled=false) then return null; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,1));
 insert into public.capstone_facility_choice(user_id,facility_id,type,name)
 values(auth.uid(),facility->>'id',facility->>'type',facility->'name')
 on conflict(user_id,facility_id) do update set
  choice_count=least(capstone_facility_choice.choice_count+1,100000),
  type=excluded.type, name=excluded.name, updated_at=now()
 returning choice_count into saved;
 delete from public.capstone_facility_choice c where c.user_id=auth.uid() and c.facility_id in (
  select facility_id from public.capstone_facility_choice where user_id=auth.uid() order by updated_at desc, facility_id offset 50);
 return saved;
end; $$;

-- "Delete all behavior data" now also removes facility choice counts.
create or replace function public.capstone_delete_behavior() returns jsonb language plpgsql security invoker set search_path='' as $$
declare favorites_count integer; settings_count integer; choices_count integer;
begin
 if auth.uid() is null then raise exception 'authentication_required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 delete from public.capstone_favorite where user_id=auth.uid(); get diagnostics favorites_count=row_count;
 delete from public.capstone_search_setting where user_id=auth.uid(); get diagnostics settings_count=row_count;
 delete from public.capstone_facility_choice where user_id=auth.uid(); get diagnostics choices_count=row_count;
 return jsonb_build_object('favorites',favorites_count,'search_settings',settings_count,'facility_choices',choices_count);
end; $$;
revoke all on function public.capstone_record_facility_choice(jsonb) from public,anon;
grant execute on function public.capstone_record_facility_choice(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
