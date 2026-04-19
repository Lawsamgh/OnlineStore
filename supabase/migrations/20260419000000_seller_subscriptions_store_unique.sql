-- One subscription row per store (upsert from paystack-verify-store-subscription).
drop index if exists public.seller_subscriptions_store_id_idx;

alter table public.seller_subscriptions
  add constraint seller_subscriptions_store_id_key unique (store_id);
