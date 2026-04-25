-- Strict seller verification workflow:
-- - seller submits identity package
-- - profile/store remains pending until super admin approves
-- - super admin can reject with reason and seller can resubmit

alter table public.profiles
add column if not exists seller_verification_status text not null default 'not_submitted'
  check (seller_verification_status in ('not_submitted', 'pending', 'approved', 'rejected')),
add column if not exists seller_verification_reject_reason text,
add column if not exists seller_verification_reviewed_at timestamptz,
add column if not exists seller_verification_reviewed_by uuid references public.profiles (id) on delete set null;

alter table public.stores
add column if not exists verification_status text not null default 'not_submitted'
  check (verification_status in ('not_submitted', 'pending', 'approved', 'rejected')),
add column if not exists verification_reject_reason text,
add column if not exists verification_reviewed_at timestamptz,
add column if not exists verification_reviewed_by uuid references public.profiles (id) on delete set null;

create table if not exists public.seller_verifications (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null unique references public.profiles (id) on delete cascade,
  store_id uuid references public.stores (id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  contact_phone_e164 text,
  full_legal_name text not null,
  ghana_card_number text not null
    check (ghana_card_number ~ '^GHA-[0-9]{9}-[0-9]$'),
  card_front_path text not null,
  card_back_path text not null,
  selfie_with_card_path text not null,
  reject_reason text,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles (id) on delete set null,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger seller_verifications_set_updated_at
before update on public.seller_verifications
for each row execute procedure public.set_updated_at();

alter table public.seller_verifications enable row level security;

create policy "seller_verifications_select_owner_or_staff"
on public.seller_verifications for select
to authenticated
using (
  seller_id = auth.uid()
  or public.auth_is_platform_staff()
);

create policy "seller_verifications_insert_owner"
on public.seller_verifications for insert
to authenticated
with check (seller_id = auth.uid());

create policy "seller_verifications_update_owner_or_super_admin"
on public.seller_verifications for update
to authenticated
using (seller_id = auth.uid() or public.auth_is_super_admin())
with check (seller_id = auth.uid() or public.auth_is_super_admin());

insert into storage.buckets (id, name, public)
select 'seller-verification-docs', 'seller-verification-docs', false
where not exists (
  select 1 from storage.buckets where id = 'seller-verification-docs'
);

create policy "seller_verification_docs_select_owner_or_staff"
on storage.objects for select
to authenticated
using (
  bucket_id = 'seller-verification-docs'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.auth_is_platform_staff()
  )
);

create policy "seller_verification_docs_insert_owner"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'seller-verification-docs'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "seller_verification_docs_update_owner"
on storage.objects for update
to authenticated
using (
  bucket_id = 'seller-verification-docs'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'seller-verification-docs'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "seller_verification_docs_delete_owner"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'seller-verification-docs'
  and (storage.foldername(name))[1] = auth.uid()::text
);
