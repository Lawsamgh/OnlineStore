-- Fix auto-grant not firing: `admin_auto_grant_email_domains` had RLS enabled with
-- zero policies, so in some setups the EXISTS subquery in `handle_new_user` saw
-- no rows. This table is not exposed to the API; rely on REVOKE instead of RLS.
--
-- Also: when `auth.users.email` is set or corrected on UPDATE (rare), retry grant.

alter table public.admin_auto_grant_email_domains disable row level security;

revoke all on table public.admin_auto_grant_email_domains from public;
revoke all on table public.admin_auto_grant_email_domains from anon, authenticated;

create or replace function public.try_admin_auto_grant_from_email(p_user_id uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  email_domain text;
begin
  if p_user_id is null or p_email is null or position('@' in p_email) <= 0 then
    return;
  end if;
  email_domain := lower(nullif(trim(split_part(p_email, '@', 2)), ''));
  if email_domain is null or email_domain = '' then
    return;
  end if;

  insert into public.admin_roles (user_id, role)
  select p_user_id, 'admin'
  where exists (
    select 1
    from public.admin_auto_grant_email_domains d
    where lower(trim(d.domain)) = email_domain
  )
  on conflict (user_id) do nothing;
end;
$$;

revoke all on function public.try_admin_auto_grant_from_email(uuid, text) from public;
revoke all on function public.try_admin_auto_grant_from_email(uuid, text) from anon, authenticated;

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

  perform public.try_admin_auto_grant_from_email(new.id, new.email);
  return new;
end;
$$;

create or replace function public.on_auth_user_email_updated_try_admin_grant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.email is distinct from new.email and new.email is not null then
    perform public.try_admin_auto_grant_from_email(new.id, new.email);
  end if;
  return new;
end;
$$;

revoke all on function public.on_auth_user_email_updated_try_admin_grant() from public;
revoke all on function public.on_auth_user_email_updated_try_admin_grant() from anon, authenticated;

drop trigger if exists on_auth_user_email_updated_admin_grant on auth.users;

create trigger on_auth_user_email_updated_admin_grant
after update of email on auth.users
for each row
when (old.email is distinct from new.email)
execute procedure public.on_auth_user_email_updated_try_admin_grant();
