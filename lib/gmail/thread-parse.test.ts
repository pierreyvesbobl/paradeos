import { describe, expect, it } from "vitest";
import { parseEmailThread } from "./thread-parse";

describe("parseEmailThread", () => {
  it("returns full body when there is no quote marker", () => {
    const r = parseEmailThread({
      bodyText: "Salut !\n\nÇa marche pour vendredi.\nPY",
      bodyHtml: null,
    });
    expect(r.cleanText).toBe("Salut !\n\nÇa marche pour vendredi.\nPY");
    expect(r.quotes).toEqual([]);
  });

  it("splits French Gmail-style quote", () => {
    const r = parseEmailThread({
      bodyText: [
        "Ok, on garde comme ça.",
        "",
        "Le 15 mars 2026 à 10:23, Sophie <s@example.com> a écrit :",
        "> Voici la version finale du devis.",
        "> Dis-moi ce que tu en penses.",
      ].join("\n"),
      bodyHtml: null,
    });
    expect(r.cleanText).toBe("Ok, on garde comme ça.");
    expect(r.quotes).toHaveLength(1);
    expect(r.quotes[0]?.header).toMatch(/Le 15 mars 2026.*Sophie.*a écrit/);
    expect(r.quotes[0]?.body).toBe(
      "Voici la version finale du devis.\nDis-moi ce que tu en penses.",
    );
  });

  it("splits English Gmail-style quote", () => {
    const r = parseEmailThread({
      bodyText: [
        "Thanks!",
        "",
        "On Mon, Mar 15, 2026 at 10:23 AM, Sophie <s@example.com> wrote:",
        "> Here is the final proposal.",
      ].join("\n"),
      bodyHtml: null,
    });
    expect(r.cleanText).toBe("Thanks!");
    expect(r.quotes[0]?.body).toBe("Here is the final proposal.");
  });

  it("splits Outlook -----Message d'origine-----", () => {
    const r = parseEmailThread({
      bodyText: [
        "Bien reçu.",
        "",
        "-----Message d'origine-----",
        "De : Sophie <s@example.com>",
        "Envoyé : mardi 15 mars 2026 10:23",
        "À : PY <py@example.com>",
        "Objet : Re: Devis",
        "",
        "Voici le devis à jour.",
      ].join("\n"),
      bodyHtml: null,
    });
    expect(r.cleanText).toBe("Bien reçu.");
    expect(r.quotes).toHaveLength(1);
    expect(r.quotes[0]?.header).toMatch(/Message d'origine/);
    expect(r.quotes[0]?.body).toContain("Voici le devis à jour.");
  });

  it("unquotes nested > > lines", () => {
    const r = parseEmailThread({
      bodyText: [
        "Ok.",
        "",
        "Le 15 mars 2026, X a écrit :",
        "> Ok pour moi.",
        ">",
        "> Le 14 mars 2026, Y a écrit :",
        "> > Proposition initiale.",
      ].join("\n"),
      bodyHtml: null,
    });
    expect(r.cleanText).toBe("Ok.");
    expect(r.quotes[0]?.body).toContain("Ok pour moi.");
    expect(r.quotes[0]?.body).toContain("Proposition initiale.");
    // Plus de préfixe `>` après unquote.
    expect(r.quotes[0]?.body).not.toMatch(/^>/);
  });

  it("strips gmail_quote blockquote from HTML output", () => {
    const html =
      '<div>Bonjour,<br>Merci.</div><blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px #ccc solid;padding-left:1ex">Ancien message.</blockquote>';
    const r = parseEmailThread({ bodyText: null, bodyHtml: html });
    expect(r.cleanHtml).toContain("Bonjour");
    expect(r.cleanHtml).not.toContain("Ancien message");
    expect(r.cleanHtml).not.toContain("blockquote");
  });

  it("falls back to HTML → text when no bodyText", () => {
    const html =
      "<p>Ok.</p><p>Le 15 mars 2026, X a écrit :</p><blockquote>Message ancien.</blockquote>";
    const r = parseEmailThread({ bodyText: null, bodyHtml: html });
    expect(r.cleanText).toContain("Ok.");
    expect(r.quotes[0]?.body).toContain("Message ancien.");
  });

  it("strips signature after `-- ` marker", () => {
    const r = parseEmailThread({
      bodyText: "Voici la note.\n\n-- \nPierre-Yves\nParade OS",
      bodyHtml: null,
    });
    expect(r.cleanText).toBe("Voici la note.");
    expect(r.cleanText).not.toContain("Pierre-Yves");
  });

  it("returns empty quotes when marker exists but history body is empty", () => {
    // Quoique rare : mail qui coupe pile après "X a écrit :" sans corps.
    const r = parseEmailThread({
      bodyText: "Ok.\n\nLe 15 mars 2026, X a écrit :",
      bodyHtml: null,
    });
    expect(r.cleanText).toBe("Ok.");
    expect(r.quotes).toEqual([]);
  });
});
