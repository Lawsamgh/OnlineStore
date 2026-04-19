-- Platform staff: allow role `admin` (multiple users) alongside the single `super_admin`.
-- Grant staff: insert into public.admin_roles (user_id, role) values ('<auth.users.id>', 'admin');
--
-- Staff can read platform settings and use overview / tickets like super admins.
-- Writes to platform_settings and announcements remain super_admin-only (existing policies).

-- ---------------------------------------------------------------------------
-- admin_roles: extend role check
-- ---------------------------------------------------------------------------

alter table public.admin_roles drop constraint if exists admin_roles_role_check;

alter table public.admin_roles add constraint admin_roles_role_check
  check (role in ('super_admin', 'admin'));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.auth_is_platform_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_roles r
    where r.user_id = auth.uid()
  );
$$;

grant execute on function public.auth_is_platform_staff() to authenticated;
grant execute on function public.auth_is_platform_staff() to anon;

-- ---------------------------------------------------------------------------
-- RLS: broaden read / ticket handling to all platform staff
-- ---------------------------------------------------------------------------

drop policy if exists "announcements_select_super" on public.announcements;

create policy "announcements_select_platform_staff"
on public.announcements for select
to authenticated
using (public.auth_is_platform_staff());

drop policy if exists "support_tickets_select_super" on public.support_tickets;

create policy "support_tickets_select_platform_staff"
on public.support_tickets for select
to authenticated
using (public.auth_is_platform_staff());

drop policy if exists "support_tickets_update_super" on public.support_tickets;

create policy "support_tickets_update_platform_staff"
on public.support_tickets for update
to authenticated
using (public.auth_is_platform_staff())
with check (public.auth_is_platform_staff());

drop policy if exists "stores_select_super_admin" on public.stores;

create policy "stores_select_platform_staff"
on public.stores for select
to authenticated
using (public.auth_is_platform_staff());

drop policy if exists "orders_select_super_admin" on public.orders;

create policy "orders_select_platform_staff"
on public.orders for select
to authenticated
using (public.auth_is_platform_staff());

drop policy if exists "profiles_select_super_admin" on public.profiles;

create policy "profiles_select_platform_staff"
on public.profiles for select
to authenticated
using (public.auth_is_platform_staff());

-- Staff read platform settings (writes remain super_admin-only via existing policy)
create policy "platform_settings_select_platform_staff"
on public.platform_settings for select
to authenticated
using (public.auth_is_platform_staff());
