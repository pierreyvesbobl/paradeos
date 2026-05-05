import { z } from "zod";

export const updateOpenAiKeySchema = z.object({
  apiKey: z
    .string()
    .trim()
    .max(300, "Clé trop longue.")
    .refine(
      (v) => v === "" || /^sk-[A-Za-z0-9_-]{20,}$/.test(v),
      "Format attendu : commence par `sk-`.",
    ),
});

export type UpdateOpenAiKeyInput = z.infer<typeof updateOpenAiKeySchema>;
