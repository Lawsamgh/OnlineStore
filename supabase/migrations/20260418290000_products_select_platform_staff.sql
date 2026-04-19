-- Platform staff need to read all products for admin console (shop modal, counts).

create policy "products_select_platform_staff"
on public.products for select
to authenticated
using (public.auth_is_platform_staff());
