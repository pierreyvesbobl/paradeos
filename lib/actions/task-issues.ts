"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { action } from "@/lib/actions/action";
import { projectTaskToIssue } from "@/lib/github/project-issue";

/** Crée ou met à jour l'issue GitHub d'une tâche, à la demande depuis la fiche. */
export const projectTaskIssue = action(z.object({ id: z.string().uuid() }), async ({ input }) => {
  const result = await projectTaskToIssue(input.id);
  if (result.status === "error") throw new Error(result.message);
  if (result.status === "skipped") {
    const why: Record<typeof result.reason, string> = {
      not_feature: "Seule une tâche de type « Fonctionnalité » devient une issue.",
      no_repo: "Aucun dépôt GitHub du projet n'a la projection en issues activée.",
      no_token: "Aucun jeton GitHub enregistré dans les réglages.",
      task_missing: "Tâche introuvable.",
    };
    throw new Error(why[result.reason]);
  }
  revalidatePath(`/taches/${input.id}`);
  return result;
});
