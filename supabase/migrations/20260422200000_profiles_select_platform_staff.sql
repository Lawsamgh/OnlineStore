-- Allow platform staff (super-admins / admins) to read all profiles
-- so that the seller verifications review page can display seller names.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'profiles'
      and policyname = 'profiles_select_platform_staff'
  ) then
    execute $policy$
      create policy "profiles_select_platform_staff"
      on public.profiles for select
      to authenticated
      using (public.auth_is_platform_staff())
    $policy$;
  end if;
end;
$$;
