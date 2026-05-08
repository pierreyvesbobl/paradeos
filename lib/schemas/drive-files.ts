import { z } from "zod";

/**
 * Sujets métiers auxquels on peut attacher des objets Drive (dossier
 * lié, fichier individuel, …). Conservé même si on n'utilise pour
 * l'instant que les dossiers : la table `drive_files` existe et
 * `drive_folders` réutilise cet enum.
 */
export const driveFileSubjectTypeEnum = z.enum(["entity", "contact", "project", "note", "meeting"]);
export type DriveFileSubjectType = z.infer<typeof driveFileSubjectTypeEnum>;
