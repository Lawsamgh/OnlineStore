-- Store-level admin users (seller team members, scoped per store).
-- Owners can add/remove admins up to plan seat limits.

create table if not exists public.store_admins (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint store_admins_store_user_unique unique (store_id, user_id)
);

create index if not exists store_admins_store_id_idx on public.store_admins (store_id);
create index if not exists store_admins_user_id_idx on public.store_admins (user_id);

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
        or exists (
          select 1
          from public.store_admins sa
          where sa.store_id = s.id
            and sa.user_id = auth.uid()
        )
      )
  );
$$;

grant execute on function public.auth_is_store_admin(uuid) to authenticated;

create or replace function public.max_admin_users_for_plan(p_plan text)
returns integer
language sql
immutable
as $$
  select case lower(coalesce(trim(p_plan), 'free'))
    when 'free' then 1
    when 'starter' then 1
    when 'growth' then 3
    when 'pro' then 1000000
    else 1
  end;
$$;

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
  with owner_row as (
    select
      p.id as user_id,
      'owner'::text as role,
      p.display_name,
      au.email,
      null::timestamptz as created_at
    from public.profiles p
    left join auth.users au on au.id = p.id
    where p.id = v_owner_id
  ),
  admin_rows as (
    select
      sa.user_id,
      'admin'::text as role,
      p.display_name,
      au.email,
      sa.created_at
    from public.store_admins sa
    join public.profiles p on p.id = sa.user_id
    left join auth.users au on au.id = sa.user_id
    where sa.store_id = p_store_id
  )
  select * from owner_row
  union all
  select * from admin_rows
  order by role desc, created_at nulls first, display_name nulls last;
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

  select p.signup_plan
    into v_plan
  from public.profiles p
  where p.id = v_store.owner_id;

  v_max := public.max_admin_users_for_plan(v_plan);

  -- Count includes owner seat.
  select 1 + count(*)
    into v_existing_count
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
    select 1 from public.store_admins
    where store_id = p_store_id and user_id = v_target_id
  ) then
    raise exception 'failed to add store admin';
  end if;

  return query
  select
    p.id as user_id,
    'admin'::text as role,
    p.display_name,
    au.email,
    sa.created_at
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

create or replace function public.remove_store_admin(
  p_store_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
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
    raise exception 'only the store owner can remove admins';
  end if;

  if p_user_id = v_owner_id then
    raise exception 'cannot remove store owner';
  end if;

  delete from public.store_admins sa
  where sa.store_id = p_store_id
    and sa.user_id = p_user_id;

  if not found then
    raise exception 'admin user not found on this store';
  end if;
end;
$$;

revoke all on function public.remove_store_admin(uuid, uuid) from public;
grant execute on function public.remove_store_admin(uuid, uuid) to authenticated;

alter table public.store_admins enable row level security;

create policy "store_admins_select_visible_to_owner_member_staff"
on public.store_admins for select
to authenticated
using (
  public.auth_is_platform_staff()
  or exists (
    select 1 from public.stores s
    where s.id = store_admins.store_id
      and s.owner_id = auth.uid()
  )
  or store_admins.user_id = auth.uid()
);

create policy "store_admins_insert_owner_staff_only"
on public.store_admins for insert
to authenticated
with check (
  public.auth_is_platform_staff()
  or exists (
    select 1 from public.stores s
    where s.id = store_admins.store_id
      and s.owner_id = auth.uid()
  )
);

create policy "store_admins_delete_owner_staff_only"
on public.store_admins for delete
to authenticated
using (
  public.auth_is_platform_staff()
  or exists (
    select 1 from public.stores s
    where s.id = store_admins.store_id
      and s.owner_id = auth.uid()
  )
);

-- Store-level access extensions (owner policies remain unchanged).
create policy "stores_select_store_admin"
on public.stores for select
to authenticated
using (public.auth_is_store_admin(id));

create policy "stores_update_store_admin"
on public.stores for update
to authenticated
using (public.auth_is_store_admin(id))
with check (public.auth_is_store_admin(id));

create policy "products_write_store_admin"
on public.products for all
to authenticated
using (public.auth_is_store_admin(store_id))
with check (public.auth_is_store_admin(store_id));

create policy "orders_select_store_admin"
on public.orders for select
to authenticated
using (public.auth_is_store_admin(store_id));

create policy "orders_update_store_admin"
on public.orders for update
to authenticated
using (public.auth_is_store_admin(store_id))
with check (public.auth_is_store_admin(store_id));

create policy "delivery_tracking_select_store_admin"
on public.delivery_tracking for select
to authenticated
using (
  exists (
    select 1
    from public.orders o
    where o.id = delivery_tracking.order_id
      and public.auth_is_store_admin(o.store_id)
  )
);

create policy "delivery_tracking_write_store_admin"
on public.delivery_tracking for all
to authenticated
using (
  exists (
    select 1
    from public.orders o
    where o.id = delivery_tracking.order_id
      and public.auth_is_store_admin(o.store_id)
  )
)
with check (
  exists (
    select 1
    from public.orders o
    where o.id = delivery_tracking.order_id
      and public.auth_is_store_admin(o.store_id)
  )
);

create policy "order_items_select_store_admin"
on public.order_items for select
to authenticated
using (
  exists (
    select 1
    from public.orders o
    where o.id = order_items.order_id
      and public.auth_is_store_admin(o.store_id)
  )
);

create policy "support_tickets_insert_store_admin"
on public.support_tickets for insert
to authenticated
with check (
  author_id = auth.uid()
  and public.auth_is_store_admin(store_id)
);

create policy "support_tickets_select_store_admin"
on public.support_tickets for select
to authenticated
using (public.auth_is_store_admin(store_id));

create policy "product_categories_select_store_admin"
on public.product_categories for select
to authenticated
using (public.auth_is_store_admin(store_id));

create policy "product_categories_write_store_admin"
on public.product_categories for all
to authenticated
using (public.auth_is_store_admin(store_id))
with check (public.auth_is_store_admin(store_id));

create policy "product_images_store_admin_write"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'product-images'
  and exists (
    select 1
    from public.store_admins sa
    where sa.store_id::text = (storage.foldername(name))[1]
      and sa.user_id = auth.uid()
  )
);

create policy "product_images_store_admin_update"
on storage.objects for update
to authenticated
using (
  bucket_id = 'product-images'
  and exists (
    select 1
    from public.store_admins sa
    where sa.store_id::text = (storage.foldername(name))[1]
      and sa.user_id = auth.uid()
  )
);

create policy "product_images_store_admin_delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'product-images'
  and exists (
    select 1
    from public.store_admins sa
    where sa.store_id::text = (storage.foldername(name))[1]
      and sa.user_id = auth.uid()
  )
);

create policy "store_logos_store_admin_write"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'store-logos'
  and exists (
    select 1
    from public.store_admins sa
    where sa.store_id::text = (storage.foldername(name))[1]
      and sa.user_id = auth.uid()
  )
);

create policy "store_logos_store_admin_update"
on storage.objects for update
to authenticated
using (
  bucket_id = 'store-logos'
  and exists (
    select 1
    from public.store_admins sa
    where sa.store_id::text = (storage.foldername(name))[1]
      and sa.user_id = auth.uid()
  )
);

create policy "store_logos_store_admin_delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'store-logos'
  and exists (
    select 1
    from public.store_admins sa
    where sa.store_id::text = (storage.foldername(name))[1]
      and sa.user_id = auth.uid()
  )
);
