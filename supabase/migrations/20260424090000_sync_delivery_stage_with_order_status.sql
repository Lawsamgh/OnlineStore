-- Keep buyer-facing delivery route in sync with seller order status updates.

create or replace function public.delivery_stage_from_order_status(
  p_status public.order_status
)
returns public.delivery_stage
language sql
immutable
as $$
  select case p_status
    when 'out_for_delivery' then 'in_transit'::public.delivery_stage
    when 'delivered' then 'delivered'::public.delivery_stage
    else 'pending'::public.delivery_stage
  end;
$$;

create or replace function public.sync_delivery_tracking_stage_from_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.delivery_tracking (order_id, stage)
  values (new.id, public.delivery_stage_from_order_status(new.status))
  on conflict (order_id)
  do update
    set stage = excluded.stage,
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists orders_sync_delivery_stage on public.orders;

create trigger orders_sync_delivery_stage
after insert or update of status on public.orders
for each row
execute procedure public.sync_delivery_tracking_stage_from_order();
