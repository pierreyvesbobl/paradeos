-- =============================================================================
-- Pièces jointes des notes — table métadonnées + bucket Storage privé.
--
-- Le bucket `note-attachments` est privé : les fichiers sont accessibles
-- uniquement via signed URL générée côté serveur (cf.
-- `lib/actions/note-attachments.ts`).
-- =============================================================================

-- ---- Bucket Storage --------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('note-attachments', 'note-attachments', false)
on conflict (id) do nothing;

-- Lecture autorisée à tout user authentifié (la signed URL est générée
-- côté serveur via service_role de toute façon, mais on permet aussi
-- au client de lire via clé anon + auth si jamais on veut bypasser).
drop policy if exists note_attachments_storage_select on storage.objects;
create policy note_attachments_storage_select
  on storage.objects
  for select
  using (bucket_id = 'note-attachments');

drop policy if exists note_attachments_storage_insert on storage.objects;
create policy note_attachments_storage_insert
  on storage.objects
  for insert
  with check (bucket_id = 'note-attachments');

drop policy if exists note_attachments_storage_delete on storage.objects;
create policy note_attachments_storage_delete
  on storage.objects
  for delete
  using (bucket_id = 'note-attachments');

-- ---- RLS sur la table métadonnées -----------------------------------------
drop trigger if exists audit_log_note_attachments on public.note_attachments;
create trigger audit_log_note_attachments
  after insert or update or delete on public.note_attachments
  for each row execute function public.audit_log_trigger();

alter table public.note_attachments enable row level security;

drop policy if exists note_attachments_authenticated_select on public.note_attachments;
create policy note_attachments_authenticated_select
  on public.note_attachments
  for select
  using (true);

drop policy if exists note_attachments_authenticated_insert on public.note_attachments;
create policy note_attachments_authenticated_insert
  on public.note_attachments
  for insert
  with check (true);

drop policy if exists note_attachments_authenticated_delete on public.note_attachments;
create policy note_attachments_authenticated_delete
  on public.note_attachments
  for delete
  using (true);
