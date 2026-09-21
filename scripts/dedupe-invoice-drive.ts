/**
 * Nettoyage des doublons laissés dans le Drive de classement des
 * factures, avant le correctif de `normalizeSupplierKey` (formes
 * juridiques internationales) et du garde-fou par hash de PDF.
 *
 * Deux nettoyages, dans cet ordre :
 *   1. Fusion des dossiers fournisseurs qui partagent la même clé
 *      normalisée ("ElevenLabs" + "ElevenLabsInc") : on garde le plus
 *      ancien, on y déplace les fichiers des autres, on met le dossier
 *      vidé à la corbeille.
 *   2. Corbeille des fichiers identiques au md5 près à l'intérieur d'un
 *      même dossier fournisseur — jamais entre deux dossiers, où la même
 *      pièce signale un désaccord de classement à arbitrer, pas un
 *      doublon à supprimer. Ces cas-là sont seulement listés.
 *
 * En dry-run, la passe 2 voit le Drive d'avant fusion : elle annonce donc
 * moins de corbeille que l'exécution réelle, où les fichiers fusionnés
 * se retrouvent côte à côte.
 *
 * Portée : le scope OAuth est `drive.file`. L'app ne peut déplacer ou
 * mettre à la corbeille que ce qu'elle a créé elle-même — les pièces
 * déposées à la main ou par l'ancienne automatisation sont lisibles mais
 * pas modifiables. Elles sont signalées « hors portée » et laissées en
 * place ; c'est la raison pour laquelle on fusionne toujours VERS le
 * dossier historique.
 *
 * Les lignes `invoice_filings` qui pointaient sur un fichier mis à la
 * corbeille repassent en `rejected` (elles ne désignent plus rien) et
 * celles dont le dossier a fusionné sont réécrites.
 *
 * Usage :
 *   tsx scripts/dedupe-invoice-drive.ts                 # dry-run, tout
 *   tsx scripts/dedupe-invoice-drive.ts --apply         # applique
 *   tsx scripts/dedupe-invoice-drive.ts --year 2026     # une année
 *   tsx scripts/dedupe-invoice-drive.ts --supplier elevenlabs
 */
import { createDecipheriv } from "node:crypto";
import { config as loadEnv } from "dotenv";
import postgres from "postgres";
import { normalizeSupplierKey } from "../lib/gmail/supplier-key";

loadEnv({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
const YEAR = argValue("--year");
const SUPPLIER = argValue("--supplier");

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

const FOLDER_MIME = "application/vnd.google-apps.folder";
const SHARED = "supportsAllDrives=true&includeItemsFromAllDrives=true";

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  md5Checksum?: string;
  createdTime: string;
};

/**
 * Entre deux copies identiques, on garde celle qui porte le nom le plus
 * exploitable : nomenclature `AAMMJJ_facture_…` d'abord, extension .pdf
 * ensuite, la plus ancienne enfin.
 */
function byKeepPreference(a: DriveFile, b: DriveFile): number {
  const score = (f: DriveFile) =>
    (/^\d{6}_[Ff]acture/.test(f.name) ? 2 : 0) + (f.name.toLowerCase().endsWith(".pdf") ? 1 : 0);
  return score(b) - score(a) || a.createdTime.localeCompare(b.createdTime);
}

function decryptSecret(blob: string): string {
  const [version, ivPart, tagPart, encPart] = blob.split(":");
  if (version !== "v1" || !ivPart || !tagPart || !encPart) throw new Error("secret invalide");
  const key = Buffer.from(process.env.SECRETS_ENC_KEY ?? "", "base64");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(ivPart, "base64url"));
  d.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([d.update(Buffer.from(encPart, "base64url")), d.final()]).toString("utf8");
}

async function main() {
  const sql = postgres(process.env.DATABASE_URL ?? "", {
    prepare: false,
    max: 1,
    onnotice: () => {},
  });

  // Avec `drive.file`, l'autorisation est accordée par utilisateur ET par
  // fichier : un fichier déposé par le compte A n'est pas modifiable avec
  // le token du compte B, même si les deux voient le dossier. On récupère
  // donc un token par compte connecté et on réessaie l'écriture avec
  // chacun avant de conclure « hors portée ».
  const accounts = await sql`
    select email, refresh_token_enc from google_accounts where revoked_at is null
  `;
  if (accounts.length === 0) throw new Error("Aucun compte Google connecté.");

  const tokens: Array<{ email: string; accessToken: string }> = [];
  for (const account of accounts) {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
        client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "",
        refresh_token: decryptSecret(account.refresh_token_enc),
        grant_type: "refresh_token",
      }),
    });
    const token = (await tokenRes.json()) as { access_token?: string };
    if (!token.access_token) {
      console.warn(`Refresh Google échoué pour ${account.email}, compte ignoré.`);
      continue;
    }
    tokens.push({ email: account.email, accessToken: token.access_token });
  }
  if (tokens.length === 0) throw new Error("Aucun token Google exploitable.");
  console.info(`Comptes Google : ${tokens.map((t) => t.email).join(", ")}`);
  const accessToken = tokens[0]?.accessToken ?? "";

  const [rootSetting] = await sql`
    select value from app_settings where key = 'INVOICE_FILING_ROOT_FOLDER_ID'
  `;
  const rootId = String(rootSetting?.value ?? "");
  if (!rootId) throw new Error("INVOICE_FILING_ROOT_FOLDER_ID absent de app_settings.");

  async function drive<T>(path: string, init?: RequestInit, token = accessToken): Promise<T> {
    const res = await fetch(`https://www.googleapis.com/drive/v3${path}`, {
      ...init,
      headers: { ...init?.headers, authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Drive ${res.status} : ${await res.text()}`);
    return (await res.json()) as T;
  }

  const children = async (id: string): Promise<DriveFile[]> => {
    const q = encodeURIComponent(`'${id}' in parents and trashed = false`);
    const fields = encodeURIComponent("files(id,name,mimeType,size,md5Checksum,createdTime)");
    const data = await drive<{ files?: DriveFile[] }>(
      `/files?q=${q}&fields=${fields}&pageSize=1000&${SHARED}&corpora=allDrives`,
    );
    return data.files ?? [];
  };

  const moveFile = (fileId: string, from: string, to: string, token: string) =>
    drive(
      `/files/${fileId}?addParents=${to}&removeParents=${from}&fields=id&${SHARED}`,
      { method: "PATCH" },
      token,
    );

  const trash = (fileId: string, token: string) =>
    drive(
      `/files/${fileId}?fields=id&${SHARED}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trashed: true }),
      },
      token,
    );

  /**
   * Tente l'écriture avec chaque compte connecté. Faux seulement si
   * aucun ne détient le fichier — déposé à la main ou par l'ancienne
   * automatisation, donc hors de portée de `drive.file`.
   */
  async function tryWrite(label: string, fn: (token: string) => Promise<unknown>) {
    for (const { accessToken: token } of tokens) {
      try {
        await fn(token);
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const denied =
          msg.includes("appNotAuthorizedToFile") || msg.includes("insufficientFilePermissions");
        if (!denied) throw err;
      }
    }
    console.info(`   ⊘ hors portée (créé hors de l'app) : ${label}`);
    outOfScope++;
    return false;
  }

  let movedFiles = 0;
  let trashedFolders = 0;
  let trashedFiles = 0;
  let crossFolder = 0;
  let outOfScope = 0;

  const years = (await children(rootId)).filter((f) => f.mimeType === FOLDER_MIME);
  for (const year of years) {
    if (YEAR && year.name !== YEAR) continue;

    // ── 1. Fusion des dossiers fournisseurs à clé identique ───────────
    const suppliers = (await children(year.id)).filter((f) => f.mimeType === FOLDER_MIME);
    const byKey = new Map<string, DriveFile[]>();
    for (const folder of suppliers) {
      const key = normalizeSupplierKey(folder.name);
      if (!key) continue;
      byKey.set(key, [...(byKey.get(key) ?? []), folder]);
    }

    for (const [key, folders] of byKey) {
      if (folders.length < 2) continue;
      if (SUPPLIER && key !== SUPPLIER) continue;
      // On garde le dossier historique : il contient les pièces d'avant
      // Parade OS, que le scope `drive.file` interdit de déplacer. À
      // ancienneté égale, le nom le plus court (nom d'usage).
      const [keep, ...merge] = [...folders].sort(
        (a, b) => a.createdTime.localeCompare(b.createdTime) || a.name.length - b.name.length,
      );
      if (!keep) continue;
      console.info(
        `\n${year.name} — fusion [${key}] : ${merge.map((f) => `"${f.name}"`).join(", ")} → "${keep.name}"`,
      );
      for (const folder of merge) {
        let leftBehind = 0;
        for (const file of await children(folder.id)) {
          console.info(`   déplace ${file.name}`);
          if (
            APPLY &&
            !(await tryWrite(file.name, (token) => moveFile(file.id, folder.id, keep.id, token)))
          ) {
            leftBehind++;
            continue;
          }
          movedFiles++;
        }
        if (leftBehind > 0) {
          console.info(
            `   dossier "${folder.name}" conservé : ${leftBehind} fichier(s) hors portée`,
          );
          continue;
        }
        console.info(`   corbeille dossier vidé "${folder.name}"`);
        if (APPLY) {
          if (!(await tryWrite(folder.name, (token) => trash(folder.id, token)))) continue;
          await sql`
            update invoice_filings set drive_supplier_folder_id = ${keep.id}
            where drive_supplier_folder_id = ${folder.id}
          `;
        }
        trashedFolders++;
      }
    }

    // ── 2. Fichiers identiques (md5) DANS UN MÊME dossier ─────────────
    // On ne déduplique jamais entre deux dossiers fournisseurs distincts :
    // la même pièce rangée sous "stripe" et sous "Suno" n'est pas un
    // doublon mécanique, c'est un désaccord de classement — la corbeille
    // emporterait parfois la copie la mieux rangée. Ces cas sont listés
    // en fin de passe pour arbitrage manuel.
    const suppliersAfter = (await children(year.id)).filter((f) => f.mimeType === FOLDER_MIME);
    const md5Folders = new Map<string, Set<string>>();

    for (const folder of suppliersAfter) {
      if (SUPPLIER && normalizeSupplierKey(folder.name) !== SUPPLIER) continue;
      const byMd5 = new Map<string, DriveFile[]>();
      for (const file of await children(folder.id)) {
        // Les fichiers vides (md5 d41d8cd9…) sont des résidus de sync
        // Drive Desktop, pas des doublons de classement : on n'y touche pas.
        if (file.mimeType === FOLDER_MIME || !file.md5Checksum || file.size === "0") continue;
        byMd5.set(file.md5Checksum, [...(byMd5.get(file.md5Checksum) ?? []), file]);
        md5Folders.set(
          file.md5Checksum,
          (md5Folders.get(file.md5Checksum) ?? new Set()).add(folder.name),
        );
      }

      for (const [md5, files] of byMd5) {
        if (files.length < 2) continue;
        const [keep, ...dups] = [...files].sort(byKeepPreference);
        if (!keep) continue;
        console.info(
          `\n${year.name}/${folder.name} — même PDF (${md5.slice(0, 8)}) : garde ${keep.name}`,
        );
        for (const dup of dups) {
          console.info(`   corbeille ${dup.name}`);
          if (APPLY) {
            if (!(await tryWrite(dup.name, (token) => trash(dup.id, token)))) continue;
            await sql`
              update invoice_filings
              set status = 'rejected',
                  error_message = 'doublon — fichier retiré du Drive au nettoyage',
                  drive_file_id = null
              where drive_file_id = ${dup.id}
            `;
          }
          trashedFiles++;
        }
      }
    }

    for (const [md5, folders] of md5Folders) {
      if (folders.size < 2) continue;
      console.info(
        `\n${year.name} — ⓘ même PDF (${md5.slice(0, 8)}) dans ${[...folders].map((f) => `"${f}"`).join(" et ")} : à arbitrer à la main, rien de supprimé.`,
      );
      crossFolder++;
    }
  }

  console.info(
    `\n${APPLY ? "Appliqué" : "Dry-run"} : ${movedFiles} fichiers déplacés, ${trashedFolders} dossiers fusionnés, ${trashedFiles} fichiers mis à la corbeille, ${crossFolder} cas inter-dossiers laissés à arbitrer, ${outOfScope} éléments hors portée de l'app.`,
  );
  if (!APPLY) console.info("Rejoue avec --apply pour exécuter.");
  await sql.end({ timeout: 5 });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
