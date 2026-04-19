-- Fix Supabase Auth "Database error saving new user" when handle_new_user()
-- inserts into public.admin_roles (domain auto-grant). RLS was enabled with
-- only SELECT policies, so INSERT from the auth signup trigger failed.
--
-- Allow INSERT only for DB roles used by SECURITY DEFINER triggers / auth.
-- Do NOT grant INSERT to "authenticated" (sellers could self-grant admin).

drop policy if exists "admin_roles_insert_postgres" on public.admin_roles;
do $policy$
begin
  if exists (select 1 from pg_roles where rolname = 'postgres') then
    execute $sql$
      create policy "admin_roles_insert_postgres"
      on public.admin_roles
      for insert
      to postgres
      with check (true);
    $sql$;
  end if;
end;
$policy$;

drop policy if exists "admin_roles_insert_supabase_auth_admin" on public.admin_roles;
do $policy$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    execute $sql$
      create policy "admin_roles_insert_supabase_auth_admin"
      on public.admin_roles
      for insert
      to supabase_auth_admin
      with check (true);
    $sql$;
  end if;
end;
$policy$;

drop policy if exists "admin_roles_insert_supabase_admin" on public.admin_roles;
do $policy$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    execute $sql$
      create policy "admin_roles_insert_supabase_admin"
      on public.admin_roles
      for insert
      to supabase_admin
      with check (true);
    $sql$;
  end if;
end;
$policy$;
