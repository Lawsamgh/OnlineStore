-- Seller dashboard subscribes to postgres_changes on `announcements` (see
-- useRealtimeTableRefresh in DashboardHome); table must be in supabase_realtime.

do $pub$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'announcements'
  ) then
    alter publication supabase_realtime add table public.announcements;
  end if;
end
$pub$;
