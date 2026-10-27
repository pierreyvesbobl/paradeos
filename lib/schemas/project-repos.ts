import { z } from "zod";

export const addProjectRepoSchema = z.object({
  projectId: z.string().uuid(),
  /** URL telle que `git remote -v` l'affiche, ou déjà normalisée. */
  remote: z.string().trim().min(3).max(500),
});

export const removeProjectRepoSchema = z.object({
  id: z.string().uuid(),
});

export const setProjectRepoSyncSchema = z.object({
  id: z.string().uuid(),
  syncIssues: z.boolean(),
});

export type AddProjectRepoInput = z.infer<typeof addProjectRepoSchema>;
