/**
 * Import one-shot des données coworking depuis Notion (page Coworking
 * de l'espace Parade) vers les tables Paradeos.
 *
 * - Crée 7 contacts (qualification = coworker), 8 contrats, 40 factures
 * - Refuse de tourner si des contrats coworking existent déjà (anti-doublon)
 * - Idempotent par nom/start_date sur les contacts (évite de re-créer
 *   un coworker existant)
 *
 * Usage : node scripts/import-coworking-from-notion.mjs
 */
import { config } from "dotenv";
import postgres from "postgres";

config({ path: "/Users/pierre-yvessage/Dev/paradeos/.env.local", quiet: true });
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) throw new Error("DATABASE_URL manquante");

const sql = postgres(dbUrl, { prepare: false, max: 1, onnotice: () => {} });

// ---------- Données figées ----------

/** Coworkers : Notion ID → { firstName, lastName } */
const COWORKERS = {
  "3585d5cd-375f-8079-889b-c886a6355b04": { firstName: "Bénédicte", lastName: "Landrodie" },
  "2425d5cd-375f-80cd-8772-d1896d5712ae": { firstName: "Louis-Rémi", lastName: "—" },
  "2425d5cd-375f-8069-bc10-c606c431a4e7": { firstName: "Toon", lastName: "—" },
  "2425d5cd-375f-80dd-a5fa-f85ce3da3c16": { firstName: "Yoann", lastName: "BUZENET" },
  "2425d5cd-375f-8001-9c0b-ecb139a51f0a": { firstName: "Brioche", lastName: "—" },
  "2425d5cd-375f-80df-a672-c59a6b24b6fd": { firstName: "Webedia", lastName: "—" },
  "2425d5cd-375f-8048-a050-f5a383bf500f": { firstName: "Boots & Cats", lastName: "SARL" },
};

/** Contrats : Notion ID → { coworkerNotionId, name, startDate, endDate, desks, unitPriceHt, status } */
const CONTRACTS = {
  "2425d5cd-375f-808c-ad16-fc12488a74da": {
    coworker: "2425d5cd-375f-8069-bc10-c606c431a4e7",
    name: "Contrat Toon",
    startDate: "2023-10-01",
    endDate: "2024-03-31",
    desks: 1,
    unitPriceHt: "200",
    status: "termine",
  },
  "2425d5cd-375f-806e-beb2-cf88d56d4f0b": {
    coworker: "2425d5cd-375f-80dd-a5fa-f85ce3da3c16",
    name: "Contrat Yoann BUZENET",
    startDate: "2025-06-01",
    endDate: null,
    desks: 1,
    unitPriceHt: "150",
    status: "termine",
  },
  "3585d5cd-375f-8072-96fa-f2a165adfbea": {
    coworker: "3585d5cd-375f-8079-889b-c886a6355b04",
    name: "Contrat Bénédicte Landrodie",
    startDate: "2026-05-01",
    endDate: null,
    desks: 1,
    unitPriceHt: "250",
    status: "en_cours",
  },
  "2425d5cd-375f-80e8-b68d-d912642b4391": {
    coworker: "2425d5cd-375f-80df-a672-c59a6b24b6fd",
    name: "Contrat Webedia",
    startDate: "2025-04-01",
    endDate: null,
    desks: 4,
    unitPriceHt: "250",
    status: "en_cours",
  },
  "2425d5cd-375f-805c-8833-edcc19a34a20": {
    coworker: "2425d5cd-375f-8001-9c0b-ecb139a51f0a",
    name: "Contrat Brioche",
    startDate: "2025-09-01",
    endDate: null,
    desks: 4,
    unitPriceHt: "250",
    status: "en_cours",
  },
  "2425d5cd-375f-800e-b5a1-dbdc59960d70": {
    coworker: "2425d5cd-375f-8048-a050-f5a383bf500f",
    name: "Contrat Boots & Cats",
    startDate: "2024-01-01",
    endDate: "2024-03-31",
    desks: 1,
    unitPriceHt: "250",
    status: "termine",
  },
  "2425d5cd-375f-8092-aa04-d545947ee597": {
    coworker: "2425d5cd-375f-80cd-8772-d1896d5712ae",
    name: "Contrat Louis-Rémi",
    startDate: "2024-01-01",
    endDate: null,
    desks: 1,
    unitPriceHt: "250",
    status: "en_cours",
  },
  "2425d5cd-375f-800d-8d28-ffa0228780f5": {
    coworker: "2425d5cd-375f-80df-a672-c59a6b24b6fd",
    name: "Contrat Webedia [OLD]",
    startDate: "2023-10-01",
    endDate: "2025-03-30",
    desks: 4,
    unitPriceHt: "225",
    status: "termine",
  },
};

const STATUS_MAP = { Payée: "payee", "Facture envoyé": "envoyee", "À Facturer": "a_facturer" };
const BILLED_BY_MAP = { Parade: "parade", "G&O": "g_and_o" };

/** Factures : { contractNotionId, name, billedBy, status, invoiceDate, periodStart, periodEnd } */
const INVOICES = [
  // Toon
  {
    contract: "2425d5cd-375f-808c-ad16-fc12488a74da",
    name: "T4 2023",
    billedBy: "G&O",
    status: "Payée",
    invoiceDate: "2024-08-22",
    periodStart: "2023-10-01",
    periodEnd: "2023-12-31",
  },
  {
    contract: "2425d5cd-375f-808c-ad16-fc12488a74da",
    name: "T1 2024",
    billedBy: "G&O",
    status: "Payée",
    invoiceDate: "2024-08-22",
    periodStart: "2024-01-01",
    periodEnd: "2024-03-31",
  },
  {
    contract: "2425d5cd-375f-808c-ad16-fc12488a74da",
    name: "T2 2024",
    billedBy: "G&O",
    status: "Payée",
    invoiceDate: "2024-08-22",
    periodStart: "2024-04-01",
    periodEnd: "2024-06-30",
  },
  {
    contract: "2425d5cd-375f-808c-ad16-fc12488a74da",
    name: "T3 2024",
    billedBy: "G&O",
    status: "Payée",
    invoiceDate: "2024-08-22",
    periodStart: "2024-07-01",
    periodEnd: "2024-09-30",
  },
  {
    contract: "2425d5cd-375f-808c-ad16-fc12488a74da",
    name: "T4 2024",
    billedBy: "G&O",
    status: "Payée",
    invoiceDate: "2025-05-16",
    periodStart: "2024-10-01",
    periodEnd: "2024-12-31",
  },
  {
    contract: "2425d5cd-375f-808c-ad16-fc12488a74da",
    name: "T1 2025",
    billedBy: "G&O",
    status: "Payée",
    invoiceDate: "2025-05-16",
    periodStart: "2025-01-01",
    periodEnd: "2025-03-31",
  },
  {
    contract: "2425d5cd-375f-808c-ad16-fc12488a74da",
    name: "T2 2025",
    billedBy: "G&O",
    status: "Payée",
    invoiceDate: "2025-05-16",
    periodStart: "2025-04-01",
    periodEnd: "2025-06-30",
  },
  {
    contract: "2425d5cd-375f-808c-ad16-fc12488a74da",
    name: "T3 2025",
    billedBy: "Parade",
    status: "Payée",
    invoiceDate: "2025-08-01",
    periodStart: "2025-07-01",
    periodEnd: "2025-09-30",
  },
  {
    contract: "2425d5cd-375f-808c-ad16-fc12488a74da",
    name: "T4 2025",
    billedBy: "Parade",
    status: "Payée",
    invoiceDate: "2025-10-06",
    periodStart: "2025-10-01",
    periodEnd: "2025-12-31",
  },
  {
    contract: "2425d5cd-375f-808c-ad16-fc12488a74da",
    name: "T1 2026",
    billedBy: "Parade",
    status: "Payée",
    invoiceDate: "2026-01-12",
    periodStart: "2026-01-01",
    periodEnd: "2026-03-31",
  },
  // Yoann
  {
    contract: "2425d5cd-375f-806e-beb2-cf88d56d4f0b",
    name: "T3 2025",
    billedBy: "Parade",
    status: "Payée",
    invoiceDate: "2025-08-01",
    periodStart: "2025-07-01",
    periodEnd: "2025-09-30",
  },
  {
    contract: "2425d5cd-375f-806e-beb2-cf88d56d4f0b",
    name: "T4 2025",
    billedBy: "Parade",
    status: "Payée",
    invoiceDate: "2025-10-06",
    periodStart: "2025-10-01",
    periodEnd: "2025-12-31",
  },
  {
    contract: "2425d5cd-375f-806e-beb2-cf88d56d4f0b",
    name: "T1 2026",
    billedBy: "Parade",
    status: "Payée",
    invoiceDate: "2026-01-12",
    periodStart: "2026-01-01",
    periodEnd: "2026-03-31",
  },
  {
    contract: "2425d5cd-375f-806e-beb2-cf88d56d4f0b",
    name: "avril 2026",
    billedBy: "Parade",
    status: "Facture envoyé",
    invoiceDate: "2026-01-12",
    periodStart: "2026-04-01",
    periodEnd: "2026-04-30",
  },
  // Bénédicte
  {
    contract: "3585d5cd-375f-8072-96fa-f2a165adfbea",
    name: "MaiJuil2026",
    billedBy: "Parade",
    status: "Payée",
    invoiceDate: "2026-05-06",
    periodStart: "2026-05-01",
    periodEnd: "2026-07-31",
  },
  // Webedia
  {
    contract: "2425d5cd-375f-80e8-b68d-d912642b4391",
    name: "T2 2025",
    billedBy: "G&O",
    status: "Payée",
    invoiceDate: "2025-04-10",
    periodStart: "2025-04-01",
    periodEnd: "2025-06-30",
  },
  {
    contract: "2425d5cd-375f-80e8-b68d-d912642b4391",
    name: "T3 2025",
    billedBy: "G&O",
    status: "Payée",
    invoiceDate: "2025-07-18",
    periodStart: "2025-07-01",
    periodEnd: "2025-09-30",
  },
  {
    contract: "2425d5cd-375f-80e8-b68d-d912642b4391",
    name: "T4 2025",
    billedBy: "G&O",
    status: "Payée",
    invoiceDate: "2025-09-30",
    periodStart: "2025-10-01",
    periodEnd: "2025-12-31",
  },
  {
    contract: "2425d5cd-375f-80e8-b68d-d912642b4391",
    name: "T1 2026",
    billedBy: "G&O",
    status: "Payée",
    invoiceDate: "2025-12-17",
    periodStart: "2026-01-01",
    periodEnd: "2026-03-31",
  },
  {
    contract: "2425d5cd-375f-80e8-b68d-d912642b4391",
    name: "T2 2026",
    billedBy: "G&O",
    status: "Facture envoyé",
    invoiceDate: "2026-03-30",
    periodStart: "2026-04-01",
    periodEnd: "2026-06-30",
  },
  // Brioche
  {
    contract: "2425d5cd-375f-805c-8833-edcc19a34a20",
    name: "SeptNov 2025",
    billedBy: "Parade",
    status: "Payée",
    invoiceDate: "2025-09-03",
    periodStart: "2025-09-01",
    periodEnd: "2025-11-30",
  },
  {
    contract: "2425d5cd-375f-805c-8833-edcc19a34a20",
    name: "Dec2025Fev2026",
    billedBy: "Parade",
    status: "Payée",
    invoiceDate: "2025-12-05",
    periodStart: "2025-12-01",
    periodEnd: "2026-02-28",
  },
  {
    contract: "2425d5cd-375f-805c-8833-edcc19a34a20",
    name: "Mars2026Mai2026",
    billedBy: "Parade",
    status: "Payée",
    invoiceDate: "2026-02-26",
    periodStart: "2026-03-01",
    periodEnd: "2026-05-31",
  },
  // Boots & Cats
  {
    contract: "2425d5cd-375f-800e-b5a1-dbdc59960d70",
    name: "T1 2024",
    billedBy: "G&O",
    status: "Payée",
    invoiceDate: "2024-07-05",
    periodStart: "2024-01-01",
    periodEnd: "2024-03-31",
  },
  // Louis-Rémi
  {
    contract: "2425d5cd-375f-8092-aa04-d545947ee597",
    name: "T1 2024",
    billedBy: "G&O",
    status: "Payée",
    invoiceDate: "2024-07-05",
    periodStart: "2024-01-01",
    periodEnd: "2024-03-31",
  },
  {
    contract: "2425d5cd-375f-8092-aa04-d545947ee597",
    name: "T2 2024",
    billedBy: "G&O",
    status: "Payée",
    invoiceDate: "2024-09-25",
    periodStart: "2024-04-01",
    periodEnd: "2024-06-30",
  },
  {
    contract: "2425d5cd-375f-8092-aa04-d545947ee597",
    name: "T3 2024",
    billedBy: "G&O",
    status: "Payée",
    invoiceDate: "2024-09-25",
    periodStart: "2024-07-01",
    periodEnd: "2024-09-30",
  },
  {
    contract: "2425d5cd-375f-8092-aa04-d545947ee597",
    name: "T4 2024",
    billedBy: "G&O",
    status: "Payée",
    invoiceDate: "2024-09-25",
    periodStart: "2024-10-01",
    periodEnd: "2024-12-31",
  },
  {
    contract: "2425d5cd-375f-8092-aa04-d545947ee597",
    name: "T1 2025",
    billedBy: "G&O",
    status: "Payée",
    invoiceDate: "2025-01-07",
    periodStart: "2025-01-01",
    periodEnd: "2025-03-31",
  },
  {
    contract: "2425d5cd-375f-8092-aa04-d545947ee597",
    name: "T2 2025",
    billedBy: "G&O",
    status: "Payée",
    invoiceDate: "2025-05-16",
    periodStart: "2025-04-01",
    periodEnd: "2025-06-30",
  },
  {
    contract: "2425d5cd-375f-8092-aa04-d545947ee597",
    name: "T3 2025",
    billedBy: "Parade",
    status: "Payée",
    invoiceDate: "2025-08-01",
    periodStart: "2025-07-01",
    periodEnd: "2025-09-30",
  },
  {
    contract: "2425d5cd-375f-8092-aa04-d545947ee597",
    name: "T4 2025",
    billedBy: "Parade",
    status: "Payée",
    invoiceDate: "2025-10-06",
    periodStart: "2025-10-01",
    periodEnd: "2025-12-31",
  },
  {
    contract: "2425d5cd-375f-8092-aa04-d545947ee597",
    name: "T1 2026",
    billedBy: "Parade",
    status: "Payée",
    invoiceDate: "2026-01-12",
    periodStart: "2026-01-01",
    periodEnd: "2026-03-31",
  },
  {
    contract: "2425d5cd-375f-8092-aa04-d545947ee597",
    name: "T2 2026",
    billedBy: "Parade",
    status: "Payée",
    invoiceDate: "2026-01-12",
    periodStart: "2026-04-01",
    periodEnd: "2026-06-30",
  },
  // Webedia OLD
  {
    contract: "2425d5cd-375f-800d-8d28-ffa0228780f5",
    name: "T4 2023",
    billedBy: "G&O",
    status: "Payée",
    invoiceDate: "2024-05-20",
    periodStart: "2023-10-01",
    periodEnd: "2023-12-31",
  },
  {
    contract: "2425d5cd-375f-800d-8d28-ffa0228780f5",
    name: "T1 2024",
    billedBy: "G&O",
    status: "Payée",
    invoiceDate: "2024-05-20",
    periodStart: "2024-01-01",
    periodEnd: "2024-03-31",
  },
  {
    contract: "2425d5cd-375f-800d-8d28-ffa0228780f5",
    name: "T2 2024",
    billedBy: "G&O",
    status: "Payée",
    invoiceDate: "2024-05-20",
    periodStart: "2024-04-01",
    periodEnd: "2024-06-30",
  },
  {
    contract: "2425d5cd-375f-800d-8d28-ffa0228780f5",
    name: "T3 2024",
    billedBy: "G&O",
    status: "Payée",
    invoiceDate: "2024-07-05",
    periodStart: "2024-07-01",
    periodEnd: "2024-09-30",
  },
  {
    contract: "2425d5cd-375f-800d-8d28-ffa0228780f5",
    name: "T4 2024",
    billedBy: "G&O",
    status: "Payée",
    invoiceDate: "2024-10-10",
    periodStart: "2024-10-01",
    periodEnd: "2024-12-31",
  },
  {
    contract: "2425d5cd-375f-800d-8d28-ffa0228780f5",
    name: "T1 2025",
    billedBy: "G&O",
    status: "Payée",
    invoiceDate: "2026-01-07",
    periodStart: "2025-01-01",
    periodEnd: "2025-03-31",
  },
];

// ---------- Import ----------

async function main() {
  const [{ count: existingContracts }] = await sql`
    select count(*)::int as count from public.coworking_contracts
  `;
  if (existingContracts > 0) {
    throw new Error(
      `Refus d'importer : ${existingContracts} contrats coworking existent déjà. Vide la table d'abord si tu veux ré-importer.`,
    );
  }

  // 1. Contacts (idempotent : check par firstName/lastName)
  const contactIdByCoworker = {};
  for (const [notionId, c] of Object.entries(COWORKERS)) {
    const [existing] = await sql`
      select id from public.contacts
      where first_name = ${c.firstName} and last_name = ${c.lastName}
      limit 1
    `;
    if (existing) {
      contactIdByCoworker[notionId] = existing.id;
      // Met à jour la qualif si pas déjà coworker
      await sql`
        update public.contacts
        set qualification = 'coworker'
        where id = ${existing.id} and (qualification is null or qualification != 'coworker')
      `;
      console.log(`  contact existant : ${c.firstName} ${c.lastName} → ${existing.id}`);
    } else {
      const [row] = await sql`
        insert into public.contacts (first_name, last_name, qualification)
        values (${c.firstName}, ${c.lastName}, 'coworker')
        returning id
      `;
      contactIdByCoworker[notionId] = row.id;
      console.log(`  contact créé    : ${c.firstName} ${c.lastName} → ${row.id}`);
    }
  }

  // 2. Contrats
  const contractIdByNotion = {};
  for (const [notionId, c] of Object.entries(CONTRACTS)) {
    const [row] = await sql`
      insert into public.coworking_contracts
        (name, contact_id, start_date, end_date, desks, unit_price_ht, status)
      values
        (${c.name}, ${contactIdByCoworker[c.coworker]}, ${c.startDate}, ${c.endDate},
         ${c.desks}, ${c.unitPriceHt}, ${c.status})
      returning id
    `;
    contractIdByNotion[notionId] = row.id;
    console.log(`  contrat         : ${c.name} → ${row.id}`);
  }

  // 3. Factures (snapshot desks/prix depuis le contrat)
  let invoiceCount = 0;
  for (const inv of INVOICES) {
    const ct = CONTRACTS[inv.contract];
    if (!ct) {
      console.warn(`  ⚠ facture orpheline (contrat introuvable) : ${inv.name}`);
      continue;
    }
    await sql`
      insert into public.coworking_invoices
        (contract_id, name, invoice_date, period_start, period_end, status, billed_by,
         desks, unit_price_ht, vat_rate)
      values
        (${contractIdByNotion[inv.contract]}, ${inv.name}, ${inv.invoiceDate ?? null},
         ${inv.periodStart}, ${inv.periodEnd}, ${STATUS_MAP[inv.status]},
         ${BILLED_BY_MAP[inv.billedBy]}, ${ct.desks}, ${ct.unitPriceHt}, '0.2')
    `;
    invoiceCount++;
  }
  console.log(`  ${invoiceCount} factures créées`);

  console.log(
    `\nOK. ${Object.keys(COWORKERS).length} coworkers, ${Object.keys(CONTRACTS).length} contrats, ${invoiceCount} factures importés.`,
  );
}

main()
  .catch((err) => {
    console.error("Échec :", err);
    process.exitCode = 1;
  })
  .finally(() => sql.end({ timeout: 5 }));
