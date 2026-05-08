import { z } from "zod";
import { driveFileSubjectTypeEnum } from "./drive-files";

export const linkDriveFolderSchema = z.object({
  subjectType: driveFileSubjectTypeEnum,
  subjectId: z.string().uuid(),
  folderId: z.string().min(1).max(200),
  folderName: z.string().min(1).max(500),
  folderUrl: z.string().url().nullable().optional(),
});

export const createDriveFolderSchema = z.object({
  subjectType: driveFileSubjectTypeEnum,
  subjectId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
});

export const unlinkDriveFolderSchema = z.object({
  subjectType: driveFileSubjectTypeEnum,
  subjectId: z.string().uuid(),
});
