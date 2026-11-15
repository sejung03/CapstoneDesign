-- Run once in this project's Supabase SQL Editor as postgres.
-- Dedicated names avoid changing the team's existing app.* tables.
begin;
create table public.capstone_account_consents (
 user_id uuid not null references auth.users(id) on delete cascade,
 policy_version text not null check (policy_version='signup-policy-1'),
 item_id text not null check (item_id in ('terms','account','healthProcessing','healthStorage','reportStorage')),
 agreed boolean not null,
 recorded_at timestamptz not null default now(),
 primary key(user_id,policy_version,item_id)
);
create table public.capstone_search_setting (
 user_id uuid primary key references auth.users(id) on delete cascade,
 region text not null default '' check (char_length(region)<=80),
 preference text not null default 'distance' check (preference in ('distance','open','access')),
 personalization_enabled boolean not null default true,
 preference_explicit boolean not null default false,
 personalization_explicit boolean not null default false,
 updated_at timestamptz not null default now()
);
create table public.capstone_favorite (
 user_id uuid not null references auth.users(id) on delete cascade,
 facility_id text not null check (facility_id ~ '^[A-Za-z0-9_:.-]{1,128}$'),
 type text not null check (type in ('hospital','pharmacy')),
 name jsonb not null check (jsonb_typeof(name)='object' and name ?& array['ko','en'] and jsonb_typeof(name->'ko')='string' and char_length(name->>'ko') between 1 and 300 and jsonb_typeof(name->'en')='string' and char_length(name->>'en') between 1 and 300),
 address text not null default '' check (char_length(address)<=500),
 created_at timestamptz not null default now(),
 primary key(user_id,facility_id)
);
alter table public.capstone_account_consents enable row level security;
alter table public.capstone_search_setting enable row level security;
alter table public.capstone_favorite enable row level security;
revoke all on public.capstone_account_consents,public.capstone_search_setting,public.capstone_favorite from anon,authenticated;
grant select,insert on public.capstone_account_consents to authenticated;
grant select,insert,update,delete on public.capstone_search_setting to authenticated;
grant select,insert,delete on public.capstone_favorite to authenticated;
create policy capstone_consents_owner on public.capstone_account_consents for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy capstone_settings_owner on public.capstone_search_setting for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy capstone_favorites_owner on public.capstone_favorite for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);

create function public.capstone_limit_favorites() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is null or new.user_id<>auth.uid() then raise exception 'authentication_required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(new.user_id::text,0));
 if exists(select 1 from public.capstone_favorite where user_id=new.user_id and facility_id=new.facility_id) then return new; end if;
 if (select count(*) from public.capstone_favorite where user_id=new.user_id)>=20 then raise exception 'favorite_limit_20'; end if;
 return new;
end; $$;
create trigger capstone_favorites_limit before insert on public.capstone_favorite for each row execute function public.capstone_limit_favorites();

create function public.capstone_patch_settings(patch jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare saved public.capstone_search_setting;
begin
 if auth.uid() is null then raise exception 'authentication_required'; end if;
 if jsonb_typeof(patch) is distinct from 'object' or patch='{}'::jsonb then raise exception 'invalid_patch'; end if;
 if exists(select 1 from jsonb_object_keys(patch) k where k not in ('region','preference','personalization_enabled')) then raise exception 'invalid_patch'; end if;
 if patch?'region' and (jsonb_typeof(patch->'region')<>'string' or char_length(patch->>'region')>80) then raise exception 'invalid_region'; end if;
 if patch?'preference' and (jsonb_typeof(patch->'preference')<>'string' or patch->>'preference' not in ('distance','open','access')) then raise exception 'invalid_preference'; end if;
 if patch?'personalization_enabled' and jsonb_typeof(patch->'personalization_enabled')<>'boolean' then raise exception 'invalid_personalization'; end if;
 insert into public.capstone_search_setting(user_id,region,preference,personalization_enabled,preference_explicit,personalization_explicit)
 values(auth.uid(),coalesce(trim(patch->>'region'),''),coalesce(patch->>'preference','distance'),coalesce((patch->>'personalization_enabled')::boolean,true),patch?'preference',patch?'personalization_enabled')
 on conflict(user_id) do update set
 region=case when patch?'region' then excluded.region else capstone_search_setting.region end,
 preference=case when patch?'preference' then excluded.preference else capstone_search_setting.preference end,
 personalization_enabled=case when patch?'personalization_enabled' then excluded.personalization_enabled else capstone_search_setting.personalization_enabled end,
 preference_explicit=capstone_search_setting.preference_explicit or excluded.preference_explicit,
 personalization_explicit=capstone_search_setting.personalization_explicit or excluded.personalization_explicit,
 updated_at=now() returning * into saved;
 return to_jsonb(saved);
end; $$;

create function public.capstone_record_consents(version text,decisions jsonb) returns void language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'authentication_required'; end if;
 if version is distinct from 'signup-policy-1' or jsonb_typeof(decisions) is distinct from 'array' then raise exception 'invalid_policy'; end if;
 if jsonb_array_length(decisions)<>5 then raise exception 'invalid_decisions'; end if;
 if exists(select 1 from jsonb_array_elements(decisions) d where jsonb_typeof(d->'agreed') is distinct from 'boolean' or d->>'id' is null or d->>'id' not in ('terms','account','healthProcessing','healthStorage','reportStorage')) then raise exception 'invalid_decisions'; end if;
 if (select count(distinct d->>'id') from jsonb_array_elements(decisions) d)<>5 then raise exception 'invalid_decisions'; end if;
 if not decisions @> '[{"id":"terms","agreed":true},{"id":"account","agreed":true}]'::jsonb then raise exception 'required_consent'; end if;
 if (decisions @> '[{"id":"healthStorage","agreed":true}]'::jsonb or decisions @> '[{"id":"reportStorage","agreed":true}]'::jsonb) and not decisions @> '[{"id":"healthProcessing","agreed":true}]'::jsonb then raise exception 'dependent_consent'; end if;
 insert into public.capstone_account_consents(user_id,policy_version,item_id,agreed)
 select auth.uid(),version,d->>'id',(d->>'agreed')::boolean from jsonb_array_elements(decisions) d
 on conflict(user_id,policy_version,item_id) do nothing;
end; $$;

create function public.capstone_delete_behavior() returns jsonb language plpgsql security invoker set search_path='' as $$
declare favorites_count integer; settings_count integer;
begin
 if auth.uid() is null then raise exception 'authentication_required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 delete from public.capstone_favorite where user_id=auth.uid(); get diagnostics favorites_count=row_count;
 delete from public.capstone_search_setting where user_id=auth.uid(); get diagnostics settings_count=row_count;
 return jsonb_build_object('favorites',favorites_count,'search_settings',settings_count);
end; $$;
revoke all on function public.capstone_limit_favorites(),public.capstone_patch_settings(jsonb),public.capstone_record_consents(text,jsonb),public.capstone_delete_behavior() from public,anon;
grant execute on function public.capstone_patch_settings(jsonb),public.capstone_record_consents(text,jsonb),public.capstone_delete_behavior() to authenticated;
notify pgrst,'reload schema';
commit;
