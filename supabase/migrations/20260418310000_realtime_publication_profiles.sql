-- Broadcast `profiles` row updates (e.g. `last_seen_at` on sign-out / heartbeat) so
-- the admin Console users list refreshes over Supabase Realtime without a full reload.

do $migration$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
end
$migration$;
