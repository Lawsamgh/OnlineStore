-- Reliable per-channel delivery state for order-status notifications.
-- Prevents "marked sent before actual send" and allows safe retries.

create table if not exists public.order_status_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  status public.order_status not null,
  email_state text not null default 'pending'
    check (email_state in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  sms_state text not null default 'pending'
    check (sms_state in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  email_attempts integer not null default 0 check (email_attempts >= 0),
  sms_attempts integer not null default 0 check (sms_attempts >= 0),
  email_last_error text,
  sms_last_error text,
  email_sent_at timestamptz,
  sms_sent_at timestamptz,
  last_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, status)
);

create index if not exists order_status_notification_deliveries_order_id_idx
on public.order_status_notification_deliveries (order_id);

create trigger order_status_notification_deliveries_set_updated_at
before update on public.order_status_notification_deliveries
for each row execute procedure public.set_updated_at();
