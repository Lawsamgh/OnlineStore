-- One-time flag: when set non-null, super-admin "new seller joined" SMS was sent (or legacy row backfilled).
alter table public.profiles
  add column if not exists seller_join_sms_sent_at timestamptz;

-- Existing sellers: do not treat as "new join" when this feature ships.
update public.profiles
set seller_join_sms_sent_at = '1970-01-01T00:00:00Z'::timestamptz
where seller_join_sms_sent_at is null;
