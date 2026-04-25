-- Allow reminder logs to support configurable "N days before end" workflows.

alter table public.seller_subscription_renewal_reminder_logs
  drop constraint if exists seller_subscription_renewal_reminder_logs_reminder_type_check;

alter table public.seller_subscription_renewal_reminder_logs
  add constraint seller_subscription_renewal_reminder_logs_reminder_type_check
  check (reminder_type in ('before_period_end'));

