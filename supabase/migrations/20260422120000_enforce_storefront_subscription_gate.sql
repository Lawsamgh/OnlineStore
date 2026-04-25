-- Enforce storefront access for paid plans:
-- - Public product reads require an active, non-expired store subscription.
-- - Checkout/order creation is blocked when subscription is lapsed.
-- Free plan stores remain accessible.

create or replace function public.storefront_access_allowed(p_store_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_signup_plan text;
begin
  if p_store_id is null then
    return false;
  end if;

  select s.owner_id
  into v_owner_id
  from public.stores s
  where s.id = p_store_id
  limit 1;

  if v_owner_id is null then
    return false;
  end if;

  select lower(coalesce(nullif(trim(p.signup_plan), ''), 'free'))
  into v_signup_plan
  from public.profiles p
  where p.id = v_owner_id
  limit 1;

  -- Free or unset plan stays publicly accessible.
  if coalesce(v_signup_plan, 'free') = 'free' then
    return true;
  end if;

  -- Paid plans require a currently valid active/trialing subscription.
  return exists (
    select 1
    from public.seller_subscriptions ss
    where ss.store_id = p_store_id
      and ss.status in ('active', 'trialing')
      and (ss.current_period_end is null or ss.current_period_end > now())
  );
end;
$$;

drop policy if exists "products_select_public_or_owner" on public.products;

create policy "products_select_public_or_owner"
on public.products for select
using (
  exists (
    select 1
    from public.stores s
    where s.id = products.store_id
      and (
        s.owner_id = auth.uid()
        or (
          products.is_published
          and s.is_active
          and public.storefront_access_allowed(s.id)
        )
      )
  )
);

drop policy if exists "orders_insert_checkout" on public.orders;

create policy "orders_insert_checkout"
on public.orders for insert
with check (
  exists (
    select 1
    from public.stores s
    where s.id = store_id
      and s.is_active
      and public.storefront_access_allowed(s.id)
  )
  and (
    (
      auth.uid() is not null
      and customer_id = auth.uid()
    )
    or (
      auth.uid() is null
      and customer_id is null
      and guest_name is not null
      and guest_email is not null
      and guest_phone is not null
    )
  )
);

create or replace function public.create_order_from_cart(
  p_store_slug text,
  p_lines jsonb,
  p_delivery_address text,
  p_customer_notes text,
  p_guest_name text default null,
  p_guest_email text default null,
  p_guest_phone text default null
)
returns table (order_id uuid, notify_token uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_order_id uuid;
  v_notify uuid;
  line jsonb;
  v_pid uuid;
  v_qty int;
  v_title text;
  v_price_cents int;
begin
  if p_store_slug is null or length(trim(p_store_slug)) = 0 then
    raise exception 'Invalid store';
  end if;

  select s.id
  into v_store_id
  from public.stores s
  where s.slug = p_store_slug
    and s.is_active
  limit 1;

  if not found then
    raise exception 'Store not found';
  end if;

  if not public.storefront_access_allowed(v_store_id) then
    raise exception 'Store subscription expired';
  end if;

  if auth.uid() is null then
    if p_guest_name is null or length(trim(p_guest_name)) = 0
      or p_guest_email is null or length(trim(p_guest_email)) = 0
      or p_guest_phone is null or length(trim(p_guest_phone)) = 0
    then
      raise exception 'Guest details required';
    end if;
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Cart is empty';
  end if;

  insert into public.orders as o (
    store_id,
    customer_id,
    guest_name,
    guest_email,
    guest_phone,
    delivery_address,
    customer_notes
  )
  values (
    v_store_id,
    auth.uid(),
    case
      when p_guest_name is not null and length(trim(p_guest_name)) > 0 then trim(p_guest_name)
      else null
    end,
    case
      when p_guest_email is not null and length(trim(p_guest_email)) > 0 then lower(trim(p_guest_email))
      else null
    end,
    case
      when p_guest_phone is not null and length(trim(p_guest_phone)) > 0 then trim(p_guest_phone)
      else null
    end,
    nullif(trim(p_delivery_address), ''),
    nullif(trim(p_customer_notes), '')
  )
  returning o.id, o.notify_token into v_order_id, v_notify;

  for line in select * from jsonb_array_elements(p_lines)
  loop
    v_pid := (line ->> 'product_id')::uuid;
    v_qty := coalesce((line ->> 'quantity')::int, 0);
    if v_qty < 1 or v_qty > 99 then
      raise exception 'Invalid quantity';
    end if;

    select p.title, p.price_cents
    into v_title, v_price_cents
    from public.products p
    where p.id = v_pid
      and p.store_id = v_store_id
      and p.is_published;

    if not found then
      raise exception 'Invalid product';
    end if;

    insert into public.order_items (
      order_id,
      product_id,
      title_snapshot,
      unit_price_cents,
      quantity
    )
    values (
      v_order_id,
      v_pid,
      v_title,
      v_price_cents,
      v_qty
    );
  end loop;

  return query select v_order_id, v_notify;
end;
$$;

grant execute on function public.create_order_from_cart(
  text,
  jsonb,
  text,
  text,
  text,
  text,
  text
) to anon, authenticated;
