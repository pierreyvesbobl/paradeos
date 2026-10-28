/**
 * Mod Claude Code « paradeos-temps » : deux choses, dans les deux sens.
 *
 * 1. Le temps d'attention passé dans une session, poussé dans Parade OS
 *    comme **signal** d'activité (`claude_code_activity`), rattaché au
 *    projet du dépôt git. Ce n'est pas un créneau réalisé : rien n'entre
 *    dans le temps compté ni dans la marge. Le signal dit où est parti
 *    l'effort ; l'humain l'arbitre dans /temps. D'où un mod qui ne demande
 *    jamais rien en pleine session.
 *
 * 2. Ce que la session fait, dans l'autre sens : au démarrage, Parade OS
 *    donne le contexte du dépôt (projet, tâches ouvertes, feuille de
 *    route) et le mod l'ajoute au prompt système avec la consigne de
 *    signaler l'avancement (`report_task_progress`) ; après chaque tour
 *    où un commit a été fait, le mod pousse les derniers commits du dépôt
 *    (`report_commits`), que Parade OS rapproche des tâches.
 *
 * Ce qui part de la machine : des horodatages, le remote git (ou, sans
 * dépôt, le nom du dossier de travail), le numéro de segment ; et, sur
 * un dépôt rattaché à un projet, les sha, sujets, corps, auteurs et dates
 * des derniers commits. Jamais le contenu des échanges ni les fichiers.
 *
 * Les règles de comptage vivent dans tracker.ts (pur, testé). Ici : le
 * branchement sur les événements du moteur, la cadence des envois et
 * l'état persistant. Les helpers qui reçoivent `$` sont des fonctions de
 * premier niveau : c'est ce que le validateur du moteur exige.
 */
import type { EngineInterface, Register } from "claude-code";
import { Tracker, type TrackerState } from "./tracker";

const SERVER = "paradeos";
/** Un segment ouvert n'est renvoyé que s'il a grandi d'au moins ça. */
const PUSH_EVERY_MS = 5 * 60_000;
/** Garde-fou : au-delà, la file de rattrapage jette le plus ancien. */
const MAX_OUTBOX = 200;
const OUTBOX_KEY = "outbox";
/** Commits relus à chaque envoi : assez pour rattraper une séance hors session. */
const COMMITS_PER_PUSH = 20;
const CONTEXT_SECTION_ID = "paradeos-temps:context";

/** Un envoi en attente, indépendant de la session qui l'a produit. */
type Push = {
  sourceRef: string;
  startAt: string;
  endAt: string;
  remote: string | null;
  /** Nom du dossier de travail, envoyé seulement sans remote : un dossier
   * sans git (maquettes, motion design) a quand même un projet. */
  workdir: string | null;
};

type RepoContext = {
  remote: string | null;
  project: { id: string; name: string } | null;
  tasks: {
    id: string;
    title: string;
    kind: string | null;
    status: string;
    priority: string;
    roadmapItem: string | null;
  }[];
  roadmap: {
    path: string;
    items: { id: string; status: string; title: string; taskIds: string[] }[];
  } | null;
  recentCommits: { sha: string; subject: string; date: string }[];
};

type Ctx = {
  enabled: boolean;
  sessionId: string;
  tracker: Tracker | null;
  remote: string | null;
  workdir: string | null;
  server: string | null;
  warnedOffline: boolean;
  /** `end` du segment au dernier envoi réussi, par numéro de segment. */
  pushedEnd: Map<number, number>;
  /** Section ajoutée au prompt système, ou null hors dépôt rattaché. */
  contextText: string | null;
  /** Un `git commit` est passé pendant le tour en cours. */
  commitSeen: boolean;
};

function fmtMs(ms: number): string {
  const min = Math.round(ms / 60_000);
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min`;
}

/** Dernier segment d'un chemin, séparateurs POSIX ou Windows. */
function basename(path: string): string | null {
  const last = path
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .pop();
  return last ? last : null;
}

function stateKey(ctx: Ctx): string {
  return `session:${ctx.sessionId}`;
}

async function connect($: EngineInterface, ctx: Ctx): Promise<string | null> {
  if (ctx.server) return ctx.server;
  const c = await $.mcp.connect(SERVER);
  if (c.isConnected) {
    ctx.server = c.server;
    return ctx.server;
  }
  if (!ctx.warnedOffline) {
    ctx.warnedOffline = true;
    $.ui.toast("Parade OS : serveur « paradeos » non connecté, lance /mcp pour autoriser.");
  }
  return null;
}

/** Le texte du premier bloc d'une réponse MCP, ou vide. */
function firstText(res: { content: readonly { type: string }[] }): string {
  const block = res.content.find((b) => b.type === "text");
  return block && "text" in block ? String((block as { text: unknown }).text) : "";
}

/** Un envoi. `false` = à réessayer plus tard (hors ligne, erreur serveur). */
async function send($: EngineInterface, ctx: Ctx, push: Push): Promise<boolean> {
  const srv = await connect($, ctx);
  if (!srv) return false;
  const res = await $.mcp.call(srv, "track_claude_time", push);
  if (!res.isError) return true;
  const text = firstText(res);
  $.ui.log(`paradeos-temps: track_claude_time a échoué${text ? ` : ${text}` : ""}`, {
    to: "debug",
  });
  return false;
}

/**
 * File de rattrapage, partagée par toutes les sessions de la machine.
 *
 * Sans elle, un segment qu'on n'arrive pas à pousser est perdu pour de
 * bon : `flush` ne regarde que la session courante, donc plus personne ne
 * repasse sur celui d'une session déjà fermée. On y dépose chaque envoi
 * avant de l'essayer, on l'en retire quand il est passé, et on vide la
 * file au démarrage de la session suivante.
 */
async function enqueue($: EngineInterface, pushes: readonly Push[]): Promise<void> {
  if (pushes.length === 0) return;
  const queued = ((await $.store.get(OUTBOX_KEY)) as Push[] | undefined) ?? [];
  const byRef = new Map(queued.map((p) => [p.sourceRef, p]));
  for (const p of pushes) byRef.set(p.sourceRef, p);
  const next = [...byRef.values()].slice(-MAX_OUTBOX);
  await $.store.set(OUTBOX_KEY, next);
}

async function dequeue($: EngineInterface, refs: readonly string[]): Promise<void> {
  if (refs.length === 0) return;
  const queued = ((await $.store.get(OUTBOX_KEY)) as Push[] | undefined) ?? [];
  const drop = new Set(refs);
  await $.store.set(
    OUTBOX_KEY,
    queued.filter((p) => !drop.has(p.sourceRef)),
  );
}

/** Rejoue ce qui n'est jamais passé, y compris d'une session précédente. */
async function drainOutbox($: EngineInterface, ctx: Ctx): Promise<void> {
  const queued = ((await $.store.get(OUTBOX_KEY)) as Push[] | undefined) ?? [];
  if (queued.length === 0) return;
  const done: string[] = [];
  for (const push of queued) {
    if (!(await send($, ctx, push))) break; // hors ligne : on garde le reste
    done.push(push.sourceRef);
  }
  await dequeue($, done);
}

/**
 * Envoie les segments qui le méritent. Un segment fermé part tout de
 * suite ; le segment en cours attend d'avoir grandi de `PUSH_EVERY_MS`,
 * sauf en fin de session (`force`). L'écriture est un upsert par
 * `sourceRef` : le dernier envoi porte la durée finale, donc espacer les
 * envois ne change rien au résultat, seulement le nombre d'appels.
 *
 * Tout ce qui est en attente va dans la file, pas seulement ce qu'on
 * envoie : une session tuée avant ses cinq premières minutes ne laisse
 * sinon aucune trace, et sa fin de session ne s'exécute jamais. La
 * session suivante poussera le segment tel qu'il était.
 */
async function flush($: EngineInterface, ctx: Ctx, force: boolean): Promise<void> {
  const tracker = ctx.tracker;
  if (!tracker) return;
  const currentNo = tracker.currentNo();

  const pending = tracker.pending();
  if (pending.length === 0) return;
  const toPush = (seg: { no: number; start: number; end: number }): Push => ({
    sourceRef: `${ctx.sessionId}:${seg.no}`,
    startAt: new Date(seg.start).toISOString(),
    endAt: new Date(seg.end).toISOString(),
    remote: ctx.remote,
    workdir: ctx.remote ? null : ctx.workdir,
  });
  await enqueue($, pending.map(toPush));

  const due = pending.filter((seg) => {
    if (force || seg.no !== currentNo) return true;
    const since = seg.end - (ctx.pushedEnd.get(seg.no) ?? seg.start);
    return since >= PUSH_EVERY_MS;
  });
  if (due.length === 0) return;

  const done: string[] = [];
  for (const seg of due) {
    const push = toPush(seg);
    if (!(await send($, ctx, push))) break;
    tracker.markFlushed(seg.no);
    ctx.pushedEnd.set(seg.no, seg.end);
    done.push(push.sourceRef);
  }
  await dequeue($, done);
  await $.store.set(stateKey(ctx), tracker.state());

  $.ui.status(`Parade OS · activité ${fmtMs(tracker.totalMs())}`);
}

/**
 * Le texte que le modèle lit sur le projet : ce que Parade OS attend de
 * la session, en français, court. Null si le dépôt n'est rattaché à rien.
 */
function contextSection(c: RepoContext): string | null {
  if (!c.project) return null;
  const lines: string[] = [
    `## Parade OS · projet « ${c.project.name} »`,
    `Ce dépôt est rattaché au projet Parade OS « ${c.project.name} » (id ${c.project.id}). Parade OS y tient les demandes du client (réunions, mails) sous forme de tâches.`,
  ];
  if (c.tasks.length > 0) {
    lines.push("", "Tâches ouvertes du projet (id · type · statut · titre) :");
    for (const t of c.tasks.slice(0, 40)) {
      lines.push(
        `- ${t.id} · ${t.kind ?? "non typée"} · ${t.status} · ${t.title}${
          t.roadmapItem ? ` (item ${t.roadmapItem})` : ""
        }`,
      );
    }
  }
  if (c.roadmap) {
    const orphans = c.roadmap.items.filter(
      (i) => i.taskIds.length === 0 && i.status !== "done" && i.status !== "idea",
    );
    lines.push(
      "",
      `Feuille de route du dépôt : ${c.roadmap.path}. Parade OS la lit à chaque changement : un item « done » clôt les tâches qui lui sont liées. Tiens-la à jour quand tu livres.`,
    );
    if (orphans.length > 0) {
      lines.push(
        `Items en cours sans tâche Parade OS : ${orphans.map((i) => `${i.id} (${i.status}) ${i.title}`).join(" ; ")}.`,
      );
    }
  }
  lines.push(
    "",
    "Consigne : quand tu avances, livres ou bloques une de ces tâches pendant la session, appelle l'outil MCP paradeos `report_task_progress` avec son id, le statut (in_progress, awaiting_client, blocked, done) et une phrase sur ce qui a été fait. Si tu livres quelque chose qui n'est dans aucune tâche, crée-la d'abord avec `create_task` (projectId ci-dessus, kind feature) puis signale-la terminée. Ces appels tiennent Parade OS à jour : fais-les sans demander, en fin de tâche, pas à chaque fichier.",
  );
  return lines.join("\n");
}

/** Demande le contexte du dépôt à Parade OS ; silencieux en cas d'échec. */
async function loadContext($: EngineInterface, ctx: Ctx): Promise<void> {
  if (!ctx.remote) return;
  const srv = await connect($, ctx);
  if (!srv) return;
  const res = await $.mcp.call(srv, "repo_context", { remote: ctx.remote });
  if (res.isError) return;
  try {
    const parsed = JSON.parse(firstText(res)) as RepoContext;
    ctx.contextText = contextSection(parsed);
  } catch (err) {
    $.ui.log(`paradeos-temps: repo_context illisible ${String(err)}`, { to: "debug" });
  }
}

type GitCommit = {
  sha: string;
  author: string;
  committedAt: string;
  subject: string;
  body: string | null;
};

/** `git log` des derniers commits, champs séparés par 0x1f, commits par 0x1e. */
function parseGitLog(stdout: string): GitCommit[] {
  return stdout
    .split("\x1e")
    .map((rec) => rec.replace(/^\s+/, ""))
    .filter((rec) => rec.length > 0)
    .map((rec) => {
      const [sha = "", author = "", committedAt = "", subject = "", body = ""] = rec.split("\x1f");
      return {
        sha: sha.trim(),
        author: author.trim(),
        committedAt: committedAt.trim(),
        subject: subject.trim(),
        body: body.trim() ? body.trim() : null,
      };
    })
    .filter((c) => /^[0-9a-f]{7,64}$/i.test(c.sha) && c.subject.length > 0);
}

/** Pousse les derniers commits du dépôt ; Parade OS ignore ceux qu'il connaît. */
async function reportCommits($: EngineInterface, ctx: Ctx): Promise<void> {
  if (!ctx.remote || !ctx.contextText) return;
  const srv = await connect($, ctx);
  if (!srv) return;
  const { exitCode, stdout } = await $.process.run([
    "git",
    "log",
    `-n${COMMITS_PER_PUSH}`,
    "--format=%H%x1f%an%x1f%aI%x1f%s%x1f%b%x1e",
  ]);
  if (exitCode !== 0) return;
  const commits = parseGitLog(stdout);
  if (commits.length === 0) return;
  const res = await $.mcp.call(srv, "report_commits", { remote: ctx.remote, commits });
  if (res.isError) {
    $.ui.log(`paradeos-temps: report_commits a échoué : ${firstText(res)}`, { to: "debug" });
  }
}

export const register: Register = (on, options) => {
  const pauseMs = Number(options.pauseMinutes ?? 30) * 60_000;
  const capMs = Number(options.capMinutes ?? 5) * 60_000;

  const ctx: Ctx = {
    enabled: false,
    sessionId: "",
    tracker: null,
    remote: null,
    workdir: null,
    server: null,
    warnedOffline: false,
    pushedEnd: new Map(),
    contextText: null,
    commitSeen: false,
  };

  on("session.start", async ($, e, next) => {
    ctx.enabled = e.isInteractive;
    if (ctx.enabled) {
      try {
        ctx.sessionId = await $.session.id();
        ctx.remote = (await $.session.repo())?.remote ?? null;
        ctx.workdir = basename(await $.session.cwd());
        const saved = (await $.store.get(stateKey(ctx))) as TrackerState | undefined;
        ctx.tracker = new Tracker({ pauseMs, capMs }, saved ?? null);
        await drainOutbox($, ctx);
        await loadContext($, ctx);
        // Les commits faits hors session (ou avant l'installation du mod)
        // partent au démarrage suivant : Parade OS garde ce qu'il ne connaît pas.
        await reportCommits($, ctx);
      } catch (err) {
        $.ui.log(`paradeos-temps: session.start ${String(err)}`, { to: "debug" });
      }
    }
    return next(e);
  });

  // Le contexte Parade OS entre dans le prompt système, côté session du
  // cache : il varie par dépôt, et change quand les tâches changent.
  on("prompt.compose", async ($, e, next) => {
    const result = await next(e);
    if (!ctx.enabled || !ctx.contextText) return result;
    return {
      sections: [
        ...result.sections,
        { id: CONTEXT_SECTION_ID, text: ctx.contextText, scope: "session" as const },
      ],
    };
  });

  // Un `git commit` dans le tour : les commits partent à la fin du tour.
  on("tool.call", { tool: "Bash" }, async (_$, e, next) => {
    const result = await next(e);
    const command = (e as { command?: unknown }).command;
    if (ctx.enabled && typeof command === "string" && /\bgit\b[^\n|;&]*\bcommit\b/.test(command)) {
      ctx.commitSeen = true;
    }
    return result;
  });

  // Le suivi ne doit jamais bloquer un prompt ni une fin de tour : toute
  // erreur (stockage, réseau) est avalée et tracée dans le debug log.
  on("prompt.submit", async ($, e, next) => {
    const human = e.origin.kind === "composer" || e.origin.kind === "bridge";
    if (ctx.enabled && ctx.tracker && human) {
      try {
        ctx.tracker.onPrompt(await $.clock.now());
        await $.store.set(stateKey(ctx), ctx.tracker.state());
      } catch (err) {
        $.ui.log(`paradeos-temps: prompt.submit ${String(err)}`, { to: "debug" });
      }
    }
    return next(e);
  });

  on("turn.complete", async ($, e, next) => {
    const result = await next(e);
    if (!ctx.enabled || !ctx.tracker || e.agentId !== undefined) return result;
    try {
      ctx.tracker.onTurnComplete(await $.clock.now());
      await $.store.set(stateKey(ctx), ctx.tracker.state());
      await flush($, ctx, false);
      if (ctx.commitSeen) {
        ctx.commitSeen = false;
        await reportCommits($, ctx);
      }
    } catch (err) {
      $.ui.log(`paradeos-temps: turn.complete ${String(err)}`, { to: "debug" });
    }
    return result;
  });

  on("session.end", async ($, e, next) => {
    if (ctx.enabled && ctx.tracker) {
      await flush($, ctx, true).catch((err) =>
        $.ui.log(`paradeos-temps: session.end ${String(err)}`, { to: "debug" }),
      );
    }
    return next(e);
  });
};
