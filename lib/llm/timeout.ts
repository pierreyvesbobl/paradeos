/**
 * Budget d'un appel LLM, par usage. Ces valeurs vivent sous la limite
 * d'exécution Vercel (`maxDuration = 300` sur les routes et pages qui
 * hébergent ces appels) : on veut abandonner nous-mêmes, avec un message
 * lisible, plutôt que se faire tuer par la plateforme sans rien rendre.
 *
 * Un transcript de réunion (30 à 70k caractères) demande nettement plus
 * qu'un email : d'où les deux budgets.
 */
export const LLM_BUDGET_MS = {
  meetingExtraction: 240_000,
  emailExtraction: 120_000,
  invoiceExtraction: 120_000,
} as const;

/**
 * `AbortSignal.timeout()` rejette avec un `TimeoutError`. Selon le
 * chemin (fetch annulé, wrapper du SDK), on peut recevoir l'AbortError
 * correspondant — on reconnaît les deux.
 */
function isTimeoutError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: string }).name;
  if (name === "TimeoutError" || name === "AbortError") return true;
  const message = (err as { message?: string }).message ?? "";
  return /aborted due to timeout|operation was aborted/i.test(message);
}

/**
 * Exécute un appel LLM sous budget de temps et traduit l'abandon en
 * message actionnable. Sans ça, l'utilisateur reçoit « The operation was
 * aborted due to timeout » — vrai, mais il ne sait ni quel modèle a
 * calé, ni quoi faire.
 */
export async function withLlmTimeout<T>(
  {
    budgetMs,
    modelId,
    label,
  }: {
    budgetMs: number;
    modelId: string;
    /** Ce qu'on attendait du modèle, au singulier : « le résumé de la réunion ». */
    label: string;
  },
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    return await run(AbortSignal.timeout(budgetMs));
  } catch (err) {
    if (!isTimeoutError(err)) throw err;
    const spent = Math.round((Date.now() - startedAt) / 1000);
    throw new Error(
      `Le modèle ${modelId} n'a pas rendu ${label} dans le temps imparti ` +
        `(abandon après ${spent} s). Relance l'extraction, ou choisis un modèle ` +
        "plus rapide dans Réglages → Intégrations.",
    );
  }
}
