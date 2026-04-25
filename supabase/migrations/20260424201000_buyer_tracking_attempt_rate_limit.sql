-- Rate-limit ledger for anonymous buyer order tracking lookups.
-- Used by edge function `track-order-safe` to throttle brute-force attempts.

create table if not exists public.buyer_tracking_attempts (
  id uuid primary key default gen_random_uuid(),
  ip_hash text not null,
  store_slug text not null,
  success boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists buyer_tracking_attempts_ip_created_idx
on public.buyer_tracking_attempts (ip_hash, created_at desc);

create index if not exists buyer_tracking_attempts_store_created_idx
on public.buyer_tracking_attempts (store_slug, created_at desc);

alter table public.buyer_tracking_attempts enable row level security;
revoke all on public.buyer_tracking_attempts from anon, authenticated;
