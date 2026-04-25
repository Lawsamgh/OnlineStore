-- Prevent teammate signup failures from invite-claim timing on auth/profile triggers.

-- Keep invite audit resilient even if `profiles` row does not exist yet.
alter table public.store_admin_invites
  drop constraint if exists store_admin_invites_accepted_by_fkey;

alter table public.store_admin_invites
  add constraint store_admin_invites_accepted_by_fkey
  foreign key (accepted_by) references auth.users (id) on delete set null;

create or replace function public.on_auth_user_claim_store_admin_invites()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Never block signup if invite-claim hits timing/relationship issues.
  begin
    perform public.claim_store_admin_invites_for_user(new.id, new.email);
  exception when others then
    null;
  end;
  return new;
end;
$$;

create or replace function public.on_profile_created_claim_store_admin_invites()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  select u.email into v_email
  from auth.users u
  where u.id = new.id;

  if v_email is null or trim(v_email) = '' then
    return new;
  end if;

  perform public.claim_store_admin_invites_for_user(new.id, v_email);
  return new;
end;
$$;

drop trigger if exists on_profile_created_claim_store_admin_invites on public.profiles;
create trigger on_profile_created_claim_store_admin_invites
after insert on public.profiles
for each row
execute procedure public.on_profile_created_claim_store_admin_invites();
