-- Let the current super_admin grant platform `admin` to another user (from the
-- app: supabase.rpc('grant_platform_admin', { p_target: '<uuid>' }) while signed
-- in as super_admin). Sign-up / sign-in never insert into admin_roles by default.

create or replace function public.grant_platform_admin(p_target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_target is null then
    raise exception 'p_target is required';
  end if;
  if not public.auth_is_super_admin() then
    raise exception 'not authorized';
  end if;

  insert into public.admin_roles (user_id, role)
  values (p_target, 'admin')
  on conflict (user_id) do update
  set role = 'admin'
  where public.admin_roles.role is distinct from 'super_admin';
end;
$$;

revoke all on function public.grant_platform_admin(uuid) from public;
grant execute on function public.grant_platform_admin(uuid) to authenticated;
