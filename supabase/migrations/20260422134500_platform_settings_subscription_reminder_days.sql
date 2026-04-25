-- Configurable reminder lead time for seller subscription expiry emails.
-- Used by function: notify-seller-subscription-renewal

insert into public.platform_settings (key, value)
values ('seller_subscription_renewal_reminder_days', '7')
on conflict (key) do nothing;

