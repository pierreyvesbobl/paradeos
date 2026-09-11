import { describe, expect, it } from "vitest";
import {
  INVOICE_DIRECTION_LABEL,
  buildLabelName,
  collectInvolvedDomains,
  collectInvolvedEmails,
  invoiceDirectionLabelName,
  matchEntityIdsByDomain,
  sanitizeLabelSegment,
} from "./link-rules";

describe("sanitizeLabelSegment", () => {
  it("remplace les / (séparateur Gmail) et compacte les espaces", () => {
    expect(sanitizeLabelSegment("  Acme / Filiale   Sud ")).toBe("Acme Filiale Sud");
    expect(sanitizeLabelSegment("A//B")).toBe("A B");
  });

  it("tronque à 80 caractères", () => {
    expect(sanitizeLabelSegment("x".repeat(100))).toHaveLength(80);
  });

  it("garde les accents et la ponctuation utile", () => {
    expect(sanitizeLabelSegment("Société Générale & Cie")).toBe("Société Générale & Cie");
  });
});

describe("buildLabelName", () => {
  it("préfixe par Paradeos et le segment du kind", () => {
    expect(buildLabelName("project", "Avenir Focus")).toBe("Paradeos/Projets/Avenir Focus");
    expect(buildLabelName("contact", "Jean Dupont")).toBe("Paradeos/Contacts/Jean Dupont");
    expect(buildLabelName("entity", "Acme Corp")).toBe("Paradeos/Entités/Acme Corp");
  });

  it("un libellé système est au niveau 2, sans segment de kind", () => {
    expect(buildLabelName("category", "Facture achat")).toBe("Paradeos/Facture achat");
  });

  it("un nom avec / ne crée pas de niveau supplémentaire", () => {
    expect(buildLabelName("project", "Refonte / Phase 2")).toBe("Paradeos/Projets/Refonte Phase 2");
  });
});

describe("invoiceDirectionLabelName", () => {
  it("projette le sens de la facture en libellé système", () => {
    expect(invoiceDirectionLabelName("purchase")).toBe("Paradeos/Facture achat");
    expect(invoiceDirectionLabelName("sale")).toBe("Paradeos/Facture vente");
    expect(Object.keys(INVOICE_DIRECTION_LABEL)).toEqual(["purchase", "sale"]);
  });
});

describe("collectInvolvedEmails", () => {
  it("réunit from, to et cc en minuscules, dédoublonnés, dans l'ordre d'apparition", () => {
    const out = collectInvolvedEmails([
      { fromEmail: "Alice@Acme.com", toEmails: ["bob@parade.fr"], ccEmails: ["carol@acme.com"] },
      { fromEmail: "bob@parade.fr", toEmails: ["alice@acme.com"], ccEmails: null },
    ]);
    expect(out).toEqual(["alice@acme.com", "bob@parade.fr", "carol@acme.com"]);
  });

  it("tolère un from absent et des listes nulles", () => {
    expect(collectInvolvedEmails([{ fromEmail: null, toEmails: null, ccEmails: null }])).toEqual(
      [],
    );
    expect(collectInvolvedEmails([])).toEqual([]);
  });
});

describe("collectInvolvedDomains", () => {
  it("garde les domaines d'entreprise et écarte les webmails génériques", () => {
    const out = collectInvolvedDomains([
      "alice@acme.com",
      "bob@gmail.com",
      "carol@Acme.com",
      "dave@orange.fr",
      "eve@webedia.fr",
    ]);
    expect([...out]).toEqual(["acme.com", "webedia.fr"]);
  });

  it("ignore une adresse sans domaine", () => {
    expect(collectInvolvedDomains(["pasdemail", "trailing@"]).size).toBe(0);
  });
});

describe("matchEntityIdsByDomain", () => {
  const rows = [
    { id: "acme", website: "https://www.acme.com/contact" },
    { id: "webedia", website: "webedia.fr" },
    { id: "sans-site", website: null },
    { id: "autre", website: "https://autre.io" },
  ];

  it("matche sur le domaine du site, www et chemin ignorés", () => {
    expect(matchEntityIdsByDomain(rows, new Set(["acme.com", "webedia.fr"]))).toEqual([
      "acme",
      "webedia",
    ]);
  });

  it("ne matche rien sans domaine impliqué", () => {
    expect(matchEntityIdsByDomain(rows, new Set())).toEqual([]);
  });

  it("un sous-domaine ne matche pas le domaine racine", () => {
    expect(matchEntityIdsByDomain(rows, new Set(["mail.acme.com"]))).toEqual([]);
  });
});
