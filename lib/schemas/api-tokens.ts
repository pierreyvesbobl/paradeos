import { z } from "zod";

export const createApiTokenSchema = z.object({
  label: z.string().trim().min(1).max(80),
});

export const revokeApiTokenSchema = z.object({
  id: z.string().uuid(),
});
