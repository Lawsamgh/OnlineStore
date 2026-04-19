-- Public marketing price for seller subscription (pesewas, same unit as Paystack amount).
-- Super admins can change the row in Platform settings; anon/authenticated may read this key only.

insert into public.platform_settings (key, value)
values ('seller_subscription_monthly_pesewas', '10000')
on conflict (key) do nothing;

create policy "platform_settings_select_public_seller_pricing"
on public.platform_settings for select
to anon, authenticated
using (key = 'seller_subscription_monthly_pesewas');
