-- Activity ping for “who is using the app” (dashboard shell). Updated by the client;
-- platform staff can read all rows for the Console users list.

alter table public.profiles
  add column if not exists last_seen_at timestamptz;

create index if not exists profiles_last_seen_at_idx
  on public.profiles (last_seen_at desc)
  where last_seen_at is not null;

comment on column public.profiles.last_seen_at is
  'Best-effort “last active in dashboard/console shell” timestamp (client heartbeat). On sign-out the client sets this to 1970-01-01 UTC so peers show offline immediately via Realtime.';
