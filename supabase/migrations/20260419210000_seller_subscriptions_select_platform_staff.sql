-- Allow platform staff and super admins to read seller subscription billing snapshots for admin overview.

create policy "seller_subscriptions_select_super_admin"
on public.seller_subscriptions for select
to authenticated
using (public.auth_is_super_admin());

create policy "seller_subscriptions_select_platform_staff"
on public.seller_subscriptions for select
to authenticated
using (public.auth_is_platform_staff());
