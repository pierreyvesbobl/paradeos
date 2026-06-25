-- =============================================================================
-- Meetings : support de l'import audio + transcription Whisper.
--
-- 1. Relâche la contrainte NOT NULL sur `transcript` (on peut créer une
--    réunion avant que la transcription ait abouti).
-- 2. Ajoute les colonnes `audio_*` (métadonnées du fichier source) et
--    `transcription_*` (état du pipeline).
-- 3. Crée le bucket Storage privé `meeting-audio` + policies miroir
--    du bucket `note-attachments` (cf. 0011_note_attachments.sql).
-- =============================================================================

-- ---- Colonnes meetings ----------------------------------------------------
alter table public.meetings
  alter column transcript drop not null;

do $$ begin
  create type meeting_transcription_status as enum ('idle', 'running', 'done', 'error');
exception when duplicate_object then null; end $$;

alter table public.meetings
  add column if not exists audio_storage_path     text,
  add column if not exists audio_file_name        text,
  add column if not exists audio_mime_type        text,
  add column if not exists audio_size_bytes       integer,
  add column if not exists transcription_status   meeting_transcription_status not null default 'idle',
  add column if not exists transcription_error    text,
  add column if not exists transcription_provider text;

-- ---- Bucket Storage --------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('meeting-audio', 'meeting-audio', false)
on conflict (id) do nothing;

drop policy if exists meeting_audio_storage_select on storage.objects;
create policy meeting_audio_storage_select
  on storage.objects
  for select
  using (bucket_id = 'meeting-audio');

drop policy if exists meeting_audio_storage_insert on storage.objects;
create policy meeting_audio_storage_insert
  on storage.objects
  for insert
  with check (bucket_id = 'meeting-audio');

drop policy if exists meeting_audio_storage_delete on storage.objects;
create policy meeting_audio_storage_delete
  on storage.objects
  for delete
  using (bucket_id = 'meeting-audio');
