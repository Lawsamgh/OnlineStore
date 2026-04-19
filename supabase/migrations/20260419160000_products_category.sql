-- Legacy free-text category on products; superseded by product_categories (20260419180000).
alter table public.products add column if not exists category text;
