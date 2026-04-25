-- Enforce allowed order status transitions at the database layer.

create or replace function public.order_status_can_transition(
  p_from public.order_status,
  p_to public.order_status
)
returns boolean
language sql
immutable
as $$
  select case
    when p_from = p_to then true
    when p_from = 'pending' and p_to in ('confirmed', 'canceled') then true
    when p_from = 'confirmed' and p_to in ('preparing', 'canceled') then true
    when p_from = 'preparing' and p_to in ('out_for_delivery', 'canceled') then true
    when p_from = 'out_for_delivery' and p_to in ('delivered', 'canceled') then true
    else false
  end;
$$;

create or replace function public.enforce_order_status_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and new.status is distinct from old.status
     and not public.order_status_can_transition(old.status, new.status)
  then
    raise exception
      'Invalid order status transition: % -> %',
      old.status,
      new.status;
  end if;
  return new;
end;
$$;

drop trigger if exists orders_enforce_status_transition on public.orders;

create trigger orders_enforce_status_transition
before update of status on public.orders
for each row
execute procedure public.enforce_order_status_transition();
