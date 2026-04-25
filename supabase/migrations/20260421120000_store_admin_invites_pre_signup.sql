-- Allow owners to invite teammate emails before signup, then auto-claim on signup.

create table if not exists public.store_admin_invites (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  email text not null,
  invited_by uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  accepted_by uuid references public.profiles (id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint store_admin_invites_store_email_unique unique (store_id, email)
);

create index if not exists store_admin_invites_email_idx
on public.store_admin_invites (lower(email));

alter table public.store_admin_invites enable row level security;

create policy "store_admin_invites_select_owner_staff_invitee"
on public.store_admin_invites for select
to authenticated
using (
  public.auth_is_platform_staff()
  or invited_by = auth.uid()
  or exists (
    select 1
    from public.stores s
    where s.id = store_admin_invites.store_id
      and s.owner_id = auth.uid()
  )
  or lower(store_admin_invites.email) = lower(coalesce((auth.jwt() ->> 'email'), ''))
);

create policy "store_admin_invites_insert_owner_staff"
on public.store_admin_invites for insert
to authenticated
with check (
  public.auth_is_platform_staff()
  or exists (
    select 1
    from public.stores s
    where s.id = store_admin_invites.store_id
      and s.owner_id = auth.uid()
  )
);

create policy "store_admin_invites_update_owner_staff"
on public.store_admin_invites for update
to authenticated
using (
  public.auth_is_platform_staff()
  or exists (
    select 1
    from public.stores s
    where s.id = store_admin_invites.store_id
      and s.owner_id = auth.uid()
  )
)
with check (
  public.auth_is_platform_staff()
  or exists (
    select 1
    from public.stores s
    where s.id = store_admin_invites.store_id
      and s.owner_id = auth.uid()
  )
);

create or replace function public.invite_store_admin_email(
  p_store_id uuid,
  p_email text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_email text;
begin
  select s.owner_id into v_owner_id
  from public.stores s
  where s.id = p_store_id;

  if v_owner_id is null then
    raise exception 'store not found';
  end if;

  if not (public.auth_is_platform_staff() or v_owner_id = auth.uid()) then
    raise exception 'only the store owner can invite admins';
  end if;

  v_email := lower(trim(coalesce(p_email, '')));
  if v_email = '' or position('@' in v_email) <= 1 then
    raise exception 'invalid email';
  end if;

  insert into public.store_admin_invites (store_id, email, invited_by, status)
  values (p_store_id, v_email, auth.uid(), 'pending')
  on conflict (store_id, email)
  do update
    set invited_by = excluded.invited_by,
        status = 'pending',
        accepted_by = null,
        accepted_at = null,
        created_at = now();
end;
$$;

revoke all on function public.invite_store_admin_email(uuid, text) from public;
grant execute on function public.invite_store_admin_email(uuid, text) to authenticated;

create or replace function public.claim_store_admin_invites_for_user(
  p_user_id uuid,
  p_email text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_count integer := 0;
begin
  if p_user_id is null or v_email = '' then
    return 0;
  end if;

  with pending as (
    select i.id, i.store_id
    from public.store_admin_invites i
    where i.status = 'pending'
      and lower(i.email) = v_email
  ),
  inserted as (
    insert into public.store_admins (store_id, user_id)
    select p.store_id, p_user_id
    from pending p
    join public.stores s on s.id = p.store_id
    where p_user_id <> s.owner_id
    on conflict (store_id, user_id) do nothing
    returning store_id
  ),
  marked as (
    update public.store_admin_invites i
    set status = 'accepted',
        accepted_by = p_user_id,
        accepted_at = now()
    where i.id in (select id from pending)
    returning 1
  )
  select count(*) into v_count from marked;

  return v_count;
end;
$$;

revoke all on function public.claim_store_admin_invites_for_user(uuid, text) from public;
grant execute on function public.claim_store_admin_invites_for_user(uuid, text) to authenticated;

create or replace function public.on_auth_user_claim_store_admin_invites()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.claim_store_admin_invites_for_user(new.id, new.email);
  return new;
end;
$$;

drop trigger if exists on_auth_user_claim_store_admin_invites on auth.users;
create trigger on_auth_user_claim_store_admin_invites
after insert on auth.users
for each row
execute procedure public.on_auth_user_claim_store_admin_invites();

drop trigger if exists on_auth_user_email_updated_claim_store_admin_invites on auth.users;
create trigger on_auth_user_email_updated_claim_store_admin_invites
after update of email on auth.users
for each row
when (new.email is distinct from old.email)
execute procedure public.on_auth_user_claim_store_admin_invites();
