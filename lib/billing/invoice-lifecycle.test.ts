import { describe, expect, it } from "vitest";
import {
  DEFAULT_DUE_DAYS,
  addDaysISO,
  extractDougsUuid,
  isDougsInvoicePaid,
  mapDougsQuoteStatus,
  resolveStatusTransition,
  resolveUpsertDueDate,
  toDate,
  toNumeric,
} from "./invoice-lifecycle";

const NOW = new Date("2026-09-11T10:00:00Z");

describe("addDaysISO", () => {
  it("ajoute des jours en passant les mois et les années", () => {
    expect(addDaysISO(new Date("2026-01-31T00:00:00Z"), 30)).toBe("2026-03-02");
    expect(addDaysISO(new Date("2026-12-15T00:00:00Z"), 30)).toBe("2027-01-14");
  });

  it("raisonne en UTC : une base tard le soir bascule sur le lendemain", () => {
    expect(addDaysISO(new Date("2026-03-01T23:30:00Z"), 1)).toBe("2026-03-02");
  });

  it("+0 renvoie la date de base", () => {
    expect(addDaysISO(new Date("2026-02-28T12:00:00Z"), 0)).toBe("2026-02-28");
  });
});

describe("toNumeric", () => {
  it("formate en numeric Postgres à 2 décimales", () => {
    expect(toNumeric(1234.5)).toBe("1234.50");
    expect(toNumeric(100)).toBe("100.00");
    expect(toNumeric(19.999)).toBe("20.00");
    expect(toNumeric(0)).toBe("0.00");
  });

  it("renvoie null pour absent, NaN ou infini", () => {
    expect(toNumeric(null)).toBeNull();
    expect(toNumeric(undefined)).toBeNull();
    expect(toNumeric(Number.NaN)).toBeNull();
    expect(toNumeric(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("toDate", () => {
  it("parse une ISO valide", () => {
    expect(toDate("2026-03-01T00:00:00Z")?.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });

  it("renvoie null pour vide, null ou invalide", () => {
    expect(toDate(null)).toBeNull();
    expect(toDate(undefined)).toBeNull();
    expect(toDate("")).toBeNull();
    expect(toDate("pas une date")).toBeNull();
  });
});

describe("mapDougsQuoteStatus", () => {
  it("mappe les statuts connus, insensible à la casse", () => {
    expect(mapDougsQuoteStatus("ACCEPTED")).toBe("accepted");
    expect(mapDougsQuoteStatus("accepted")).toBe("accepted");
    expect(mapDougsQuoteStatus("Refused")).toBe("refused");
    expect(mapDougsQuoteStatus("DRAFT")).toBe("draft");
  });

  it("PENDING, inconnu ou null → sent", () => {
    expect(mapDougsQuoteStatus("PENDING")).toBe("sent");
    expect(mapDougsQuoteStatus("whatever")).toBe("sent");
    expect(mapDougsQuoteStatus(null)).toBe("sent");
  });
});

describe("isDougsInvoicePaid", () => {
  it("payé si le statut le dit, quelle que soit la casse", () => {
    expect(isDougsInvoicePaid("paid", null)).toBe(true);
    expect(isDougsInvoicePaid("PAID", null)).toBe(true);
  });

  it("payé si une date de paiement existe même sans statut (rapprochement bancaire)", () => {
    expect(isDougsInvoicePaid(null, "2026-03-04")).toBe(true);
    expect(isDougsInvoicePaid("pending", "2026-03-04")).toBe(true);
  });

  it("non payé sinon", () => {
    expect(isDougsInvoicePaid("pending", null)).toBe(false);
    expect(isDougsInvoicePaid(null, null)).toBe(false);
  });
});

describe("extractDougsUuid", () => {
  const uuid = "5a1b2c3d-1111-4222-8333-abcdefabcdef";

  it("accepte un UUID brut, avec espaces autour", () => {
    expect(extractDougsUuid(uuid)).toBe(uuid);
    expect(extractDougsUuid(`  ${uuid}\n`)).toBe(uuid);
  });

  it("extrait l'UUID d'une URL Dougs facture / devis / brouillon", () => {
    expect(extractDougsUuid(`https://app.dougs.fr/invoicing/sales-invoice/${uuid}`)).toBe(uuid);
    expect(extractDougsUuid(`https://app.dougs.fr/invoicing/quote/${uuid}?tab=x`)).toBe(uuid);
    expect(extractDougsUuid(`https://app.dougs.fr/invoicing/drafts/${uuid}/edit`)).toBe(uuid);
  });

  it("garde la casse d'origine et prend le premier UUID rencontré", () => {
    const upper = uuid.toUpperCase();
    expect(extractDougsUuid(upper)).toBe(upper);
    const second = "9f9f9f9f-9999-4999-8999-999999999999";
    expect(extractDougsUuid(`${uuid} ${second}`)).toBe(uuid);
  });

  it("refuse une entrée sans UUID avec un message actionnable", () => {
    expect(() => extractDougsUuid("F-2026-0042")).toThrow(/ID Dougs introuvable/);
    expect(() => extractDougsUuid("")).toThrow();
    // Un UUID tronqué ne passe pas.
    expect(() => extractDougsUuid("5a1b2c3d-1111-4222-8333-abcdefabcde")).toThrow();
  });
});

describe("resolveUpsertDueDate", () => {
  const existing = { invoicedAt: new Date("2026-03-01T00:00:00Z"), dueDate: "2026-04-15" };

  it("une échéance explicite l'emporte sur tout", () => {
    expect(
      resolveUpsertDueDate({ inputDueDate: "2026-05-01", status: "draft", existing, now: NOW }),
    ).toBe("2026-05-01");
  });

  it("un null explicite efface l'échéance existante", () => {
    expect(resolveUpsertDueDate({ inputDueDate: null, status: "sent", existing, now: NOW })).toBe(
      null,
    );
  });

  it("sans consigne, garde l'échéance existante", () => {
    expect(
      resolveUpsertDueDate({ inputDueDate: undefined, status: "sent", existing, now: NOW }),
    ).toBe("2026-04-15");
  });

  it("au passage à sent sans échéance, invoiced_at + 30 j", () => {
    expect(
      resolveUpsertDueDate({
        inputDueDate: undefined,
        status: "sent",
        existing: { ...existing, dueDate: null },
        now: NOW,
      }),
    ).toBe("2026-03-31");
  });

  it("sur une création envoyée directement, now + 30 j", () => {
    expect(
      resolveUpsertDueDate({ inputDueDate: undefined, status: "sent", existing: null, now: NOW }),
    ).toBe(addDaysISO(NOW, DEFAULT_DUE_DAYS));
  });

  it("un brouillon ou une facture payée ne reçoit pas d'échéance automatique", () => {
    expect(
      resolveUpsertDueDate({ inputDueDate: undefined, status: "draft", existing: null, now: NOW }),
    ).toBeNull();
    expect(
      resolveUpsertDueDate({ inputDueDate: undefined, status: "paid", existing: null, now: NOW }),
    ).toBeNull();
  });
});

describe("resolveStatusTransition", () => {
  const fresh = { invoicedAt: null, paidAt: null, dueDate: null, assignedTo: null };
  const issued = {
    invoicedAt: new Date("2026-03-01T00:00:00Z"),
    paidAt: null,
    dueDate: "2026-03-31",
    assignedTo: "user-1",
  };

  it("sent sur un brouillon : émet maintenant, échéance +30 j, demande le lead projet", () => {
    const t = resolveStatusTransition({ status: "sent", existing: fresh, now: NOW });
    expect(t.invoicedAt).toBe(NOW);
    expect(t.paidAt).toBeNull();
    expect(t.dueDate).toBe(addDaysISO(NOW, DEFAULT_DUE_DAYS));
    expect(t.needsAssigneeFromProject).toBe(true);
  });

  it("sent sur une facture déjà émise : conserve la date d'émission et l'échéance", () => {
    const t = resolveStatusTransition({ status: "sent", existing: issued, now: NOW });
    expect(t.invoicedAt).toBe(issued.invoicedAt);
    expect(t.dueDate).toBe("2026-03-31");
    expect(t.needsAssigneeFromProject).toBe(false);
  });

  it("sent sur une facture émise sans échéance : échéance depuis invoiced_at, pas depuis now", () => {
    const t = resolveStatusTransition({
      status: "sent",
      existing: { ...issued, dueDate: null },
      now: NOW,
    });
    expect(t.dueDate).toBe("2026-03-31");
  });

  it("paid : pose paid_at maintenant, sans toucher à l'échéance", () => {
    const t = resolveStatusTransition({ status: "paid", existing: issued, now: NOW });
    expect(t.paidAt).toBe(NOW);
    expect(t.invoicedAt).toBe(issued.invoicedAt);
    expect(t.dueDate).toBe("2026-03-31");
    expect(t.needsAssigneeFromProject).toBe(false);
  });

  it("paid sur une facture déjà payée : garde la date de paiement d'origine", () => {
    const paidAt = new Date("2026-03-20T00:00:00Z");
    const t = resolveStatusTransition({
      status: "paid",
      existing: { ...issued, paidAt },
      now: NOW,
    });
    expect(t.paidAt).toBe(paidAt);
  });

  it("paid directement depuis un brouillon : émet et paie à la même date", () => {
    const t = resolveStatusTransition({ status: "paid", existing: fresh, now: NOW });
    expect(t.invoicedAt).toBe(NOW);
    expect(t.paidAt).toBe(NOW);
    expect(t.dueDate).toBeNull();
  });

  it("draft : efface émission et paiement, conserve l'échéance (évite la ressaisie)", () => {
    const paidAt = new Date("2026-03-20T00:00:00Z");
    const t = resolveStatusTransition({
      status: "draft",
      existing: { ...issued, paidAt },
      now: NOW,
    });
    expect(t.invoicedAt).toBeNull();
    expect(t.paidAt).toBeNull();
    expect(t.dueDate).toBe("2026-03-31");
    expect(t.needsAssigneeFromProject).toBe(false);
  });

  it("une facture payée repassée à sent conserve paid_at (comportement actuel)", () => {
    const paidAt = new Date("2026-03-20T00:00:00Z");
    const t = resolveStatusTransition({
      status: "sent",
      existing: { ...issued, paidAt },
      now: NOW,
    });
    expect(t.paidAt).toBe(paidAt);
  });

  it("accepted / refused : n'émettent pas d'échéance et gardent le reste", () => {
    for (const status of ["accepted", "refused"] as const) {
      const t = resolveStatusTransition({ status, existing: fresh, now: NOW });
      expect(t.invoicedAt).toBe(NOW);
      expect(t.dueDate).toBeNull();
      expect(t.paidAt).toBeNull();
      expect(t.needsAssigneeFromProject).toBe(false);
    }
  });
});
