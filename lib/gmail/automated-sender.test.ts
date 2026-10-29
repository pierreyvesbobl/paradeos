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

  it("reconnaît un nom d'affichage de notification ou de newsletter", () => {
    expect(isAutomatedSender({ fromEmail: "x@acme.fr", fromName: "Acme (no-reply)" })).toBe(true);
    expect(
      isAutomatedSender({ fromEmail: "isabelle.tissot@dougs.fr", fromName: "Isabelle de Dougs" }),
    ).toBe(true);
    expect(
      isAutomatedSender({
        fromEmail: "data-studio-noreply@google.com",
        fromName: "Pierre-Yves Sage (via Data Studio)",
      }),
    ).toBe(true);
  });

  it("reconnaît les sous-domaines d'envoi et les adresses de facturation", () => {
    expect(isAutomatedSender({ fromEmail: "news@newsletter.radiofrance.fr" })).toBe(true);
    expect(isAutomatedSender({ fromEmail: "info@news.ovhcloud.com" })).toBe(true);
    expect(isAutomatedSender({ fromEmail: "em@em1.cloudflare.com" })).toBe(true);
    expect(isAutomatedSender({ fromEmail: "newsletter@contact.maxicoffee.com" })).toBe(true);
    expect(isAutomatedSender({ fromEmail: "invoice+statements@supabase.com" })).toBe(true);
    expect(isAutomatedSender({ fromEmail: "avisage-ne-pas-repondre@chronopost.fr" })).toBe(true);
    expect(isAutomatedSender({ fromEmail: "support@stello.eu" })).toBe(true);
    expect(
      isAutomatedSender({ fromEmail: "pole-partenariat@promeom.fr", fromName: "PROMEOM" }),
    ).toBe(true);
    expect(isAutomatedSender({ fromEmail: "zeno@resend.com", fromName: "Zeno from Resend" })).toBe(
      true,
    );
  });

  it("laisse passer les humains, même chez un client dont le domaine ressemble", () => {
    expect(isAutomatedSender({ fromEmail: "m.vittorio@gpasplus.com" })).toBe(false);
    expect(isAutomatedSender({ fromEmail: "antonio@aparisiconsulting.com" })).toBe(false);
    expect(isAutomatedSender({ fromEmail: "info@le-silex.com", fromName: "Le Silex" })).toBe(false);
    expect(isAutomatedSender({ fromEmail: "comptabilite@avenirfocus.com" })).toBe(false);
    expect(isAutomatedSender({ fromEmail: "pierreyves@automato.tech" })).toBe(false);
    expect(
      isAutomatedSender({ fromEmail: "benedicte@mkpdoctor.fr", fromName: "Bénédicte Cassin" }),
    ).toBe(false);
    expect(
      isAutomatedSender({ fromEmail: "isabelle.tissot@dougs.fr", fromName: "Isabelle Tissot" }),
    ).toBe(false);
    expect(
      isAutomatedSender({
        fromEmail: "mathis.m@avenirfocus.com",
        fromName: "AVENIR FOCUS Mathis MICHEL",
      }),
    ).toBe(false);
    expect(
      isAutomatedSender({
        fromEmail: "pierreyves@automato.tech",
        fromName: "Pierre-Yves d'Automato",
      }),
    ).toBe(false);
    expect(isAutomatedSender({ fromEmail: "contact@bobl.fr", fromName: "BOBL" })).toBe(true);
    expect(isAutomatedSender({ fromEmail: null })).toBe(false);
  });
});
