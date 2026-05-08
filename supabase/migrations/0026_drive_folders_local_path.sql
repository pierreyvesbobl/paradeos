-- Stocker séparément le chemin local Google Drive Desktop (qui peut
-- passer par .shortcut-targets-by-id/<id>/... pour les dossiers
-- accédés via raccourci) du chemin "humain" affiché à l'user.
--
-- folder_path        = chemin lisible (My Drive/Foo/Bar ou
--                      Raccourci → <name>/Foo/Bar)
-- folder_local_path  = chemin Drive Desktop sous
--                      ~/Library/CloudStorage/GoogleDrive-<email>/
alter table public.drive_folders
  add column if not exists folder_local_path text;
