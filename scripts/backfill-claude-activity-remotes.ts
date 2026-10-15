/**
 * Complète le dépôt (`remote`) des segments Claude Code arrivés sans rien :
 * sessions d'avant le 15/10/2026 dans un dossier sans git, et créneaux
 * hérités convertis par la migration 0088.
 *
 * Le journal local de Claude Code (~/.claude/projects/<slug>/<session>.jsonl)
 * donne le `cwd` de chaque session ; on en tire le remote `origin` si c'est
 * un dépôt git, sinon la clé `local/<dossier>`. Puis même circuit que le
 * push : rattachement automatique si un seul projet ouvert porte le nom.
 *
 * Dry-run par défaut. `--commit` pour écrire. À lancer sur la machine qui a
 * ouvert les sessions.
 *
 * Usage : pnpm exec tsx scripts/backfill-claude-activity-remotes.ts [--commit]
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import { and, eq, isNull } from "drizzle-orm";
import { claudeCodeActivity } from "../db/schema/claude-activity";
import { localRepoKey, normalizeGitRemote } from "../lib/git/remote";
import { decideAutoLink, linkRemote, suggestProjects } from "../lib/repos/link";
import { closeDb, db } from "../mcp-server/db";

loadEnv({ path: ".env.local" });
const commit = process.argv.includes("--commit");

function findSessionFile(sessionId: string): string | null {
  const root = join(homedir(), ".claude", "projects");
  for (const dir of readdirSync(root)) {
    const file = join(root, dir, `${sessionId}.jsonl`);
    try {
      if (statSync(file).isFile()) return file;
    } catch {}
  }
  return null;
}

function cwdOf(file: string): string | null {
  const head = readFileSync(file, "utf8").slice(0, 200_000);
  const m = /"cwd":"([^"]+)"/.exec(head);
  return m?.[1] ?? null;
}

function repoKeyFor(cwd: string): string | null {
  try {
    const url = execFileSync("git", ["-C", cwd, "remote", "get-url", "origin"], {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    const key = normalizeGitRemote(url);
    if (key) return key;
  } catch {}
  return localRepoKey(cwd);
}

async function main() {
  const conn = db();
  const rows = await conn
    .select({
      id: claudeCodeActivity.id,
      userId: claudeCodeActivity.userId,
      sourceRef: claudeCodeActivity.sourceRef,
      projectId: claudeCodeActivity.projectId,
    })
    .from(claudeCodeActivity)
    .where(isNull(claudeCodeActivity.remote));
  console.info(`${rows.length} segment(s) sans dépôt.`);

  const keyBySession = new Map<string, string | null>();
  const plan: { id: string; sourceRef: string; key: string; userId: string }[] = [];
  for (const r of rows) {
    const sessionId = r.sourceRef.split(":")[0] ?? "";
    if (!keyBySession.has(sessionId)) {
      const file = findSessionFile(sessionId);
      const cwd = file ? cwdOf(file) : null;
      keyBySession.set(sessionId, cwd ? repoKeyFor(cwd) : null);
    }
    const key = keyBySession.get(sessionId) ?? null;
    if (key) plan.push({ id: r.id, sourceRef: r.sourceRef, key, userId: r.userId });
    else console.warn(`  ? ${r.sourceRef} : session introuvable sur cette machine`);
  }

  const byKey = new Map<string, number>();
  for (const p of plan) byKey.set(p.key, (byKey.get(p.key) ?? 0) + 1);
  for (const [key, n] of byKey) {
    const picked = decideAutoLink(await suggestProjects(conn, key));
    console.info(
      `  ${key} : ${n} segment(s)` +
        (picked ? ` → ${picked.name}` : " → aucun projet net, à rattacher dans /temps"),
    );
  }
  if (!commit) {
    console.info("Dry-run. Relance avec --commit pour écrire.");
    return;
  }

  for (const p of plan) {
    await conn
      .update(claudeCodeActivity)
      .set({ remote: p.key, updatedAt: new Date() })
      .where(and(eq(claudeCodeActivity.id, p.id), isNull(claudeCodeActivity.remote)));
  }
  for (const key of byKey.keys()) {
    const picked = decideAutoLink(await suggestProjects(conn, key));
    if (!picked) continue;
    const userId = plan.find((p) => p.key === key)?.userId ?? null;
    const res = await linkRemote(conn, { remote: key, projectId: picked.id, userId, auto: true });
    console.info(`  rattaché ${key} → ${picked.name} (${res.backfilled} imputés)`);
  }
  console.info("OK.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
