-- Seller-defined categories per store; products reference via category_id.

create table public.product_categories (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_categories_name_not_blank check (btrim(name) <> '')
);

create unique index product_categories_store_name_lower_idx
  on public.product_categories (store_id, lower(btrim(name)));

create index product_categories_store_id_idx
  on public.product_categories (store_id);

create trigger product_categories_set_updated_at
before update on public.product_categories
for each row execute procedure public.set_updated_at();

alter table public.products
  add column if not exists category_id uuid references public.product_categories (id) on delete set null;

create index if not exists products_category_id_idx on public.products (category_id);

comment on table public.product_categories is
  'Per-store catalog labels; products optionally reference one row.';
comment on column public.products.category_id is
  'FK to product_categories for this product''s store.';

-- Migrate legacy text column from 20260419160000_products_category.sql when present.
do $migrate_legacy$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'products'
      and column_name = 'category'
  ) then
    insert into public.product_categories (store_id, name)
    select distinct p.store_id, btrim(p.category)
    from public.products p
    where p.category is not null
      and btrim(p.category) <> ''
      and not exists (
        select 1
        from public.product_categories c
        where c.store_id = p.store_id
          and lower(btrim(c.name)) = lower(btrim(p.category))
      );

    update public.products p
    set category_id = c.id
    from public.product_categories c
    where p.category is not null
      and btrim(p.category) <> ''
      and c.store_id = p.store_id
      and lower(btrim(c.name)) = lower(btrim(p.category));

    alter table public.products drop column category;
  end if;
end
$migrate_legacy$;

alter table public.product_categories enable row level security;

-- Browse active shops; owners always see their own rows.
create policy "product_categories_select_public_or_owner"
on public.product_categories for select
using (
  exists (
    select 1
    from public.stores s
    where s.id = product_categories.store_id
      and (s.is_active or s.owner_id = auth.uid())
  )
);

create policy "product_categories_select_platform_staff"
on public.product_categories for select
to authenticated
using (public.auth_is_platform_staff());

create policy "product_categories_write_owner"
on public.product_categories for all
to authenticated
using (
  exists (
    select 1
    from public.stores s
    where s.id = product_categories.store_id and s.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.stores s
    where s.id = product_categories.store_id and s.owner_id = auth.uid()
  )
);

drop policy if exists "products_write_owner" on public.products;

create policy "products_write_owner"
on public.products for all
to authenticated
using (
  exists (
    select 1
    from public.stores s
    where s.id = products.store_id and s.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.stores s
    where s.id = products.store_id and s.owner_id = auth.uid()
  )
  and (
    category_id is null
    or exists (
      select 1
      from public.product_categories pc
      where pc.id = products.category_id
        and pc.store_id = products.store_id
    )
  )
);

do $realtime$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'product_categories'
  ) then
    alter publication supabase_realtime add table public.product_categories;
  end if;
end
$realtime$;
