-- Fix RPC return-shape mismatch for store admin functions by enforcing
-- explicit column order/types in RETURN QUERY projections.

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

  if not (
    public.auth_is_platform_staff()
    or v_owner_id = auth.uid()
    or public.auth_is_store_admin(p_store_id)
  ) then
    raise exception 'not allowed';
  end if;

  return query
  select
    x.user_id::uuid,
    x.role::text,
    x.display_name::text,
    x.email::text,
    x.created_at::timestamptz
  from (
    select
      p.id as user_id,
      'owner'::text as role,
      p.display_name,
      au.email::text as email,
      null::timestamptz as created_at
    from public.profiles p
    left join auth.users au on au.id = p.id
    where p.id = v_owner_id

    union all

    select
      sa.user_id as user_id,
      'admin'::text as role,
      p.display_name,
      au.email::text as email,
      sa.created_at as created_at
    from public.store_admins sa
    join public.profiles p on p.id = sa.user_id
    left join auth.users au on au.id = sa.user_id
    where sa.store_id = p_store_id
  ) as x
  order by x.role desc, x.created_at nulls first, x.display_name nulls last;
end;
$$;

revoke all on function public.list_store_admin_members(uuid) from public;
grant execute on function public.list_store_admin_members(uuid) to authenticated;

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
set search_path = public, auth
as $$
declare
  v_store public.stores%rowtype;
  v_target_id uuid;
  v_plan text;
  v_max integer;
  v_existing_count integer;
begin
  select * into v_store
  from public.stores
  where id = p_store_id;

  if v_store.id is null then
    raise exception 'store not found';
  end if;

  if not (public.auth_is_platform_staff() or v_store.owner_id = auth.uid()) then
    raise exception 'only the store owner can add admins';
  end if;

  select p.signup_plan into v_plan
  from public.profiles p
  where p.id = v_store.owner_id;

  v_max := public.max_admin_users_for_plan(v_plan);

  select 1 + count(*) into v_existing_count
  from public.store_admins sa
  where sa.store_id = p_store_id;

  if v_existing_count >= v_max then
    raise exception 'admin user limit reached for current plan';
  end if;

  select u.id into v_target_id
  from auth.users u
  where lower(u.email) = lower(trim(p_email))
  limit 1;

  if v_target_id is null then
    raise exception 'no account found for that email';
  end if;

  if v_target_id = v_store.owner_id then
    raise exception 'store owner is already an admin';
  end if;

  insert into public.store_admins (store_id, user_id)
  values (p_store_id, v_target_id)
  on conflict (store_id, user_id) do nothing;

  if not exists (
    select 1
    from public.store_admins
    where store_id = p_store_id and user_id = v_target_id
  ) then
    raise exception 'failed to add store admin';
  end if;

  return query
  select
    p.id::uuid as user_id,
    'admin'::text as role,
    p.display_name::text as display_name,
    au.email::text as email,
    sa.created_at::timestamptz as created_at
  from public.store_admins sa
  join public.profiles p on p.id = sa.user_id
  left join auth.users au on au.id = sa.user_id
  where sa.store_id = p_store_id
    and sa.user_id = v_target_id
  limit 1;
end;
$$;

revoke all on function public.add_store_admin_by_email(uuid, text) from public;
grant execute on function public.add_store_admin_by_email(uuid, text) to authenticated;
