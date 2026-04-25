-- Rollback to owner-only store access (single admin seat = owner).

-- Remove all non-owner teammate memberships.
delete from public.store_admins sa
using public.stores s
where sa.store_id = s.id
  and sa.user_id <> s.owner_id;

-- Revoke all pending teammate invites.
update public.store_admin_invites
set status = 'revoked'
where status = 'pending';

-- Owner-only gate (platform staff retained for console operations).
create or replace function public.auth_is_store_admin(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.stores s
    where s.id = p_store_id
      and (
        s.owner_id = auth.uid()
        or public.auth_is_platform_staff()
      )
  );
$$;

grant execute on function public.auth_is_store_admin(uuid) to authenticated;

create or replace function public.max_admin_users_for_plan(p_plan text)
returns integer
language sql
immutable
as $$
  select 1;
$$;

-- Keep listing shape stable but return owner row only.
create or replace function public.list_store_admin_members(p_store_id uuid)
returns table (
  user_id uuid,
  role text,
  display_name text,
  email text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_owner_id uuid;
begin
  select s.owner_id into v_owner_id
  from public.stores s
  where s.id = p_store_id;

  if v_owner_id is null then
    raise exception 'store not found';
  end if;

  if not (public.auth_is_platform_staff() or v_owner_id = auth.uid()) then
    raise exception 'not allowed';
  end if;

  return query
  select
    p.id::uuid as user_id,
    'owner'::text as role,
    p.display_name::text,
    au.email::text as email,
    null::timestamptz as created_at
  from public.profiles p
  left join auth.users au on au.id = p.id
  where p.id = v_owner_id
  limit 1;
end;
$$;

revoke all on function public.list_store_admin_members(uuid) from public;
grant execute on function public.list_store_admin_members(uuid) to authenticated;

-- Disable teammate-management RPCs while keeping function signatures stable.
create or replace function public.add_store_admin_by_email(
  p_store_id uuid,
  p_email text
)
returns table (
  user_id uuid,
  role text,
  display_name text,
  email text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'Store teammate access is disabled. Only the store owner is allowed.';
end;
$$;

revoke all on function public.add_store_admin_by_email(uuid, text) from public;
grant execute on function public.add_store_admin_by_email(uuid, text) to authenticated;

create or replace function public.remove_store_admin(
  p_store_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'Store teammate access is disabled. Only the store owner is allowed.';
end;
$$;

revoke all on function public.remove_store_admin(uuid, uuid) from public;
grant execute on function public.remove_store_admin(uuid, uuid) to authenticated;

create or replace function public.invite_store_admin_email(
  p_store_id uuid,
  p_email text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'Store teammate access is disabled. Only the store owner is allowed.';
end;
$$;

revoke all on function public.invite_store_admin_email(uuid, text) from public;
grant execute on function public.invite_store_admin_email(uuid, text) to authenticated;

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
language sql
security definer
set search_path = public
as $$
  select
    null::uuid as id,
    null::text as email,
    null::text as status,
    null::uuid as invited_by,
    null::timestamptz as created_at
  where false;
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
  raise exception 'Store teammate access is disabled. Only the store owner is allowed.';
end;
$$;

revoke all on function public.revoke_store_admin_invite(uuid) from public;
grant execute on function public.revoke_store_admin_invite(uuid) to authenticated;
