-- Allow platform staff (super-admins / admins) to update any profile row.
-- Required so that approve/reject in SellerVerificationsView can write
-- seller_verification_status, seller_verification_reject_reason, etc.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'profiles'
      and policyname = 'profiles_update_platform_staff'
  ) then
    execute $policy$
      create policy "profiles_update_platform_staff"
      on public.profiles for update
      to authenticated
      using  (public.auth_is_platform_staff())
      with check (public.auth_is_platform_staff())
    $policy$;
  end if;
end;
$$;
