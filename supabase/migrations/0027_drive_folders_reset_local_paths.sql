-- Invalide les `folder_local_path` cachés : la convention a changé
-- (.shortcut-targets-by-id utilise l'ID du dossier cible et non du
-- fichier raccourci). Le composant DriveFolderSection recalcule au
-- prochain rendu via resolveFolderPath et persiste les bons chemins.
--
-- Coût négligeable : 1-3 appels API Drive par dossier au prochain accès.
update public.drive_folders set folder_local_path = null;
