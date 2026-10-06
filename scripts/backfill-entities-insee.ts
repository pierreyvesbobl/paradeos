/**
 * Complète les entités depuis l'annuaire des entreprises (INSEE Sirene + RNE).
 *
 * En deux temps, parce que le rapprochement par nom se trompe : « Bobl »
 * remonte aussi quatre associations bretonnes. On ne devine pas, on propose.
 *
 *   1. pnpm tsx scripts/backfill-entities-insee.ts
 *      Lecture seule. Interroge l'INSEE pour chaque entité à compléter et
 *      écrit ses propositions dans scripts/tmp/insee-proposals.json.
 *      Un rapprochement n'est retenu d'office que si le matcher maison le
 *      juge *certain* (nom strictement équivalent après normalisation).
 *      Sinon `siren: null` : à toi de choisir dans `candidates`.
 *
 *   2. Relire le JSON, corriger ou compléter les `siren`.
 *
 *   3. pnpm tsx scripts/backfill-entities-insee.ts --apply
 *      Écrit en base. **Ne touche que les champs vides** — rien de ce qui
 *      a été saisi à la main n'est écrasé.
 *
 * `--all` élargit aux entités non clientes (par défaut : kind = 'client').
 */
import { readFileSync, writeFileSync } from "node:fs";
import { config } from "dotenv";
import postgres from "postgres";
import { MATCH_THRESHOLD, pickBestMatch } from "@/lib/crm/pick";
import { type SireneCompany, searchCompanies } from "@/lib/gouv/sirene";

config({ path: ".env.local" });

const PROPOSALS_PATH = "scripts/tmp/insee-proposals.json";

type EntityRow = {
  id: string;
  name: string;
  kind: string;
  siren: string | null;
  siret: string | null;
  vat_number: string | null;
  legal_name: string | null;
  address: { street?: string; postalCode?: string; city?: string; country?: string } | null;
};

type Proposal = {
  entityId: string;
  entityName: string;
  /** SIREN retenu, ou `null` quand le rapprochement demande un arbitrage. */
  siren: string | null;
  confidence: number | null;
  missing: string[];
  candidates: { siren: string; name: string; address: string | null }[];
};

function isAddressEmpty(address: EntityRow["address"]): boolean {
  return !address || !(address.street || address.postalCode || address.city);
}

function missingFields(row: EntityRow): string[] {
  const missing: string[] = [];
  if (!row.siren) missing.push("siren");
  if (!row.siret) missing.push("siret");
  if (!row.vat_number) missing.push("vatNumber");
  if (!row.legal_name) missing.push("legalName");
  if (isAddressEmpty(row.address)) missing.push("address");
  return missing;
}

async function loadRows(sql: postgres.Sql, all: boolean): Promise<EntityRow[]> {
  const rows = all
    ? await sql<EntityRow[]>`select id, name, kind, siren, siret, vat_number, legal_name, address
                             from entities order by name`
    : await sql<EntityRow[]>`select id, name, kind, siren, siret, vat_number, legal_name, address
                             from entities where kind = 'client' order by name`;
  return rows.filter((row) => missingFields(row).length > 0);
}

/** Formes juridiques que l'INSEE n'attend pas dans la recherche plein texte. */
const LEGAL_FORMS =
  /\b(sarl|sasu|sas|sa|eurl|ei|sci|snc|scop|selarl|selas|scp|gie|asso|association)\b/gi;

/**
 * « Boots & Cats SARL » ne remonte rien, « boots cats » remonte la bonne
 * entreprise : la forme juridique et la ponctuation font écran. On tente
 * la requête telle quelle, puis de plus en plus dépouillée.
 */
function queriesFor(name: string): string[] {
  const raw = name.trim();
  const withoutForm = raw.replace(LEGAL_FORMS, " ").replace(/\s+/g, " ").trim();
  const plain = withoutForm
    .replace(/[&.,'’\-_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return [...new Set([raw, withoutForm, plain])].filter((q) => q.length >= 3);
}

/** Première requête qui ramène quelque chose. */
async function searchByName(name: string): Promise<SireneCompany[]> {
  for (const query of queriesFor(name)) {
    const results = await searchCompanies(query, 5);
    if (results.length > 0) return results;
    await new Promise((r) => setTimeout(r, 250));
  }
  return [];
}

async function propose(rows: EntityRow[]): Promise<Proposal[]> {
  const proposals: Proposal[] = [];
  for (const row of rows) {
    // Un SIREN déjà en fiche vaut mieux que n'importe quel rapprochement
    // par nom : on interroge l'INSEE avec lui.
    const results = row.siren ? await searchCompanies(row.siren, 5) : await searchByName(row.name);
    const match = row.siren ? (results.find((c) => c.siren === row.siren) ?? null) : null;
    const picked = match
      ? { siren: match.siren, confidence: 1 }
      : (() => {
          const best = pickBestMatch(
            results.map((c) => ({ id: c.siren, name: c.legalName ?? c.name })),
            row.name,
            MATCH_THRESHOLD.entity,
          );
          // Seul un rapprochement certain est retenu sans arbitrage humain.
          return best && best.confidence >= 1
            ? { siren: best.id, confidence: best.confidence }
            : null;
        })();

    proposals.push({
      entityId: row.id,
      entityName: row.name,
      siren: picked?.siren ?? null,
      confidence: picked?.confidence ?? null,
      missing: missingFields(row),
      candidates: results.map((c) => ({
        siren: c.siren,
        name: c.legalName ?? c.name,
        address: c.addressLabel,
      })),
    });
    // L'API est limitée en débit par IP : on ne la martèle pas.
    await new Promise((r) => setTimeout(r, 250));
  }
  return proposals;
}

function report(proposals: Proposal[]): void {
  for (const p of proposals) {
    const verdict = p.siren ? `→ ${p.siren}` : "→ à arbitrer";
    console.info(`\n${p.entityName}  ${verdict}   (manque : ${p.missing.join(", ")})`);
    for (const c of p.candidates) {
      const mark = c.siren === p.siren ? "✓" : " ";
      console.info(`   ${mark} ${c.siren}  ${c.name}  —  ${c.address ?? "adresse non diffusée"}`);
    }
  }
  const retained = proposals.filter((p) => p.siren).length;
  console.info(
    `\n${proposals.length} entité(s) à compléter, ${retained} rapprochement(s) certain(s), ` +
      `${proposals.length - retained} à arbitrer à la main.`,
  );
}

/** Ne remplit que les trous : la saisie humaine fait foi. */
function patchFor(row: EntityRow, company: SireneCompany): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (!row.siren) patch.siren = company.siren;
  if (!row.siret && company.siret) patch.siret = company.siret;
  if (!row.vat_number && company.vatNumber) patch.vat_number = company.vatNumber;
  if (!row.legal_name && company.legalName) patch.legal_name = company.legalName;
  if (isAddressEmpty(row.address) && company.address) patch.address = company.address;
  return patch;
}

async function apply(sql: postgres.Sql, rows: EntityRow[]): Promise<void> {
  const proposals: Proposal[] = JSON.parse(readFileSync(PROPOSALS_PATH, "utf8"));
  const byId = new Map(rows.map((r) => [r.id, r]));
  let written = 0;

  for (const proposal of proposals) {
    if (!proposal.siren) {
      console.info(`— ${proposal.entityName} : pas de SIREN retenu, ignorée.`);
      continue;
    }
    const row = byId.get(proposal.entityId);
    if (!row) {
      console.info(`— ${proposal.entityName} : déjà complète ou introuvable, ignorée.`);
      continue;
    }
    const [company] = await searchCompanies(proposal.siren, 1);
    if (!company || company.siren !== proposal.siren) {
      console.info(`— ${proposal.entityName} : SIREN ${proposal.siren} introuvable, ignorée.`);
      continue;
    }
    const patch = patchFor(row, company);
    if (Object.keys(patch).length === 0) {
      console.info(`— ${proposal.entityName} : rien à compléter.`);
      continue;
    }
    await sql`update entities set ${sql(patch)}, updated_at = now() where id = ${row.id}`;
    written += 1;
    console.info(`✓ ${proposal.entityName} : ${Object.keys(patch).join(", ")}`);
    await new Promise((r) => setTimeout(r, 250));
  }
  console.info(`\n${written} entité(s) mise(s) à jour.`);
}

async function main() {
  const args = process.argv.slice(2);
  const sql = postgres(process.env.DATABASE_URL ?? "", { prepare: false });
  try {
    const rows = await loadRows(sql, args.includes("--all"));
    if (args.includes("--apply")) {
      await apply(sql, rows);
      return;
    }
    const proposals = await propose(rows);
    writeFileSync(PROPOSALS_PATH, `${JSON.stringify(proposals, null, 2)}\n`);
    report(proposals);
    console.info(`\nPropositions écrites dans ${PROPOSALS_PATH}.`);
    console.info("Relis-les, complète les SIREN manquants, puis relance avec --apply.");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
