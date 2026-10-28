import { z } from "zod";

export const decideCommitLinkSchema = z.object({
  id: z.string().uuid(),
  decision: z.enum(["confirm", "reject"]),
});

export const linkTaskToCommitSchema = z.object({
  taskId: z.string().uuid(),
  remote: z.string().min(3),
  sha: z.string().trim().min(7).max(64),
});

export const unlinkTaskFromCommitSchema = linkTaskToCommitSchema;

export const syncProjectCommitsSchema = z.object({
  projectId: z.string().uuid(),
});
