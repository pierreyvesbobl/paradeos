-- Lien source Drive pour idempotence : un fichier Drive donné ne peut
-- être ingéré qu'une fois (évite la double-création quand le cron
-- relit la même liste). On stocke aussi `modifiedTime` pour pouvoir
-- détecter une mise à jour du fichier (extension future).
alter table public.meetings
  add column if not exists source_drive_file_id text,
  add column if not exists source_drive_file_modified_at timestamptz;

create unique index if not exists meetings_source_drive_file_unique
  on public.meetings (source_drive_file_id)
  where source_drive_file_id is not null;
