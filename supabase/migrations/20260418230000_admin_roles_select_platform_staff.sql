-- Allow all platform staff (admin + super_admin) to read admin_roles so the
-- admin overview can show total console user count. Existing policy still
-- allows self/super reads; this ORs for any staff member.

create policy "admin_roles_select_platform_staff"
on public.admin_roles for select
to authenticated
using (public.auth_is_platform_staff());
