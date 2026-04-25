alter table public.products
add column if not exists availability text not null default 'in_stock'
  check (availability in ('in_stock', 'out_of_stock'));

create index if not exists products_store_availability_idx
  on public.products (store_id, availability);
