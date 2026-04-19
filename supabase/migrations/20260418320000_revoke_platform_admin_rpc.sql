-- Super admin removes platform `admin` only (never `super_admin`).

create or replace function public.revoke_platform_admin(p_target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if p_target is null then
    raise exception 'p_target is required';
  end if;
  if not public.auth_is_super_admin() then
    raise exception 'not authorized';
  end if;

  delete from public.admin_roles
  where user_id = p_target
    and role = 'admin';

  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'no admin role to revoke for this user';
  end if;
end;
$$;

revoke all on function public.revoke_platform_admin(uuid) from public;
grant execute on function public.revoke_platform_admin(uuid) to authenticated;
