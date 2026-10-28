import { z } from "zod";

export const decideRoadmapLinkSchema = z.object({
  id: z.string().uuid(),
  decision: z.enum(["confirm", "reject"]),
});

export const linkTaskToRoadmapItemSchema = z.object({
  taskId: z.string().uuid(),
  remote: z.string().min(3),
  itemId: z.string().trim().min(1).max(40),
});

export const unlinkRoadmapTaskSchema = z.object({
  taskId: z.string().uuid(),
});

export const syncProjectRoadmapsSchema = z.object({
  projectId: z.string().uuid(),
});

export const setProjectRepoRoadmapPathSchema = z.object({
  id: z.string().uuid(),
  /** Vide = plus de feuille de route suivie sur ce dépôt. */
  roadmapPath: z.string().trim().max(300),
});
