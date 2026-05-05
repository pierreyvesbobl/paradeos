-- =============================================================================
-- Bucket Storage public `avatars` pour les photos de profil utilisateur.
-- Public en lecture (URL stable, pas de signed URL nécessaire).
-- Lecture/insert/delete autorisé à tout user authentifié — la sécurité
-- métier est appliquée côté action (le path est préfixé par user.id).
-- Limite 5 MB / fichier.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  5242880, -- 5 MB
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists avatars_select on storage.objects;
create policy avatars_select
  on storage.objects
  for select
  using (bucket_id = 'avatars');

drop policy if exists avatars_insert on storage.objects;
create policy avatars_insert
  on storage.objects
  for insert
  with check (bucket_id = 'avatars');

drop policy if exists avatars_update on storage.objects;
create policy avatars_update
  on storage.objects
  for update
  using (bucket_id = 'avatars')
  with check (bucket_id = 'avatars');

drop policy if exists avatars_delete on storage.objects;
create policy avatars_delete
  on storage.objects
  for delete
  using (bucket_id = 'avatars');
