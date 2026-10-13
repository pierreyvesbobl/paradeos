/**
 * Mod Claude Code « paradeos-temps » : compte le temps d'attention passé
 * dans une session et le pousse dans Parade OS comme créneaux réalisés
 * (source `claude_code`), imputés au projet rattaché au dépôt git.
 *
 * Ce qui part de la machine : des horodatages, le remote git, le numéro
 * de segment. Jamais le contenu des échanges.
 *
 * Les règles de comptage vivent dans tracker.ts (pur, testé). Ici : le
 * branchement sur les événements du moteur, la résolution du dépôt, les
 * appels MCP et l'état persistant. Les helpers qui reçoivent `$` sont des
 * fonctions de premier niveau : c'est ce que le validateur du moteur exige.
 */
import type { EngineInterface, Register } from "claude-code";
import { Tracker, type TrackerState } from "./tracker";

const SERVER = "paradeos";
const MAX_CANDIDATES = 3;
const NO_PROJECT = "Aucun projet";

type RepoLink = { projectId: string | null; projectName: string | null; decidedAt: number };
type Candidate = { id: string; name: string };

type ResolveResult = {
  remote: string | null;
  linked: boolean;
  project: { id: string; name: string } | null;
  candidates: Candidate[];
};

/** État mutable de la session, partagé entre les hooks et les helpers. */
type Ctx = {
  enabled: boolean;
  sessionId: string;
  tracker: Tracker | null;
  link: RepoLink | null;
  remoteKey: string | null;
  askedThisSession: boolean;
  warnedOffline: boolean;
  server: string | null;
};

function parseJson<T>(text: string | undefined): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function fmtMs(ms: number): string {
  const min = Math.round(ms / 60_000);
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min`;
}

function stateKey(ctx: Ctx): string {
  return `session:${ctx.sessionId}`;
}

function repoKey(remote: string): string {
  return `repo:${remote}`;
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

async function call<T>(
  $: EngineInterface,
  ctx: Ctx,
  tool: string,
  args: Record<string, unknown>,
): Promise<T | null> {
  const srv = await connect($, ctx);
  if (!srv) return null;
  const res = await $.mcp.call(srv, tool, args);
  const block = res.content.find((b) => b.type === "text");
  const text = block && "text" in block ? String(block.text) : undefined;
  if (res.isError) {
    $.ui.log(`paradeos-temps: ${tool} a échoué${text ? ` : ${text}` : ""}`, { to: "debug" });
    return null;
  }
  return parseJson<T>(text);
}

/** Dépôt de la session → projet, via Parade OS, le cache local, puis l'humain. */
async function resolveProject($: EngineInterface, ctx: Ctx): Promise<RepoLink | null> {
  const repo = await $.session.repo();
  if (!repo?.remote) return null;

  const resolved = await call<ResolveResult>($, ctx, "resolve_repo", { remote: repo.remote });
  if (!resolved?.remote) return null;
  ctx.remoteKey = resolved.remote;

  if (resolved.linked && resolved.project) {
    const fresh: RepoLink = {
      projectId: resolved.project.id,
      projectName: resolved.project.name,
      decidedAt: await $.clock.now(),
    };
    await $.store.set(repoKey(ctx.remoteKey), fresh);
    return fresh;
  }

  const cached = (await $.store.get(repoKey(ctx.remoteKey))) as RepoLink | undefined;
  if (cached) return cached; // « Aucun projet » déjà répondu sur cette machine

  if (ctx.askedThisSession) return null;
  ctx.askedThisSession = true;

  const candidates = resolved.candidates.slice(0, MAX_CANDIDATES);
  let answer: string;
  try {
    answer = await $.ui.ask(`Dépôt ${ctx.remoteKey} : à quel projet Parade OS imputer le temps ?`, {
      options: [...candidates.map((c) => c.name), NO_PROJECT],
      header: "Parade OS",
    });
  } catch {
    return null; // fermé sans répondre : on redemandera à la prochaine session
  }

  if (answer === NO_PROJECT) {
    const none: RepoLink = { projectId: null, projectName: null, decidedAt: await $.clock.now() };
    await $.store.set(repoKey(ctx.remoteKey), none);
    return none;
  }

  const picked = candidates.find((c) => c.name === answer);
  const linked = await call<{ project: { id: string; name: string } | null }>($, ctx, "link_repo", {
    remote: ctx.remoteKey,
    ...(picked ? { projectId: picked.id } : { projectName: answer }),
  });
  if (!linked?.project) {
    $.ui.toast(`Parade OS : projet « ${answer} » introuvable, temps non imputé.`);
    return null;
  }
  const fresh: RepoLink = {
    projectId: linked.project.id,
    projectName: linked.project.name,
    decidedAt: await $.clock.now(),
  };
  await $.store.set(repoKey(ctx.remoteKey), fresh);
  $.ui.toast(`Parade OS : ${ctx.remoteKey} → ${fresh.projectName}`);
  return fresh;
}

async function flush($: EngineInterface, ctx: Ctx): Promise<void> {
  const tracker = ctx.tracker;
  if (!tracker) return;
  const pending = tracker.pending();
  if (pending.length === 0) return;

  if (!ctx.link) ctx.link = await resolveProject($, ctx);
  const repoName = ctx.remoteKey?.split("/").pop() ?? "session";

  for (const seg of pending) {
    const ok = await call<{ id: string }>($, ctx, "track_claude_time", {
      sourceRef: `${ctx.sessionId}:${seg.no}`,
      startAt: new Date(seg.start).toISOString(),
      endAt: new Date(seg.end).toISOString(),
      projectId: ctx.link?.projectId ?? null,
      title: `Claude Code · ${repoName}`,
    });
    if (ok) tracker.markFlushed(seg.no);
  }
  await $.store.set(stateKey(ctx), tracker.state());

  const target = ctx.link?.projectName ?? "sans projet";
  $.ui.status(`Parade OS · ${target} · ${fmtMs(tracker.totalMs())}`);
}

export const register: Register = (on, options) => {
  const pauseMs = Number(options.pauseMinutes ?? 30) * 60_000;
  const capMs = Number(options.capMinutes ?? 5) * 60_000;

  const ctx: Ctx = {
    enabled: false,
    sessionId: "",
    tracker: null,
    link: null,
    remoteKey: null,
    askedThisSession: false,
    warnedOffline: false,
    server: null,
  };

  on("session.start", async ($, e, next) => {
    ctx.enabled = e.isInteractive;
    if (ctx.enabled) {
      ctx.sessionId = await $.session.id();
      const saved = (await $.store.get(stateKey(ctx))) as TrackerState | undefined;
      ctx.tracker = new Tracker({ pauseMs, capMs }, saved ?? null);
    }
    return next(e);
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
      await flush($, ctx);
    } catch (err) {
      $.ui.log(`paradeos-temps: turn.complete ${String(err)}`, { to: "debug" });
    }
    return result;
  });

  on("session.end", async ($, e, next) => {
    if (ctx.enabled && ctx.tracker) {
      await flush($, ctx).catch((err) =>
        $.ui.log(`paradeos-temps: session.end ${String(err)}`, { to: "debug" }),
      );
    }
    return next(e);
  });
};
