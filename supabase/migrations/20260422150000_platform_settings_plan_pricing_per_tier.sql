-- Per-tier monthly subscription pricing (pesewas).
-- Enables super admins to control Starter/Growth/Pro fees from platform settings.

insert into public.platform_settings (key, value)
values
  ('seller_subscription_monthly_pesewas_starter', '15000'),
  ('seller_subscription_monthly_pesewas_growth', '35000'),
  ('seller_subscription_monthly_pesewas_pro', '65000')
on conflict (key) do nothing;

drop policy if exists "platform_settings_select_public_seller_pricing" on public.platform_settings;

create policy "platform_settings_select_public_seller_pricing"
on public.platform_settings for select
to anon, authenticated
using (
  key in (
    'seller_subscription_monthly_pesewas_starter',
    'seller_subscription_monthly_pesewas_growth',
    'seller_subscription_monthly_pesewas_pro'
  )
);
