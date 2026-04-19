-- Paid tier chosen at store Paystack checkout (starter | growth | pro).
alter table public.seller_subscriptions
  add column if not exists pricing_plan_id text;

alter table public.seller_subscriptions
  drop constraint if exists seller_subscriptions_pricing_plan_id_check;

alter table public.seller_subscriptions
  add constraint seller_subscriptions_pricing_plan_id_check
  check (
    pricing_plan_id is null
    or pricing_plan_id in ('starter', 'growth', 'pro')
  );
