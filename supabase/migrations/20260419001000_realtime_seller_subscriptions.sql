-- Refresh store manage UI when subscription row changes.
do $migration$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'seller_subscriptions'
  ) then
    alter publication supabase_realtime add table public.seller_subscriptions;
  end if;
end
$migration$;
