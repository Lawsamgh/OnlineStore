create table if not exists public.sms_notification_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  function_name text not null,
  event_type text not null,
  status text not null check (status in ('sent', 'failed', 'skipped')),
  provider text not null default 'arkesel',
  recipient_phone_e164 text null,
  detail text null,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists sms_notification_logs_created_at_idx
  on public.sms_notification_logs (created_at desc);

create index if not exists sms_notification_logs_status_created_at_idx
  on public.sms_notification_logs (status, created_at desc);

alter table public.sms_notification_logs enable row level security;

drop policy if exists "super_admin_can_read_sms_notification_logs"
  on public.sms_notification_logs;

create policy "super_admin_can_read_sms_notification_logs"
on public.sms_notification_logs
for select
to authenticated
using (
  exists (
    select 1
    from public.admin_roles ar
    where ar.user_id = auth.uid()
      and ar.role = 'super_admin'
  )
);
