import { describe, expect, it } from "vitest";
import { withLlmTimeout } from "./timeout";

const opts = { budgetMs: 20, modelId: "vendor/modele-lent", label: "l'extraction de la réunion" };

describe("withLlmTimeout", () => {
  it("rend la valeur quand l'appel aboutit", async () => {
    await expect(withLlmTimeout(opts, async () => "ok")).resolves.toBe("ok");
  });

  it("laisse passer les erreurs qui ne sont pas des abandons", async () => {
    await expect(
      withLlmTimeout(opts, async () => {
        throw new Error("Clé OpenRouter invalide.");
      }),
    ).rejects.toThrow("Clé OpenRouter invalide.");
  });

  it("traduit l'abandon en message nommant le modèle et la sortie", async () => {
    const run = (signal: AbortSignal) =>
      new Promise<never>((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason));
      });

    await expect(withLlmTimeout(opts, run)).rejects.toThrow(/vendor\/modele-lent/);
    await expect(withLlmTimeout(opts, run)).rejects.toThrow(/Réglages → Intégrations/);
  });

  it("coupe bien au budget : l'appel plus lent que le budget n'est pas attendu", async () => {
    const started = Date.now();
    await expect(
      withLlmTimeout(
        { ...opts, budgetMs: 30 },
        (signal) =>
          new Promise<never>((_, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason));
          }),
      ),
    ).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
