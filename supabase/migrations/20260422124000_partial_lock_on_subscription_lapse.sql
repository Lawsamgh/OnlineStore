-- Partial lock when paid subscription lapses:
-- - Owners can still access dashboard and edit drafts/settings.
-- - Block publishing products while lapsed.
-- - Block turning a store active while lapsed (unless it is already active).
-- - Order acceptance remains blocked by checkout/order gates from prior migration.

create or replace function public.can_set_store_active(
  p_store_id uuid,
  p_new_is_active boolean
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_current_is_active boolean;
begin
  -- Turning off is always allowed.
  if coalesce(p_new_is_active, false) = false then
    return true;
  end if;

  -- If the store is subscription-eligible, allowing active=true is fine.
  if public.storefront_access_allowed(p_store_id) then
    return true;
  end if;

  -- If the store was already active, keep allowing non-activation edits.
  select s.is_active
  into v_current_is_active
  from public.stores s
  where s.id = p_store_id
  limit 1;

  return coalesce(v_current_is_active, false);
end;
$$;

drop policy if exists "products_write_owner" on public.products;

create policy "products_write_owner"
on public.products for all
to authenticated
using (
  exists (
    select 1
    from public.stores s
    where s.id = products.store_id
      and s.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.stores s
    where s.id = products.store_id
      and s.owner_id = auth.uid()
  )
  and (
    category_id is null
    or exists (
      select 1
      from public.product_categories pc
      where pc.id = products.category_id
        and pc.store_id = products.store_id
    )
  )
  -- Lapsed paid plans can still save drafts, but cannot publish.
  and (
    products.is_published = false
    or public.storefront_access_allowed(products.store_id)
  )
);

drop policy if exists "stores_update_owner" on public.stores;

create policy "stores_update_owner"
on public.stores for update
to authenticated
using (owner_id = auth.uid())
with check (
  owner_id = auth.uid()
  and public.can_set_store_active(id, is_active)
);
