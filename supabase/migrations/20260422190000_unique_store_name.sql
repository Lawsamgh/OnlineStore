-- Enforce globally unique store names (case-insensitive).
-- This prevents two storefronts from sharing the same visible name.

create unique index if not exists stores_name_unique_ci_idx
on public.stores (lower(btrim(name)));
