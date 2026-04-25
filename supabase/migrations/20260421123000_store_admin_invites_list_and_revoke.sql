create or replace function public.list_store_admin_invites(
  p_store_id uuid
)
returns table (
  id uuid,
  email text,
  status text,
  invited_by uuid,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (
    public.auth_is_platform_staff()
    or exists (
      select 1
      from public.stores s
      where s.id = p_store_id
        and s.owner_id = auth.uid()
    )
  ) then
    raise exception 'only the store owner can view invites';
  end if;

  return query
  select
    i.id,
    i.email,
    i.status,
    i.invited_by,
    i.created_at
  from public.store_admin_invites i
  where i.store_id = p_store_id
    and i.status = 'pending'
  order by i.created_at desc;
end;
$$;

revoke all on function public.list_store_admin_invites(uuid) from public;
grant execute on function public.list_store_admin_invites(uuid) to authenticated;

create or replace function public.revoke_store_admin_invite(
  p_invite_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.store_admin_invites i
  set status = 'revoked'
  where i.id = p_invite_id
    and i.status = 'pending'
    and (
      public.auth_is_platform_staff()
      or exists (
        select 1
        from public.stores s
        where s.id = i.store_id
          and s.owner_id = auth.uid()
      )
    );

  if not found then
    raise exception 'invite not found or not allowed';
  end if;
end;
$$;

revoke all on function public.revoke_store_admin_invite(uuid) from public;
grant execute on function public.revoke_store_admin_invite(uuid) to authenticated;
