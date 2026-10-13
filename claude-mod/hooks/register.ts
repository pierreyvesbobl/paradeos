/**
 * Mod Claude Code « paradeos-temps » : compte le temps d'attention passé
 * dans une session et le pousse dans Parade OS comme **signal** d'activité
 * (`claude_code_activity`), rattaché au projet du dépôt git.
 *
 * Ce n'est pas un créneau réalisé : rien n'entre dans le temps compté ni
 * dans la marge. Le signal dit où est parti l'effort ; l'humain l'arbitre
 * dans /temps avec les autres sources (réunions, mails, calendrier) avant
 * de saisir un vrai créneau. D'où un mod qui ne demande jamais rien en
 * pleine session : il envoie le remote, Parade OS en déduit le projet
 * d'après les dépôts rattachés à la fiche projet.
 *
 * Ce qui part de la machine : des horodatages, le remote git, le numéro
 * de segment. Jamais le contenu des échanges.
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

/** Un envoi en attente, indépendant de la session qui l'a produit. */
type Push = {
  sourceRef: string;
  startAt: string;
  endAt: string;
  remote: string | null;
};

type Ctx = {
  enabled: boolean;
  sessionId: string;
  tracker: Tracker | null;
  remote: string | null;
  server: string | null;
  warnedOffline: boolean;
  /** `end` du segment au dernier envoi réussi, par numéro de segment. */
  pushedEnd: Map<number, number>;
};

function fmtMs(ms: number): string {
  const min = Math.round(ms / 60_000);
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min`;
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

/** Un envoi. `false` = à réessayer plus tard (hors ligne, erreur serveur). */
async function send($: EngineInterface, ctx: Ctx, push: Push): Promise<boolean> {
  const srv = await connect($, ctx);
  if (!srv) return false;
  const res = await $.mcp.call(srv, "track_claude_time", push);
  if (!res.isError) return true;
  const block = res.content.find((b) => b.type === "text");
  const text = block && "text" in block ? String(block.text) : "";
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
 * repasse sur celui d'une session déjà fermée. C'est ce qui est arrivé au
 * premier segment écrit par ce mod. On y dépose chaque envoi avant de
 * l'essayer, on l'en retire quand il est passé, et on vide la file au
 * démarrage de la session suivante.
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
 */
async function flush($: EngineInterface, ctx: Ctx, force: boolean): Promise<void> {
  const tracker = ctx.tracker;
  if (!tracker) return;
  const currentNo = tracker.currentNo();

  const due = tracker.pending().filter((seg) => {
    if (force || seg.no !== currentNo) return true;
    const since = seg.end - (ctx.pushedEnd.get(seg.no) ?? seg.start);
    return since >= PUSH_EVERY_MS;
  });
  if (due.length === 0) return;

  const pushes: Push[] = due.map((seg) => ({
    sourceRef: `${ctx.sessionId}:${seg.no}`,
    startAt: new Date(seg.start).toISOString(),
    endAt: new Date(seg.end).toISOString(),
    remote: ctx.remote,
  }));
  await enqueue($, pushes);

  const done: string[] = [];
  for (const [i, push] of pushes.entries()) {
    const seg = due[i];
    if (!seg) continue;
    if (!(await send($, ctx, push))) break;
    tracker.markFlushed(seg.no);
    ctx.pushedEnd.set(seg.no, seg.end);
    done.push(push.sourceRef);
  }
  await dequeue($, done);
  await $.store.set(stateKey(ctx), tracker.state());

  $.ui.status(`Parade OS · activité ${fmtMs(tracker.totalMs())}`);
}

export const register: Register = (on, options) => {
  const pauseMs = Number(options.pauseMinutes ?? 30) * 60_000;
  const capMs = Number(options.capMinutes ?? 5) * 60_000;

  const ctx: Ctx = {
    enabled: false,
    sessionId: "",
    tracker: null,
    remote: null,
    server: null,
    warnedOffline: false,
    pushedEnd: new Map(),
  };

  on("session.start", async ($, e, next) => {
    ctx.enabled = e.isInteractive;
    if (ctx.enabled) {
      try {
        ctx.sessionId = await $.session.id();
        ctx.remote = (await $.session.repo())?.remote ?? null;
        const saved = (await $.store.get(stateKey(ctx))) as TrackerState | undefined;
        ctx.tracker = new Tracker({ pauseMs, capMs }, saved ?? null);
        await drainOutbox($, ctx);
      } catch (err) {
        $.ui.log(`paradeos-temps: session.start ${String(err)}`, { to: "debug" });
      }
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
      await flush($, ctx, false);
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
