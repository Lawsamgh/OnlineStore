-- Secure notify token for Edge Functions to verify order placement callbacks
-- Auto-create delivery_tracking row for Realtime subscriptions

alter table public.orders
  add column if not exists notify_token uuid not null default gen_random_uuid();

create unique index if not exists orders_notify_token_uidx on public.orders (notify_token);

create or replace function public.ensure_delivery_tracking_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.delivery_tracking (order_id)
  values (new.id)
  on conflict (order_id) do nothing;
  return new;
end;
$$;

drop trigger if exists orders_create_delivery_tracking on public.orders;

create trigger orders_create_delivery_tracking
after insert on public.orders
for each row execute procedure public.ensure_delivery_tracking_row();
