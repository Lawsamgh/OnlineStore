-- Seller Verifications admin page listens to postgres_changes on this table
-- (see useRealtimeTableRefresh in SellerVerificationsView.vue).

do $pub$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'seller_verifications'
  ) then
    alter publication supabase_realtime add table public.seller_verifications;
  end if;
end
$pub$;
