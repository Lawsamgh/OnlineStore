-- Allow super admins to pause/activate seller storefronts.

create policy "stores_update_super_admin"
on public.stores for update
to authenticated
using (public.auth_is_super_admin())
with check (public.auth_is_super_admin());
