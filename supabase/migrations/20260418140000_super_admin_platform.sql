-- Platform owner (Super Admin): roles, settings, announcements, support tickets.
-- Grant first super admin manually, e.g.:
--   insert into public.admin_roles (user_id) values ('<auth.users.id>');
--
-- Tables MUST be created before auth_is_super_admin(), which references admin_roles.

-- ---------------------------------------------------------------------------
-- Tables (no RLS yet — policies reference the helper function)
-- ---------------------------------------------------------------------------

create table public.admin_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'super_admin',
  created_at timestamptz not null default now(),
  constraint admin_roles_role_check check (role in ('super_admin')),
  constraint admin_roles_user_id_key unique (user_id)
);

create unique index admin_roles_one_super_only
  on public.admin_roles ((1))
  where role = 'super_admin';

create table public.platform_settings (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  value text not null,
  updated_at timestamptz not null default now()
);

create trigger platform_settings_set_updated_at
before update on public.platform_settings
for each row execute procedure public.set_updated_at();

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  message text not null,
  type text not null default 'info',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  subject text not null,
  message text not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now()
);

create index support_tickets_store_id_idx on public.support_tickets (store_id);
create index support_tickets_author_id_idx on public.support_tickets (author_id);

-- ---------------------------------------------------------------------------
-- Helper (after admin_roles exists)
-- ---------------------------------------------------------------------------

create or replace function public.auth_is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_roles r
    where r.user_id = auth.uid()
      and r.role = 'super_admin'
  );
$$;

grant execute on function public.auth_is_super_admin() to authenticated;
grant execute on function public.auth_is_super_admin() to anon;

-- ---------------------------------------------------------------------------
-- Row level security + policies
-- ---------------------------------------------------------------------------

alter table public.admin_roles enable row level security;

create policy "admin_roles_select_self_or_super"
on public.admin_roles for select
to authenticated
using (user_id = auth.uid() or public.auth_is_super_admin());

-- No client writes — assign roles via SQL / service role

alter table public.platform_settings enable row level security;

create policy "platform_settings_super_all"
on public.platform_settings for all
to authenticated
using (public.auth_is_super_admin())
with check (public.auth_is_super_admin());

alter table public.announcements enable row level security;

create policy "announcements_select_active"
on public.announcements for select
using (is_active = true);

create policy "announcements_select_super"
on public.announcements for select
to authenticated
using (public.auth_is_super_admin());

create policy "announcements_write_super"
on public.announcements for all
to authenticated
using (public.auth_is_super_admin())
with check (public.auth_is_super_admin());

alter table public.support_tickets enable row level security;

create policy "support_tickets_insert_store_owner"
on public.support_tickets for insert
to authenticated
with check (
  author_id = auth.uid()
  and exists (
    select 1 from public.stores s
    where s.id = store_id and s.owner_id = auth.uid()
  )
);

create policy "support_tickets_select_owner"
on public.support_tickets for select
to authenticated
using (
  exists (
    select 1 from public.stores s
    where s.id = support_tickets.store_id and s.owner_id = auth.uid()
  )
);

create policy "support_tickets_select_super"
on public.support_tickets for select
to authenticated
using (public.auth_is_super_admin());

create policy "support_tickets_update_super"
on public.support_tickets for update
to authenticated
using (public.auth_is_super_admin())
with check (public.auth_is_super_admin());

-- Super admin read access for platform overview

create policy "stores_select_super_admin"
on public.stores for select
using (public.auth_is_super_admin());

create policy "orders_select_super_admin"
on public.orders for select
using (public.auth_is_super_admin());

create policy "profiles_select_super_admin"
on public.profiles for select
using (public.auth_is_super_admin());
