-- Account health profiles are independent of the reference data's sex variants.
alter table app.health_profile
  add column if not exists sex text check (sex in ('female', 'male', 'unknown'));
