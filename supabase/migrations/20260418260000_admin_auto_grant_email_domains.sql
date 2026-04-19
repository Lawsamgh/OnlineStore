-- Optional auto-grant of platform `admin` when a **new** account is created
-- (email/password or Google — both insert into `auth.users` once). This runs
-- inside `handle_new_user()` (security definer), not from the browser.
--
-- Why not from the Vue app "after sign-in": the client cannot safely insert
-- into `admin_roles` for every login without either giving every seller admin
-- or embedding a service role key (never do that).
--
-- Configure by inserting rows into `admin_auto_grant_email_domains`, e.g.:
--   insert into public.admin_auto_grant_email_domains (domain) values ('yourcompany.com');
--
-- Domains are matched case-insensitively against the part after `@` in `auth.users.email`.

create table if not exists public.admin_auto_grant_email_domains (
  domain text primary key not null
);

comment on table public.admin_auto_grant_email_domains is
  'If a new auth user''s email is user@<domain>, they receive platform admin (insert into admin_roles) from handle_new_user.';

alter table public.admin_auto_grant_email_domains enable row level security;

revoke all on table public.admin_auto_grant_email_domains from public;

-- No policies: not exposed via PostgREST to anon/authenticated; manage via SQL / dashboard.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  sp text;
  email_domain text;
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

  -- Optional: platform staff by email domain (new accounts only).
  if new.email is not null and position('@' in new.email) > 0 then
    email_domain := lower(split_part(new.email, '@', 2));
    insert into public.admin_roles (user_id, role)
    select new.id, 'admin'
    where exists (
      select 1
      from public.admin_auto_grant_email_domains d
      where lower(d.domain) = email_domain
    )
    on conflict (user_id) do nothing;
  end if;

  return new;
end;
$$;
