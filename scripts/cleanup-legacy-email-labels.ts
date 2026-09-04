/**
 * One-shot : purge les libellés Paradeos devenus sans objet après le
 * passage du tagging email au modèle « liaisons » (cf. migration 0015).
 *
 * Trois familles :
 *   1. catégories libres ("Compta", "Annexe"…) — la taxonomie libre
 *      n'existe plus ; seules survivent les deux catégories système
 *      (Facture achat / Facture vente), dérivées d'`invoice_filings`.
 *   2. libellés projet/entité orphelins — le record CRM pointé par
 *      `target_id` a été supprimé depuis.
 *   3. labels `Paradeos/…` présents dans Gmail qu'aucune ligne
 *      `gmail_tags` ne référence — plus rien ne les pose ni ne les lit.
 *
 * Pour 1 et 2 : suppression du label côté Gmail (il disparaît donc aussi
 * des threads dans Gmail), puis de la ligne `gmail_tags` — les liaisons
 * `gmail_thread_tags` partent en cascade. Pour 3 : suppression côté Gmail
 * uniquement, il n'y a rien en base.
 *
 * ⚠ Un label Gmail dont le NOM est inconnu de la base n'est pas pour
 * autant obsolète : quand un projet/entité est renommé, `ensureCrmLabel`
 * met à jour `label_name` sans renommer le label Gmail. On identifie donc
 * un orphelin par son ID, jamais par son nom — et ces désynchronisés sont
 * renommés côté Gmail au lieu d'être supprimés.
 *
 * Dry-run par défaut. Rien n'est supprimé sans `--apply`.
 *
 * Usage : pnpm tsx scripts/cleanup-legacy-email-labels.ts [--apply]
 */
import { createDecipheriv } from "node:crypto";
import { config as loadEnv } from "dotenv";
import postgres from "postgres";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const APPLY = process.argv.includes("--apply");

/** Les seules catégories qui gardent un sens : elles projettent un fait. */
const SYSTEM_CATEGORY_LABELS = ["Paradeos/Facture achat", "Paradeos/Facture vente"];

type LabelRow = {
  id: string;
  user_id: string;
  kind: string;
  label_name: string;
  gmail_label_id: string | null;
  threads: number;
  reason: string;
};

/**
 * Réplique de `decryptSecret` (lib/crypto/secrets.ts) : ce module importe
 * `server-only`, donc inutilisable depuis un script Node.
 */
function decryptSecret(blob: string): string {
  const raw = process.env.SECRETS_ENC_KEY;
  if (!raw) throw new Error("SECRETS_ENC_KEY manquant.");
  const key = Buffer.from(raw, "base64");
  const [version, ivPart, tagPart, encPart] = blob.split(":");
  if (version !== "v1" || !ivPart || !tagPart || !encPart) {
    throw new Error("Format de secret invalide.");
  }
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

const ALGO = "aes-256-gcm";

async function accessTokenFor(refreshTokenEnc: string): Promise<string> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET manquants.");
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: decryptSecret(refreshTokenEnc),
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Refresh token Google échoué (${res.status}) : ${await res.text()}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function listGmailLabels(accessToken: string): Promise<Array<{ id: string; name: string }>> {
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`GET labels → ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { labels?: Array<{ id: string; name: string; type: string }> };
  return (json.labels ?? [])
    .filter((l) => l.type === "user")
    .map((l) => ({ id: l.id, name: l.name }));
}

async function renameGmailLabel(accessToken: string, labelId: string, name: string): Promise<void> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/labels/${encodeURIComponent(labelId)}`,
    {
      method: "PATCH",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ name }),
    },
  );
  if (!res.ok) throw new Error(`PATCH label ${labelId} → ${res.status} ${await res.text()}`);
}

async function deleteGmailLabel(accessToken: string, labelId: string): Promise<"ok" | "absent"> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/labels/${encodeURIComponent(labelId)}`,
    { method: "DELETE", headers: { authorization: `Bearer ${accessToken}` } },
  );
  if (res.ok) return "ok";
  if (res.status === 404) return "absent"; // déjà supprimé côté Gmail
  throw new Error(`DELETE label ${labelId} → ${res.status} ${await res.text()}`);
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL manquant.");
  const sql = postgres(dbUrl, { prepare: false, max: 2, onnotice: () => {} });

  try {
    const rows = await sql<LabelRow[]>`
      select t.id, t.user_id, t.kind, t.label_name, t.gmail_label_id,
             (select count(*)::int from gmail_thread_tags tt where tt.tag_id = t.id) as threads,
             case
               when t.kind = 'category' then 'catégorie libre (taxonomie supprimée)'
               when t.kind = 'project' then 'projet supprimé du CRM'
               else 'entité supprimée du CRM'
             end as reason
      from gmail_tags t
      where (t.kind = 'category' and t.label_name <> all(${SYSTEM_CATEGORY_LABELS}))
         or (t.kind = 'project' and not exists (select 1 from projects p where p.id = t.target_id))
         or (t.kind = 'entity' and not exists (select 1 from entities e where e.id = t.target_id))
      order by t.kind, t.label_name
    `;

    console.log(`Libellés obsolètes en base : ${rows.length}`);
    for (const r of rows) {
      console.log(
        `  ${r.label_name.padEnd(42)} ${String(r.threads).padStart(4)} liaison(s)  ` +
          `${r.gmail_label_id ? "label Gmail présent" : "pas de label Gmail"}  — ${r.reason}`,
      );
    }

    // Un access token par user concerné (en pratique : un seul).
    const tokensByUser = new Map<string, string | null>();
    async function tokenFor(userId: string): Promise<string | null> {
      if (!tokensByUser.has(userId)) {
        const [account] = await sql<{ refresh_token_enc: string }[]>`
          select refresh_token_enc from google_accounts
          where user_id = ${userId} and revoked_at is null limit 1
        `;
        tokensByUser.set(userId, account ? await accessTokenFor(account.refresh_token_enc) : null);
      }
      return tokensByUser.get(userId) ?? null;
    }

    // Côté Gmail : on compare par ID, pas par nom (cf. en-tête).
    const [owner] = await sql<{ user_id: string }[]>`
      select user_id from google_accounts where revoked_at is null order by created_at limit 1
    `;
    const dbLabels = await sql<{ label_name: string; gmail_label_id: string | null }[]>`
      select label_name, gmail_label_id from gmail_tags where gmail_label_id is not null
    `;
    const nameByGmailId = new Map(dbLabels.map((r) => [r.gmail_label_id as string, r.label_name]));
    const doomedGmailIds = new Set(
      rows.map((r) => r.gmail_label_id).filter((id): id is string => !!id),
    );

    const orphans: Array<{ id: string; name: string }> = [];
    const desynced: Array<{ id: string; from: string; to: string }> = [];
    if (owner) {
      const token = await tokenFor(owner.user_id);
      if (token) {
        for (const l of await listGmailLabels(token)) {
          if (!l.name.startsWith("Paradeos/") || doomedGmailIds.has(l.id)) continue;
          const expected = nameByGmailId.get(l.id);
          if (!expected) orphans.push(l);
          else if (expected !== l.name) desynced.push({ id: l.id, from: l.name, to: expected });
        }
      }
    }

    console.log(
      `\nLabels Gmail « Paradeos/… » que plus aucune ligne ne référence : ${orphans.length}`,
    );
    for (const o of orphans) console.log(`  ${o.name}`);
    console.log(`\nLabels Gmail désynchronisés (record renommé) : ${desynced.length}`);
    for (const d of desynced) console.log(`  ${d.from}\n    → ${d.to}`);

    if (rows.length === 0 && orphans.length === 0 && desynced.length === 0) {
      console.log("\nRien à faire.");
      return;
    }

    if (!APPLY) {
      console.log("\nDry-run. Relance avec --apply pour supprimer (Gmail + base).");
      return;
    }
    let gmailDeleted = 0;
    let gmailAbsent = 0;
    let dbDeleted = 0;
    let renamed = 0;

    for (const r of rows) {
      if (r.gmail_label_id) {
        const token = await tokenFor(r.user_id);
        if (!token) {
          console.warn(`  ! ${r.label_name} : pas de compte Google — label Gmail laissé en place.`);
        } else {
          const outcome = await deleteGmailLabel(token, r.gmail_label_id);
          if (outcome === "ok") gmailDeleted++;
          else gmailAbsent++;
        }
      }
      await sql`delete from gmail_tags where id = ${r.id}`;
      dbDeleted++;
    }

    const ownerToken = owner ? await tokenFor(owner.user_id) : null;
    if (ownerToken) {
      for (const o of orphans) {
        const outcome = await deleteGmailLabel(ownerToken, o.id);
        if (outcome === "ok") gmailDeleted++;
        else gmailAbsent++;
      }
      for (const d of desynced) {
        await renameGmailLabel(ownerToken, d.id, d.to);
        renamed++;
      }
    }

    console.log(
      `\nSupprimé : ${dbDeleted} libellé(s) en base · ${gmailDeleted} label(s) Gmail` +
        `${gmailAbsent > 0 ? ` (${gmailAbsent} déjà absent(s))` : ""}` +
        `${renamed > 0 ? ` · ${renamed} label(s) Gmail resynchronisé(s)` : ""}.`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
