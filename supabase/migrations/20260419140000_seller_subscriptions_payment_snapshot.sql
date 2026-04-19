-- Last successful charge snapshot from Paystack verify (GHS: pesewas per Paystack API).
alter table public.seller_subscriptions
  add column if not exists paid_amount_pesewas integer;

alter table public.seller_subscriptions
  add column if not exists payment_channel text;

alter table public.seller_subscriptions
  add column if not exists paystack_fee_pesewas integer;

comment on column public.seller_subscriptions.paid_amount_pesewas is
  'Amount from Paystack transaction verify (smallest currency unit, e.g. pesewas for GHS).';

comment on column public.seller_subscriptions.payment_channel is
  'Paystack payment channel, e.g. card, mobile_money, bank, ussd.';

comment on column public.seller_subscriptions.paystack_fee_pesewas is
  'Paystack fees field from verify response (smallest currency unit).';
