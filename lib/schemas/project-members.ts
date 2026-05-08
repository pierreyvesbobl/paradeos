import { z } from "zod";

export const addProjectMemberSchema = z.object({
  projectId: z.string().uuid(),
  userId: z.string().uuid(),
});

export const removeProjectMemberSchema = addProjectMemberSchema;

export const addProjectContactSchema = z.object({
  projectId: z.string().uuid(),
  contactId: z.string().uuid(),
});

export const removeProjectContactSchema = addProjectContactSchema;
