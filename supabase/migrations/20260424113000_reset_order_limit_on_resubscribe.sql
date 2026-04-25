-- Reset Starter/Growth order usage on renewal/resubscribe by counting orders
-- within the active subscription billing cycle (not calendar month).

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
  v_sub_period_end timestamptz;
  v_sub_period_start timestamptz;
  v_sub_interval text;
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

    -- For paid plans with active subscription, use subscription billing cycle
    -- so usage resets on renewal/resubscribe.
    if v_plan in ('starter', 'growth') then
      select
        ss.current_period_end,
        lower(coalesce(ss.plan_interval, 'monthly'))
      into
        v_sub_period_end,
        v_sub_interval
      from public.seller_subscriptions ss
      where ss.store_id = v_store_id
        and ss.status in ('active', 'trialing')
        and ss.current_period_end is not null
        and ss.current_period_end > now()
      order by ss.updated_at desc
      limit 1;

      if v_sub_period_end is not null then
        if v_sub_interval = 'annual' then
          v_sub_period_start := v_sub_period_end - interval '1 year';
        else
          v_sub_period_start := v_sub_period_end - interval '1 month';
        end if;
        v_month_start := v_sub_period_start;
        v_month_next := v_sub_period_end;
      end if;
    end if;

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
