-- Public (anon-safe) order lookup for storefront delivery tracker.
-- Requires order reference + email or phone used at checkout (same as stored guest_* fields).

create or replace function public.normalize_buyer_order_ref(p_input text)
returns text
language sql
immutable
as $$
  with u as (
    select upper(regexp_replace(trim(coalesce(p_input, '')), '\s+', '', 'g')) as x
  )
  select case
    when (select x from u) ~ '^ORD-[A-Z0-9]{4}-[A-Z0-9]{4}$' then (select x from u)
    when (select x from u) ~ '^ORD[A-Z0-9]{8}$' then
      'ORD-' || substr((select x from u), 4, 4) || '-' || right((select x from u), 4)
    when (select x from u) ~ '^[A-Z0-9]{4}-[A-Z0-9]{4}$' then 'ORD-' || (select x from u)
    else null
  end;
$$;

create or replace function public.lookup_buyer_order_status(
  p_store_slug text,
  p_order_ref text,
  p_verify text
)
returns table (
  order_ref text,
  status public.order_status,
  created_at timestamptz,
  updated_at timestamptz,
  item_count bigint,
  item_units bigint,
  delivery_stage public.delivery_stage,
  delivery_updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref text;
  v_store_id uuid;
  v_email text;
  v_digits text;
begin
  v_ref := public.normalize_buyer_order_ref(p_order_ref);
  if v_ref is null then
    return;
  end if;

  if p_store_slug is null or length(trim(p_store_slug)) = 0
     or p_verify is null or length(trim(p_verify)) = 0 then
    return;
  end if;

  v_email := lower(trim(p_verify));
  v_digits := regexp_replace(trim(p_verify), '[^0-9]', '', 'g');

  select s.id
  into v_store_id
  from public.stores s
  where s.slug = trim(p_store_slug)
    and s.is_active
  limit 1;

  if not found then
    return;
  end if;

  return query
  select
    o.order_ref,
    o.status,
    o.created_at,
    o.updated_at,
    (select count(*)::bigint from public.order_items oi where oi.order_id = o.id),
    coalesce(
      (select sum(oi.quantity)::bigint from public.order_items oi where oi.order_id = o.id),
      0::bigint
    ),
    coalesce(dt.stage, 'pending'::public.delivery_stage),
    dt.updated_at
  from public.orders o
  left join public.delivery_tracking dt on dt.order_id = o.id
  where o.store_id = v_store_id
    and o.order_ref = v_ref
    and (
      (o.guest_email is not null and v_email = o.guest_email)
      or (
        o.guest_phone is not null
        and length(v_digits) >= 9
        and regexp_replace(o.guest_phone, '[^0-9]', '', 'g') = v_digits
      )
    )
  limit 1;
end;
$$;

grant execute on function public.normalize_buyer_order_ref(text) to anon, authenticated;

grant execute on function public.lookup_buyer_order_status(text, text, text) to anon, authenticated;
