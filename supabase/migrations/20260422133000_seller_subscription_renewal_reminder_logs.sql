-- Dedupe table for seller subscription renewal reminders.
-- Ensures we send at most one reminder per subscription per reminder day.

create table if not exists public.seller_subscription_renewal_reminder_logs (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.seller_subscriptions (id) on delete cascade,
  reminder_type text not null check (reminder_type in ('before_7_days')),
  remind_for_date date not null,
  created_at timestamptz not null default now(),
  unique (subscription_id, reminder_type, remind_for_date)
);

create index if not exists seller_subscription_renewal_reminder_logs_subscription_idx
  on public.seller_subscription_renewal_reminder_logs (subscription_id);

alter table public.seller_subscription_renewal_reminder_logs enable row level security;

-- Service-role only workflow; no anon/authenticated client access.
revoke all on public.seller_subscription_renewal_reminder_logs from anon, authenticated;
