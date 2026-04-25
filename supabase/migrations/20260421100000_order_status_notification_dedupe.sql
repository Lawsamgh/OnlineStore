-- Dedupe ledger for customer notifications triggered by seller order-status updates.
-- Prevents duplicate sends for the same (order_id, status) combination.

create table if not exists public.order_status_notifications (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  status public.order_status not null,
  channel text not null default 'email',
  created_at timestamptz not null default now(),
  unique (order_id, status, channel)
);

create index if not exists order_status_notifications_order_id_idx
on public.order_status_notifications (order_id);
