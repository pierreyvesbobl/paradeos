import { describe, expect, it } from "vitest";
import { requiresAction } from "./action-required";

describe("requiresAction", () => {
  it("reconnaît un paiement en échec, une pièce à signer, un compte à confirmer", () => {
    expect(requiresAction({ subject: "Votre paiement a échoué" })).toBe(true);
    expect(requiresAction({ subject: "Payment failed for invoice #1234" })).toBe(true);
    expect(requiresAction({ subject: "Action requise : confirmez votre adresse e-mail" })).toBe(
      true,
    );
    expect(requiresAction({ subject: "Document à signer : Contrat Parade" })).toBe(true);
    expect(requiresAction({ subject: "Votre domaine automato.tech expire dans 7 jours" })).toBe(
      true,
    );
    expect(requiresAction({ subject: "Facture impayée : relance" })).toBe(true);
    expect(requiresAction({ subject: "Your project has been suspended" })).toBe(true);
    expect(requiresAction({ subject: "Please verify your account" })).toBe(true);
    expect(requiresAction({ subject: "[Dernier rappel] Déclaration à compléter" })).toBe(true);
    expect(
      requiresAction({
        subject: "Approaching your limits: Upgrade now to avoid service disruption",
      }),
    ).toBe(true);
    expect(
      requiresAction({
        subject: "[Action requise] Marquez les clients OAuth des agents IA comme agentiques",
      }),
    ).toBe(true);
  });

  it("laisse passer les reçus, rapports et notifications informatives", () => {
    expect(requiresAction({ subject: "Votre reçu Stripe" })).toBe(false);
    expect(requiresAction({ subject: "Your invoice is available" })).toBe(false);
    expect(requiresAction({ subject: "Rapport hebdomadaire Search Console" })).toBe(false);
    expect(requiresAction({ subject: "Deployment succeeded: paradeos" })).toBe(false);
    expect(requiresAction({ subject: 'Enregistrements de réunion : "Amaury x PY"' })).toBe(false);
    expect(requiresAction({ subject: "Changelog: Cal.com v6.9" })).toBe(false);
    expect(requiresAction({ subject: 'Notes : " [IMPORTANT] Point Parade" 19 oct. 2026' })).toBe(
      false,
    );
    expect(
      requiresAction({
        subject: "[RESOLVED - No severity] quota-exhausted > 0 / 300s on placement",
      }),
    ).toBe(false);
    expect(requiresAction({ subject: "Résolu Castorama FR : chute des offres actives" })).toBe(
      false,
    );
    expect(requiresAction({ subject: null })).toBe(false);
  });
});
