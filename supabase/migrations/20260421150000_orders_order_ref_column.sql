-- Add a short customer-friendly order reference persisted on `orders`.

create or replace function public.make_order_ref(p_id uuid)
returns text
language sql
immutable
as $$
  select 'ORD-' || substr(replace(upper(p_id::text), '-', ''), 1, 4) || '-' ||
         right(replace(upper(p_id::text), '-', ''), 4)
$$;

alter table public.orders
add column if not exists order_ref text;

create or replace function public.orders_set_order_ref()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.id is null then
    new.id := gen_random_uuid();
  end if;
  if new.order_ref is null or btrim(new.order_ref) = '' then
    new.order_ref := public.make_order_ref(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists orders_set_order_ref on public.orders;
create trigger orders_set_order_ref
before insert on public.orders
for each row
execute procedure public.orders_set_order_ref();

update public.orders o
set order_ref = public.make_order_ref(o.id)
where o.order_ref is null
   or btrim(o.order_ref) = '';

alter table public.orders
alter column order_ref set not null;

create unique index if not exists orders_order_ref_key on public.orders (order_ref);
