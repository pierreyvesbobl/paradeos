import { describe, expect, it } from "vitest";
import { dueDaysForOption } from "./billing-terms";
import { INVOICE_BRAND_LABELS, brandForInvoice, brandTemplateFor } from "./brand-templates";

const COWORKING_CTX = {
  label: "T3 2026",
  amountHt: 1797,
  vatRate: 0.2,
  clientName: "Acme SAS",
  periodStart: "2026-07-01",
  periodEnd: "2026-09-30",
  months: 3,
  desks: 2,
  unitPriceHt: 299.5,
};

describe("brandForInvoice", () => {
  it("rattache le coworking à la marque Coworking", () => {
    expect(brandForInvoice({ kind: "coworking" })).toBe("coworking");
  });

  it("rattache devis et jalons à Automato", () => {
    expect(brandForInvoice({ kind: "quote" })).toBe("automato");
    expect(brandForInvoice({ kind: "milestone" })).toBe("automato");
  });

  it("fait tomber le reste sur Parade", () => {
    expect(brandForInvoice({ kind: "one_off" })).toBe("parade");
    expect(brandForInvoice({ kind: "credit_note" })).toBe("parade");
  });

  it("suit le contrat coworking même quand le kind ne le dit pas", () => {
    // Un avoir rattaché à un contrat coworking relève du coworking.
    expect(brandForInvoice({ kind: "credit_note", coworkingContractId: "abc" })).toBe("coworking");
  });
});

describe("template coworking", () => {
  const template = brandTemplateFor("coworking");

  it("facture une ligne au mois, quantité = nombre de mois", () => {
    const [line, ...rest] = template.buildLines(COWORKING_CTX);
    expect(rest).toHaveLength(0);
    expect(line?.title).toBe("Prestation d'hébergement");
    expect(line?.unit).toBe("mois");
    expect(line?.quantity).toBe(3);
    expect(line?.unitAmount).toBe(599);
    expect(line?.amount).toBe(1797);
    expect(line?.vatRate).toBe(0.2);
  });

  it("accorde le pluriel des postes", () => {
    expect(template.buildLines(COWORKING_CTX)[0]?.description).toContain("2 postes");
    expect(template.buildLines({ ...COWORKING_CTX, desks: 1 })[0]?.description).toContain(
      "1 poste ",
    );
  });

  it("tient pour un mois isolé", () => {
    const [line] = template.buildLines({
      ...COWORKING_CTX,
      label: "septembre 2026",
      months: 1,
      desks: 1,
      unitPriceHt: 299.5,
      amountHt: 299.5,
    });
    expect(line?.quantity).toBe(1);
    expect(line?.amount).toBe(299.5);
  });

  it("arrondit le total au centime", () => {
    // 3 × 199.9 × 3 part en flottant sale si on ne l'arrondit pas.
    const [line] = template.buildLines({
      ...COWORKING_CTX,
      desks: 3,
      unitPriceHt: 199.9,
      months: 3,
    });
    expect(line?.amount).toBe(1799.1);
  });

  it("nomme la période dans l'objet et le mail", () => {
    expect(template.invoiceSubject(COWORKING_CTX)).toBe("Hébergement coworking — T3 2026");
    const mail = template.email(COWORKING_CTX);
    expect(mail.subject).toContain("T3 2026");
    // Dates en format français dans le corps, pas en ISO.
    expect(mail.body).toContain("01/07/2026");
    expect(mail.body).toContain("30/09/2026");
    expect(mail.body).not.toContain("2026-07-01");
  });

  it("annonce un TTC cohérent avec la TVA", () => {
    // 1797 HT à 20 % = 2156,40 TTC. L'attendu est construit par la même API
    // que le template : fr-FR sépare les milliers par une espace insécable
    // fine, qu'un littéral avec une espace normale ne retrouverait pas.
    const expected = (1797 * 1.2).toLocaleString("fr-FR", {
      style: "currency",
      currency: "EUR",
    });
    expect(template.email(COWORKING_CTX).body).toContain(expected);
    expect(expected).toMatch(/2.156,40/);
  });
});

describe("template automato", () => {
  const template = brandTemplateFor("automato");
  const ctx = {
    label: "Acompte 40 %",
    amountHt: 4000,
    vatRate: 0.2,
    clientName: "Acme SAS",
    projectName: "Refonte site",
    milestonePercent: 40,
  };

  it("facture un forfait décrit par le pourcentage du projet", () => {
    const [line] = template.buildLines(ctx);
    expect(line?.unit).toBe("forfait");
    expect(line?.quantity).toBe(1);
    expect(line?.amount).toBe(4000);
    expect(line?.description).toBe('40 % du projet "Refonte site".');
  });

  it("préfixe l'objet par le projet", () => {
    expect(template.invoiceSubject(ctx)).toBe("Refonte site — Acompte 40 %");
  });

  it("se passe du projet quand il manque", () => {
    const sansProjet = { ...ctx, projectName: null };
    expect(template.invoiceSubject(sansProjet)).toBe("Acompte 40 %");
    expect(template.email(sansProjet).subject).toBe("Facture Acompte 40 %");
  });
});

describe("template parade", () => {
  it("facture une ligne forfaitaire au libellé de la facture", () => {
    const [line] = brandTemplateFor("parade").buildLines({
      label: "Refacturation matériel",
      amountHt: 250,
      vatRate: 0.2,
      clientName: "Acme SAS",
    });
    expect(line?.title).toBe("Refacturation matériel");
    expect(line?.amount).toBe(250);
  });
});

describe("échéances", () => {
  it("le coworking est payable sous quinzaine, la presta à 30 jours", () => {
    expect(dueDaysForOption(brandTemplateFor("coworking").document.dueDateOption)).toBe(15);
    expect(dueDaysForOption(brandTemplateFor("automato").document.dueDateOption)).toBe(30);
    expect(dueDaysForOption(brandTemplateFor("parade").document.dueDateOption)).toBe(30);
  });

  it("déclare l'échéance une seule fois, sur le document", () => {
    // Le délai en jours est dérivé de `dueDateOption`, jamais déclaré à côté :
    // c'est ce qui empêche le PDF et les relances de se contredire.
    expect(brandTemplateFor("coworking")).not.toHaveProperty("dueDays");
  });
});

describe("registre", () => {
  it("expose un libellé par marque", () => {
    expect(INVOICE_BRAND_LABELS).toEqual({
      parade: "Parade",
      coworking: "La Cachette",
      automato: "Automato",
    });
  });

  it("retombe sur Parade pour une marque inconnue", () => {
    // Garde-fou : une valeur d'enum ajoutée en base sans template ne doit pas
    // faire exploser un push de facture.
    expect(brandTemplateFor("inconnue" as never).brand).toBe("parade");
  });
});

describe("mail client", () => {
  it("porte une version HTML et une version texte distinctes", () => {
    const mail = brandTemplateFor("coworking").email(COWORKING_CTX);
    expect(mail.html).toContain("<!doctype html>");
    expect(mail.body).not.toContain("<");
    expect(mail.subject).toBeTruthy();
  });

  it("affiche la marque, pas le nom de l'outil interne", () => {
    const html = brandTemplateFor("coworking").email(COWORKING_CTX).html;
    expect(html).toContain("La Cachette");
    // Un client ne doit jamais voir le nom de notre app.
    expect(html).not.toContain("Parade OS");
  });

  it("récapitule période, postes et montants dans le HTML", () => {
    const html = brandTemplateFor("coworking").email(COWORKING_CTX).html;
    expect(html).toContain("01/07/2026");
    expect(html).toContain("2 postes");
    expect(html).toContain("Total TTC");
  });

  it("échappe le HTML des données client", () => {
    const html = brandTemplateFor("automato").email({
      label: "Acompte",
      amountHt: 100,
      vatRate: 0.2,
      clientName: "Acme",
      projectName: '<script>alert("x")</script>',
    }).html;
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("donne un nom d'expéditeur par marque", () => {
    expect(brandTemplateFor("coworking").senderName).toBe("La Cachette");
    expect(brandTemplateFor("automato").senderName).toBe("Automato");
    expect(brandTemplateFor("parade").senderName).toBe("Parade");
  });
});

describe("mentions du document", () => {
  it("le coworking ne parle plus d'Automato ni de devis", () => {
    const doc = brandTemplateFor("coworking").document;
    expect(doc.invoicerOthers).toEqual(["La Cachette est une marque de Parade SAS"]);
    // Le défaut Dougs évoque des coûts d'appels LLM et la validité d'un devis.
    expect(doc.thankYouNote).toBeNull();
    // La ligne de pied par défaut renvoie aux CGPS d'Automato.
    expect(doc.footerOthers).toEqual([]);
    expect(doc.paymentTerms).toContain("15 jours");
  });

  it("ne surcharge pas les pénalités de retard, qui sont légales et communes", () => {
    // Clé absente = on garde la formulation de Dougs (taux BCE + 10 points).
    expect(brandTemplateFor("coworking").document.latePaymentTerms).toBeUndefined();
  });

  it("laisse les mentions d'Automato aux réglages Dougs, mais fixe l'échéance", () => {
    const doc = brandTemplateFor("automato").document;
    // Sous-titre, CGPS et note de remerciement : Dougs fait foi.
    expect(doc.invoicerOthers).toBeUndefined();
    expect(doc.footerOthers).toBeUndefined();
    expect(doc.thankYouNote).toBeUndefined();
    expect(doc.paymentTerms).toBeUndefined();
    // L'échéance est explicitée pour ne pas dépendre d'un défaut Dougs qu'un
    // changement de réglage déplacerait sans qu'on le voie.
    expect(doc.dueDateOption).toBe("DAYS_30");
  });

  it("accorde l'échéance du document avec celle que Parade OS suit", () => {
    const option = brandTemplateFor("coworking").document.dueDateOption;
    expect(option).toBe("DAYS_15");
    expect(dueDaysForOption(option)).toBe(15);
  });
});

describe("logo", () => {
  it("épingle un logo par marque plutôt que de suivre le défaut société", () => {
    // Le défaut `defaultLogoUuid` est global : le changer pour une marque
    // repeint les factures de toutes les autres. Épingler l'évite.
    for (const brand of ["coworking", "automato", "parade"] as const) {
      expect(brandTemplateFor(brand).document.logoUuid).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    }
  });

  it("donne au coworking un logo distinct de la prestation", () => {
    expect(brandTemplateFor("coworking").document.logoUuid).not.toBe(
      brandTemplateFor("automato").document.logoUuid,
    );
  });
});
