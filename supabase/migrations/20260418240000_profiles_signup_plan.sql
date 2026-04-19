-- Persist seller subscription tier on `profiles` for admin joins and seller
-- dashboard queries (mirrors `auth.users.raw_user_meta_data.signup_plan`).

alter table public.profiles
  add column if not exists signup_plan text;

alter table public.profiles drop constraint if exists profiles_signup_plan_check;

alter table public.profiles add constraint profiles_signup_plan_check
  check (
    signup_plan is null
    or signup_plan in ('free', 'starter', 'growth', 'pro')
  );

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  sp text;
begin
  sp := lower(nullif(trim(new.raw_user_meta_data ->> 'signup_plan'), ''));
  if sp is not null and sp not in ('free', 'starter', 'growth', 'pro') then
    sp := null;
  end if;
  insert into public.profiles (id, display_name, signup_plan)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(new.email, '@', 1)
    ),
    sp
  );
  return new;
end;
$$;

-- Keep profiles.signup_plan in sync when auth metadata changes (e.g. plan pick on sign-up).
create or replace function public.sync_profile_signup_plan_from_auth()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  sp text;
begin
  sp := lower(nullif(trim(new.raw_user_meta_data ->> 'signup_plan'), ''));
  if sp is not null and sp not in ('free', 'starter', 'growth', 'pro') then
    sp := null;
  end if;
  update public.profiles
  set signup_plan = sp
  where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_updated_signup_plan on auth.users;

create trigger on_auth_user_updated_signup_plan
after update of raw_user_meta_data on auth.users
for each row
when (old.raw_user_meta_data is distinct from new.raw_user_meta_data)
execute procedure public.sync_profile_signup_plan_from_auth();

-- Backfill from existing auth metadata
update public.profiles p
set signup_plan = v.sp
from (
  select
    u.id,
    case
      when lower(nullif(trim(u.raw_user_meta_data ->> 'signup_plan'), '')) in (
        'free',
        'starter',
        'growth',
        'pro'
      )
      then lower(nullif(trim(u.raw_user_meta_data ->> 'signup_plan'), ''))
      else null
    end as sp
  from auth.users u
) v
where p.id = v.id
  and (p.signup_plan is distinct from v.sp);
