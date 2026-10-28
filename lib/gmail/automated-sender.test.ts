import { describe, expect, it } from "vitest";
import { isAutomatedSender } from "./automated-sender";

describe("isAutomatedSender", () => {
  it("reconnaît les adresses techniques par leur partie locale", () => {
    expect(isAutomatedSender({ fromEmail: "noreply@supabase.com" })).toBe(true);
    expect(isAutomatedSender({ fromEmail: "no-reply@acme.fr" })).toBe(true);
    expect(isAutomatedSender({ fromEmail: "notifications@stripe.com" })).toBe(true);
    expect(isAutomatedSender({ fromEmail: "alertes@automato.tech" })).toBe(true);
    expect(isAutomatedSender({ fromEmail: "MAILER-DAEMON@googlemail.com" })).toBe(true);
  });

  it("reconnaît les services machines, sous-domaines compris", () => {
    expect(isAutomatedSender({ fromEmail: "gemini-notes@google.com" })).toBe(true);
    expect(isAutomatedSender({ fromEmail: "hello@mail.granola.ai" })).toBe(true);
    expect(isAutomatedSender({ fromEmail: "facture@services.ovhcloud.com" })).toBe(true);
  });

  it("reconnaît un nom d'affichage de notification", () => {
    expect(isAutomatedSender({ fromEmail: "x@acme.fr", fromName: "Acme (no-reply)" })).toBe(true);
  });

  it("laisse passer les humains, même chez un client dont le domaine ressemble", () => {
    expect(isAutomatedSender({ fromEmail: "m.vittorio@gpasplus.com" })).toBe(false);
    expect(isAutomatedSender({ fromEmail: "antonio@aparisiconsulting.com" })).toBe(false);
    expect(isAutomatedSender({ fromEmail: "info@le-silex.com", fromName: "Le Silex" })).toBe(false);
    expect(isAutomatedSender({ fromEmail: "comptabilite@avenirfocus.com" })).toBe(false);
    expect(isAutomatedSender({ fromEmail: "pierreyves@automato.tech" })).toBe(false);
    expect(isAutomatedSender({ fromEmail: null })).toBe(false);
  });
});
