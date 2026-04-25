-- Exact count for super-admin "Grant access" bell (no client-side fetch limits).

create or replace function public.admin_pending_console_grant_count()
returns bigint
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if not public.auth_is_super_admin() then
    return 0;
  end if;

  return (
    select count(*)::bigint
    from public.profiles p
    where exists (
      select 1
      from public.stores s
      where s.owner_id = p.id
    )
    and not exists (
      select 1
      from public.admin_roles ar
      where ar.user_id = p.id
    )
  );
end;
$$;

grant execute on function public.admin_pending_console_grant_count() to authenticated;
