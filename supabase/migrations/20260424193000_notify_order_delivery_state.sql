-- Idempotent delivery ledger for "new order" notifications.
-- Prevents replaying notify-order with a stable notify_token.

create table if not exists public.order_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders (id) on delete cascade,
  seller_email_state text not null default 'pending'
    check (seller_email_state in ('pending', 'sending', 'sent', 'failed')),
  buyer_email_state text not null default 'pending'
    check (buyer_email_state in ('pending', 'sending', 'sent', 'failed')),
  seller_sms_state text not null default 'pending'
    check (seller_sms_state in ('pending', 'sending', 'sent', 'failed')),
  buyer_sms_state text not null default 'pending'
    check (buyer_sms_state in ('pending', 'sending', 'sent', 'failed')),
  seller_email_attempts integer not null default 0 check (seller_email_attempts >= 0),
  buyer_email_attempts integer not null default 0 check (buyer_email_attempts >= 0),
  seller_sms_attempts integer not null default 0 check (seller_sms_attempts >= 0),
  buyer_sms_attempts integer not null default 0 check (buyer_sms_attempts >= 0),
  seller_email_last_error text,
  buyer_email_last_error text,
  seller_sms_last_error text,
  buyer_sms_last_error text,
  seller_email_sent_at timestamptz,
  buyer_email_sent_at timestamptz,
  seller_sms_sent_at timestamptz,
  buyer_sms_sent_at timestamptz,
  last_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger order_notification_deliveries_set_updated_at
before update on public.order_notification_deliveries
for each row execute procedure public.set_updated_at();

alter table public.order_notification_deliveries enable row level security;
revoke all on public.order_notification_deliveries from anon, authenticated;
