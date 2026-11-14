-- 001b_ref_functions.sql — ref 조회 함수 (7단계 D1 보완 C)
-- 001_ref_schema.sql 다음에 실행한다. 다시 실행해도 같은 상태가 된다(create or replace).
--
-- ref.recommend_departments(p_symptom_id, p_sex, p_age)
--   성별·나이 필터와 보충 규칙은 SQL로 다시 구현하지 않는다. 파이프라인이 미리 계산한
--   ref.symptom_department_variant에서 경우에 맞는 행을 고르기만 한다.
--   - p_sex: 'female' | 'male' | 'unknown'. 그 밖(null 포함)은 'unknown'
--   - p_age: null → 'unknown', 18 이하 → 'child', 그 밖 → 'adult'
--   - fallback 증상: 행 1개(is_fallback = true, 나머지 null). 앱이 되묻기 후 ref.fallback_department를 쓴다
--   - 그 경우의 variant 행이 없는 증상도 같은 행 1개를 돌려준다. 지금은 상위 증상 D20(path_used=parent,
--     추천 없음)만 해당한다. 앱이 부위를 되묻는다. 빈 결과는 돌려주지 않는다(있는 증상 id일 때)
--   - 성별·나이는 인자로만 받고 저장하지 않는다

create or replace function ref.recommend_departments(
  p_symptom_id text,
  p_sex        text default 'unknown',
  p_age        int  default null
)
returns table (
  rank        int,
  dept_id     text,
  name_ko     text,
  search_key  text,
  level       text,
  share       numeric,
  is_fallback boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with p as (
    select
      case when p_sex in ('female', 'male', 'unknown') then p_sex else 'unknown' end as sex,
      case when p_age is null then 'unknown' when p_age <= 18 then 'child' else 'adult' end as age_band
  )
  select v.rank, v.dept_id, d.name_ko, d.search_key, v.level, v.share, false
  from ref.symptom_department sd
  join ref.symptom_department_variant v on v.symptom_id = sd.symptom_id
  join p on v.sex = p.sex and v.age_band = p.age_band
  join ref.department d on d.dept_id = v.dept_id
  where sd.symptom_id = p_symptom_id
    and not sd.fallback
  union all
  select null::int, null::text, null::text, null::text, null::text, null::numeric, true
  from ref.symptom_department sd
  cross join p
  where sd.symptom_id = p_symptom_id
    and (sd.fallback
         or not exists (select 1 from ref.symptom_department_variant v
                        where v.symptom_id = sd.symptom_id and v.sex = p.sex and v.age_band = p.age_band))
  order by 1
$$;

revoke all on function ref.recommend_departments(text, text, int) from public;
grant execute on function ref.recommend_departments(text, text, int) to anon, authenticated;
