import { describe, expect, it } from "vitest";
import { isAutomatedSender } from "./automated-sender";

describe("isAutomatedSender", () => {
  it("reconnaît les adresses techniques par leur partie locale", () => {
    expect(isAutomatedSender({ fromEmail: "noreply@supabase.com" })).toBe(true);
    expect(isAutomatedSender({ fromEmail: "no-reply@acme.fr" })).toBe(true);
    expect(isAutomatedSender({ fromEmail: "notifications@stripe.com" })).toBe(true);
    expect(isAutomatedSender({ fromEmail: "alertes@automato.tech" })).toBe(true);
    expect(isAutomatedSender({ fromEmail: "MAILER-DAEMON@googlemail.com" })).toBe(true);
    expect(isAutomatedSender({ fromEmail: "microsoft-noreply@microsoft.com" })).toBe(true);
    expect(isAutomatedSender({ fromEmail: "azure-noreply@microsoft.com" })).toBe(true);
    expect(isAutomatedSender({ fromEmail: "team_no-reply@acme.io" })).toBe(true);
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

  it("reconnaît l'envoi en masse déguisé en personne", () => {
    const linkavista = { fromEmail: "mickael@linkavista.fr", fromName: "L'équipe Linkavista" };
    // Le nom suffit…
    expect(isAutomatedSender(linkavista)).toBe(true);
    // …et, sans lui, l'onglet Gmail ou le lien de désinscription.
    expect(
      isAutomatedSender({ fromEmail: "mickael@linkavista.fr", labels: ["CATEGORY_PROMOTIONS"] }),
    ).toBe(true);
    expect(
      isAutomatedSender({ fromEmail: "mickael@linkavista.fr", labels: ["CATEGORY_SOCIAL"] }),
    ).toBe(true);
    expect(
      isAutomatedSender({
        fromEmail: "mickael@linkavista.fr",
        bodyHtml: '<a href="https://x.fr/u">Se désinscrire</a>',
      }),
    ).toBe(true);
    expect(
      isAutomatedSender({
        fromEmail: "julie@acme.fr",
        bodyHtml: '<a href="https://list.acme.fr/unsubscribe?u=1">Gérer mes préférences</a>',
      }),
    ).toBe(true);
    expect(isAutomatedSender({ fromEmail: "x@acme.fr", fromName: "Équipe Qonto" })).toBe(true);
    expect(isAutomatedSender({ fromEmail: "x@acme.fr", fromName: "The Linear Team" })).toBe(true);
  });

  it("ne range pas un échange réel parmi les envois en masse", () => {
    expect(
      isAutomatedSender({
        fromEmail: "julie@acme.fr",
        fromName: "Julie Martin",
        labels: ["INBOX", "IMPORTANT", "CATEGORY_UPDATES", "CATEGORY_PERSONAL"],
        bodyHtml: "<p>Bonjour, je vous envoie le devis signé.</p>",
      }),
    ).toBe(false);
    // Le mot seul, dans un vrai échange, ne suffit pas : il faut un lien.
    expect(
      isAutomatedSender({
        fromEmail: "julie@acme.fr",
        bodyHtml: "<p>Il faut gérer la désinscription des utilisateurs (unsubscribe).</p>",
      }),
    ).toBe(false);
    // « Team » au milieu d'un nom propre n'est pas une signature d'équipe.
    expect(isAutomatedSender({ fromEmail: "a@b.fr", fromName: "Teamia Dupont" })).toBe(false);
  });
});
