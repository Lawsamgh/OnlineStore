-- Enforce plan feature caps at DB level so runtime behavior matches pricing:
-- - Product count cap per store owner plan (free/starter/growth; pro unlimited)
-- - Monthly order cap per store owner plan (free/starter/growth; pro unlimited)

create or replace function public.plan_product_limit(p_plan text)
returns integer
language sql
immutable
as $$
  select case lower(coalesce(nullif(trim(p_plan), ''), 'free'))
    when 'free' then 5
    when 'starter' then 30
    when 'growth' then 150
    when 'pro' then null
    else 5
  end;
$$;

create or replace function public.plan_monthly_order_limit(p_plan text)
returns integer
language sql
immutable
as $$
  select case lower(coalesce(nullif(trim(p_plan), ''), 'free'))
    when 'free' then 15
    when 'starter' then 100
    when 'growth' then 500
    when 'pro' then null
    else 15
  end;
$$;

create or replace function public.resolve_store_plan_id(p_store_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_signup_plan text;
  v_sub_plan text;
begin
  if p_store_id is null then
    return 'free';
  end if;

  select s.owner_id
  into v_owner_id
  from public.stores s
  where s.id = p_store_id
  limit 1;

  if v_owner_id is null then
    return 'free';
  end if;

  select lower(coalesce(nullif(trim(p.signup_plan), ''), 'free'))
  into v_signup_plan
  from public.profiles p
  where p.id = v_owner_id
  limit 1;

  select lower(nullif(trim(ss.pricing_plan_id), ''))
  into v_sub_plan
  from public.seller_subscriptions ss
  where ss.store_id = p_store_id
    and ss.status in ('active', 'trialing')
    and (ss.current_period_end is null or ss.current_period_end > now())
  order by ss.updated_at desc
  limit 1;

  return coalesce(v_sub_plan, v_signup_plan, 'free');
end;
$$;

create or replace function public.enforce_product_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan text;
  v_limit integer;
  v_count integer;
begin
  if tg_op = 'UPDATE' and new.store_id is not distinct from old.store_id then
    return new;
  end if;

  v_plan := public.resolve_store_plan_id(new.store_id);
  v_limit := public.plan_product_limit(v_plan);
  if v_limit is null then
    return new;
  end if;

  select count(*)
  into v_count
  from public.products p
  where p.store_id = new.store_id;

  if tg_op = 'INSERT' and v_count >= v_limit then
    raise exception 'Product limit reached for % plan (% products). Upgrade plan to add more products.',
      initcap(v_plan), v_limit;
  end if;

  if tg_op = 'UPDATE' and new.store_id is distinct from old.store_id and v_count >= v_limit then
    raise exception 'Product limit reached for % plan (% products). Upgrade plan to add more products.',
      initcap(v_plan), v_limit;
  end if;

  return new;
end;
$$;

drop trigger if exists products_enforce_plan_limit on public.products;

create trigger products_enforce_plan_limit
before insert or update of store_id
on public.products
for each row
execute procedure public.enforce_product_plan_limit();

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
  v_plan text;
  v_month_limit integer;
  v_month_count integer;
  v_month_start timestamptz;
  v_month_next timestamptz;
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

  v_plan := public.resolve_store_plan_id(v_store_id);
  v_month_limit := public.plan_monthly_order_limit(v_plan);
  if v_month_limit is not null then
    v_month_start := date_trunc('month', now());
    v_month_next := v_month_start + interval '1 month';
    select count(*)
    into v_month_count
    from public.orders o
    where o.store_id = v_store_id
      and o.created_at >= v_month_start
      and o.created_at < v_month_next;
    if v_month_count >= v_month_limit then
      raise exception 'Monthly order limit reached for % plan (% orders). Upgrade plan to accept more orders this month.',
        initcap(v_plan), v_month_limit;
    end if;
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
