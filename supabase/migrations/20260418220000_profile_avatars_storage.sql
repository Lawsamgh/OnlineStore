-- Public profile photos: path convention `{user_id}/avatar.{ext}` in `profile-avatars`.

insert into storage.buckets (id, name, public)
select 'profile-avatars', 'profile-avatars', true
where not exists (select 1 from storage.buckets where id = 'profile-avatars');

create policy "profile_avatars_public_read"
on storage.objects for select
using (bucket_id = 'profile-avatars');

create policy "profile_avatars_owner_insert"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'profile-avatars'
  and (storage.foldername (name))[1] = auth.uid()::text
);

create policy "profile_avatars_owner_update"
on storage.objects for update
to authenticated
using (
  bucket_id = 'profile-avatars'
  and (storage.foldername (name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'profile-avatars'
  and (storage.foldername (name))[1] = auth.uid()::text
);

create policy "profile_avatars_owner_delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'profile-avatars'
  and (storage.foldername (name))[1] = auth.uid()::text
);
