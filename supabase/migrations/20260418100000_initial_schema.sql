-- UandITech SaaS — core multi-tenant schema (stores, catalog, checkout, subscriptions, delivery)

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  phone_e164 text,
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute procedure public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Tenants: stores (seller shops)
-- ---------------------------------------------------------------------------

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  slug text not null unique,
  name text not null,
  description text,
  whatsapp_phone_e164 text,
  logo_path text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index stores_owner_id_idx on public.stores (owner_id);
create index stores_slug_idx on public.stores (slug);

create trigger stores_set_updated_at
before update on public.stores
for each row execute procedure public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Seller → platform subscription (Paystack metadata)
-- ---------------------------------------------------------------------------

create table public.seller_subscriptions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  paystack_customer_code text,
  paystack_subscription_code text,
  status text not null default 'inactive'
    check (status in ('inactive', 'trialing', 'active', 'past_due', 'canceled')),
  plan_interval text not null default 'monthly',
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index seller_subscriptions_store_id_idx on public.seller_subscriptions (store_id);

create trigger seller_subscriptions_set_updated_at
before update on public.seller_subscriptions
for each row execute procedure public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------

create table public.products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  title text not null,
  description text,
  price_cents integer not null check (price_cents >= 0),
  currency text not null default 'GHS',
  image_paths text[] not null default '{}',
  track_inventory boolean not null default false,
  stock_qty integer,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index products_store_id_idx on public.products (store_id);
create index products_store_published_idx on public.products (store_id) where is_published;

create trigger products_set_updated_at
before update on public.products
for each row execute procedure public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Orders (no product payment online — cash / arrangement off-platform)
-- ---------------------------------------------------------------------------

create type public.order_status as enum (
  'pending',
  'confirmed',
  'preparing',
  'out_for_delivery',
  'delivered',
  'canceled'
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete restrict,
  customer_id uuid references public.profiles (id) on delete set null,
  guest_name text,
  guest_email text,
  guest_phone text,
  status public.order_status not null default 'pending',
  delivery_address text,
  customer_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_customer_or_guest check (
    customer_id is not null
    or (
      guest_name is not null
      and guest_email is not null
      and guest_phone is not null
    )
  )
);

create index orders_store_id_idx on public.orders (store_id);
create index orders_customer_id_idx on public.orders (customer_id);

create trigger orders_set_updated_at
before update on public.orders
for each row execute procedure public.set_updated_at();

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  title_snapshot text not null,
  unit_price_cents integer not null check (unit_price_cents >= 0),
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default now()
);

create index order_items_order_id_idx on public.order_items (order_id);

-- ---------------------------------------------------------------------------
-- Live delivery tracker (Supabase Realtime)
-- ---------------------------------------------------------------------------

create type public.delivery_stage as enum (
  'pending',
  'picked_up',
  'in_transit',
  'delivered'
);

create table public.delivery_tracking (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders (id) on delete cascade,
  stage public.delivery_stage not null default 'pending',
  driver_name text,
  driver_phone text,
  last_latitude double precision,
  last_longitude double precision,
  last_message text,
  updated_at timestamptz not null default now()
);

create index delivery_tracking_order_id_idx on public.delivery_tracking (order_id);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.stores enable row level security;
alter table public.seller_subscriptions enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.delivery_tracking enable row level security;

-- Profiles
create policy "profiles_select_own"
on public.profiles for select
to authenticated
using (auth.uid() = id);

create policy "profiles_update_own"
on public.profiles for update
to authenticated
using (auth.uid() = id);

-- Stores
create policy "stores_select_public_active"
on public.stores for select
using (is_active = true or owner_id = auth.uid());

create policy "stores_insert_owner"
on public.stores for insert
to authenticated
with check (owner_id = auth.uid());

create policy "stores_update_owner"
on public.stores for update
to authenticated
using (owner_id = auth.uid());

create policy "stores_delete_owner"
on public.stores for delete
to authenticated
using (owner_id = auth.uid());

-- Seller subscriptions
create policy "seller_subscriptions_write_owner"
on public.seller_subscriptions for all
to authenticated
using (
  exists (
    select 1 from public.stores s
    where s.id = seller_subscriptions.store_id and s.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.stores s
    where s.id = seller_subscriptions.store_id and s.owner_id = auth.uid()
  )
);

-- Products
create policy "products_select_public_or_owner"
on public.products for select
using (
  exists (
    select 1 from public.stores s
    where s.id = products.store_id
    and (s.owner_id = auth.uid() or (products.is_published and s.is_active))
  )
);

create policy "products_write_owner"
on public.products for all
to authenticated
using (
  exists (
    select 1 from public.stores s
    where s.id = products.store_id and s.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.stores s
    where s.id = products.store_id and s.owner_id = auth.uid()
  )
);

-- Orders
create policy "orders_insert_checkout"
on public.orders for insert
with check (
  exists (select 1 from public.stores s where s.id = store_id and s.is_active)
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

create policy "orders_select_customer"
on public.orders for select
to authenticated
using (customer_id = auth.uid());

create policy "orders_select_seller"
on public.orders for select
to authenticated
using (
  exists (
    select 1 from public.stores s
    where s.id = orders.store_id and s.owner_id = auth.uid()
  )
);

create policy "orders_update_seller"
on public.orders for update
to authenticated
using (
  exists (
    select 1 from public.stores s
    where s.id = orders.store_id and s.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.stores s
    where s.id = orders.store_id and s.owner_id = auth.uid()
  )
);

-- Order items
create policy "order_items_select_visible_order"
on public.order_items for select
to authenticated
using (
  exists (
    select 1 from public.orders o
    where o.id = order_items.order_id
    and (
      o.customer_id = auth.uid()
      or exists (
        select 1 from public.stores s
        where s.id = o.store_id and s.owner_id = auth.uid()
      )
    )
  )
);

create policy "order_items_insert_pending_order"
on public.order_items for insert
with check (
  exists (
    select 1 from public.orders o
    where o.id = order_id
      and o.status = 'pending'
      and (
        (
          auth.uid() is not null
          and o.customer_id = auth.uid()
        )
        or (
          auth.uid() is null
          and o.customer_id is null
          and o.guest_name is not null
          and o.guest_email is not null
          and o.guest_phone is not null
        )
      )
  )
);

-- Delivery tracking
create policy "delivery_tracking_select_customer"
on public.delivery_tracking for select
to authenticated
using (
  exists (
    select 1 from public.orders o
    where o.id = delivery_tracking.order_id
    and o.customer_id = auth.uid()
  )
);

create policy "delivery_tracking_select_seller"
on public.delivery_tracking for select
to authenticated
using (
  exists (
    select 1 from public.orders o
    join public.stores s on s.id = o.store_id
    where o.id = delivery_tracking.order_id
    and s.owner_id = auth.uid()
  )
);

create policy "delivery_tracking_write_seller"
on public.delivery_tracking for all
to authenticated
using (
  exists (
    select 1 from public.orders o
    join public.stores s on s.id = o.store_id
    where o.id = delivery_tracking.order_id
    and s.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.orders o
    join public.stores s on s.id = o.store_id
    where o.id = delivery_tracking.order_id
    and s.owner_id = auth.uid()
  )
);

-- ---------------------------------------------------------------------------
-- Realtime (live delivery updates)
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.delivery_tracking;

-- ---------------------------------------------------------------------------
-- Storage buckets (product images, store logos)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
select 'product-images', 'product-images', true
where not exists (select 1 from storage.buckets where id = 'product-images');

insert into storage.buckets (id, name, public)
select 'store-logos', 'store-logos', true
where not exists (select 1 from storage.buckets where id = 'store-logos');

create policy "product_images_public_read"
on storage.objects for select
using (bucket_id = 'product-images');

create policy "product_images_owner_write"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'product-images'
  and (storage.foldername (name))[1] in (
    select s.id::text from public.stores s where s.owner_id = auth.uid()
  )
);

create policy "product_images_owner_update"
on storage.objects for update
to authenticated
using (
  bucket_id = 'product-images'
  and (storage.foldername (name))[1] in (
    select s.id::text from public.stores s where s.owner_id = auth.uid()
  )
);

create policy "product_images_owner_delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'product-images'
  and (storage.foldername (name))[1] in (
    select s.id::text from public.stores s where s.owner_id = auth.uid()
  )
);

create policy "store_logos_public_read"
on storage.objects for select
using (bucket_id = 'store-logos');

create policy "store_logos_owner_write"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'store-logos'
  and (storage.foldername (name))[1] in (
    select s.id::text from public.stores s where s.owner_id = auth.uid()
  )
);

create policy "store_logos_owner_update"
on storage.objects for update
to authenticated
using (
  bucket_id = 'store-logos'
  and (storage.foldername (name))[1] in (
    select s.id::text from public.stores s where s.owner_id = auth.uid()
  )
);

create policy "store_logos_owner_delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'store-logos'
  and (storage.foldername (name))[1] in (
    select s.id::text from public.stores s where s.owner_id = auth.uid()
  )
);
