-- Customer product reviews (verified buyer flow via secure RPC).

create table if not exists public.product_reviews (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text null,
  reviewer_name text null,
  is_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_reviews_one_per_order_product unique (order_id, product_id)
);

create index if not exists product_reviews_product_created_idx
  on public.product_reviews (product_id, created_at desc);

create index if not exists product_reviews_store_created_idx
  on public.product_reviews (store_id, created_at desc);

drop trigger if exists product_reviews_set_updated_at on public.product_reviews;
create trigger product_reviews_set_updated_at
before update on public.product_reviews
for each row execute procedure public.set_updated_at();

alter table public.product_reviews enable row level security;

drop policy if exists "product_reviews_public_read_visible" on public.product_reviews;
create policy "product_reviews_public_read_visible"
on public.product_reviews
for select
using (is_visible = true);

create or replace function public.buyer_order_reviewable_items(
  p_store_slug text,
  p_order_ref text,
  p_verify text
)
returns table (
  product_id uuid,
  product_title text,
  already_reviewed boolean,
  existing_rating smallint,
  existing_comment text,
  existing_reviewer_name text
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
  v_order_id uuid;
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

  select o.id
  into v_order_id
  from public.orders o
  where o.store_id = v_store_id
    and o.order_ref = v_ref
    and o.status = 'delivered'
    and (
      (o.guest_email is not null and v_email = o.guest_email)
      or (
        o.guest_phone is not null
        and length(v_digits) >= 9
        and regexp_replace(o.guest_phone, '[^0-9]', '', 'g') = v_digits
      )
    )
  limit 1;

  if not found then
    return;
  end if;

  return query
  select
    oi.product_id,
    oi.title_snapshot as product_title,
    (pr.id is not null) as already_reviewed,
    pr.rating as existing_rating,
    pr.comment as existing_comment,
    pr.reviewer_name as existing_reviewer_name
  from public.order_items oi
  left join public.product_reviews pr
    on pr.order_id = oi.order_id
   and pr.product_id = oi.product_id
  where oi.order_id = v_order_id
    and oi.product_id is not null
  group by oi.product_id, oi.title_snapshot, pr.id, pr.rating, pr.comment, pr.reviewer_name
  order by oi.title_snapshot asc;
end;
$$;

create or replace function public.submit_buyer_product_review(
  p_store_slug text,
  p_order_ref text,
  p_verify text,
  p_product_id uuid,
  p_rating int,
  p_comment text default null,
  p_reviewer_name text default null
)
returns table (
  ok boolean,
  message text
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
  v_order_id uuid;
  v_product_exists boolean;
begin
  if p_product_id is null then
    return query select false, 'Product is required';
    return;
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    return query select false, 'Rating must be between 1 and 5';
    return;
  end if;

  v_ref := public.normalize_buyer_order_ref(p_order_ref);
  if v_ref is null then
    return query select false, 'Invalid order reference';
    return;
  end if;
  if p_store_slug is null or length(trim(p_store_slug)) = 0
     or p_verify is null or length(trim(p_verify)) = 0 then
    return query select false, 'Missing verification details';
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
    return query select false, 'Store not found';
    return;
  end if;

  select o.id
  into v_order_id
  from public.orders o
  where o.store_id = v_store_id
    and o.order_ref = v_ref
    and o.status = 'delivered'
    and (
      (o.guest_email is not null and v_email = o.guest_email)
      or (
        o.guest_phone is not null
        and length(v_digits) >= 9
        and regexp_replace(o.guest_phone, '[^0-9]', '', 'g') = v_digits
      )
    )
  limit 1;

  if not found then
    return query select false, 'Order not eligible for review';
    return;
  end if;

  select exists (
    select 1
    from public.order_items oi
    where oi.order_id = v_order_id
      and oi.product_id = p_product_id
  ) into v_product_exists;

  if not v_product_exists then
    return query select false, 'Product was not found in this order';
    return;
  end if;

  insert into public.product_reviews (
    store_id,
    product_id,
    order_id,
    rating,
    comment,
    reviewer_name,
    is_visible
  )
  values (
    v_store_id,
    p_product_id,
    v_order_id,
    p_rating::smallint,
    nullif(trim(coalesce(p_comment, '')), ''),
    nullif(trim(coalesce(p_reviewer_name, '')), ''),
    true
  )
  on conflict (order_id, product_id)
  do update set
    rating = excluded.rating,
    comment = excluded.comment,
    reviewer_name = excluded.reviewer_name,
    is_visible = true,
    updated_at = now();

  return query select true, 'Review saved';
end;
$$;

grant execute on function public.buyer_order_reviewable_items(text, text, text) to anon, authenticated;
grant execute on function public.submit_buyer_product_review(text, text, text, uuid, int, text, text) to anon, authenticated;
