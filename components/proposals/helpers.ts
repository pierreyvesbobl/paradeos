import { formatPersonName } from "@/lib/format";
import type {
  ContactOption,
  ProjectOption,
  Proposal,
  ProposalKind,
  ProposalStatus,
  UserOption,
} from "./types";

/** Kinds qui disposent d'un éditeur de champs (les rattachements n'en ont pas). */
const EDITABLE_KINDS: ReadonlySet<ProposalKind> = new Set<ProposalKind>([
  "task",
  "project",
  "opportunity",
  "contact",
  "entity",
]);

export type EditableKind = "task" | "project" | "opportunity" | "contact" | "entity";

export function isEditableKind(kind: ProposalKind): kind is EditableKind {
  return EDITABLE_KINDS.has(kind);
}

export const STATUS_ORDER: Record<ProposalStatus, number> = {
  pending: 0,
  accepted: 1,
  rejected: 2,
};

export const PRIORITY_TINT: Record<string, { tint: "yellow" | "red" | "gray"; label: string }> = {
  urgent: { tint: "red", label: "Urgente" },
  high: { tint: "yellow", label: "Haute" },
  normal: { tint: "gray", label: "Normale" },
  low: { tint: "gray", label: "Basse" },
};

export type PipelineStage = "lead" | "opportunity" | "project" | "none";

export const STAGE_STYLE: Record<
  PipelineStage,
  { label: string; tint: "blue" | "yellow" | "green" | "gray" }
> = {
  lead: { label: "Lead", tint: "blue" },
  opportunity: { label: "Opportunité", tint: "yellow" },
  project: { label: "Projet", tint: "green" },
  none: { label: "—", tint: "gray" },
};

export function groupByKind<P extends Proposal>(items: P[]): Partial<Record<ProposalKind, P[]>> {
  const out: Partial<Record<ProposalKind, P[]>> = {};
  for (const it of items) {
    const arr = out[it.kind] ?? [];
    arr.push(it);
    out[it.kind] = arr;
  }
  return out;
}

/**
 * Aplatit les propositions dans l'ordre des kinds de la source puis par
 * statut (pending → accepted → rejected). Les kinds hors `kindOrder` sont
 * ignorés.
 */
export function orderProposals<P extends Proposal>(items: P[], kindOrder: ProposalKind[]): P[] {
  const grouped = groupByKind(items);
  return kindOrder
    .flatMap((k) => grouped[k] ?? [])
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
}

export function formatDueDate(raw: string): string {
  try {
    const d = new Date(raw.length === 10 ? `${raw}T00:00:00` : raw);
    if (Number.isNaN(d.getTime())) return raw;
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return raw;
  }
}

export function summaryFor(p: Proposal, payload: Record<string, unknown>): string {
  switch (p.kind) {
    case "task":
    case "opportunity":
      return String(payload.title ?? "Sans titre");
    case "project":
    case "entity":
      return String(payload.name ?? "Sans nom");
    case "project_link":
      return (
        (payload.suggestedProjectName as string | null) ??
        p.matchedProjectName ??
        String(payload.projectName ?? "Projet")
      );
    case "entity_link":
      return p.matchedEntityName ?? "Entité";
    case "project_contact_link":
      return "Rattacher le contact au projet";
    case "contact":
      return formatPersonName(
        payload.firstName as string | null,
        payload.lastName as string | null,
      );
    case "draft_reply":
      return String(payload.subject ?? "Re:");
  }
}

export function matchedSubtitle(p: Proposal, payload: Record<string, unknown>): string {
  switch (p.kind) {
    case "task":
      return "tâche existante";
    case "project":
    case "project_link":
      return "projet existant";
    case "opportunity":
      return "opportunité existante";
    case "entity_link":
      return "entité existante";
    case "project_contact_link":
      return "rattachement contact ↔ projet";
    case "contact": {
      const job = payload.jobTitle as string | null | undefined;
      const ent = payload.entityName as string | null | undefined;
      return [job, ent].filter(Boolean).join(" · ") || "contact existant";
    }
    case "entity": {
      const k = payload.kind as string | null | undefined;
      return k ? k : "entité existante";
    }
    case "draft_reply":
      return "";
  }
}

export function matchedViewHref(p: Proposal): string | null {
  if (!p.matchedId) return null;
  switch (p.kind) {
    case "task":
      return `/taches/${p.matchedId}`;
    case "project":
    case "project_link":
    case "opportunity":
      return `/projets/${p.matchedId}`;
    case "contact":
      return `/contacts/${p.matchedId}`;
    case "entity":
      return `/entites/${p.matchedId}`;
    case "entity_link":
    case "project_contact_link":
    case "draft_reply":
      return null;
  }
}

// ─── Assignés de tâche ──────────────────────────────────────────────────

export type StoredAssignee = { kind: "user" | "contact"; id: string };

/**
 * Lit les assignés d'un payload de tâche : format multi `assignees[]`
 * en priorité, sinon les champs mono legacy (LLM ou anciennes payloads).
 */
export function readAssignees(draft: Record<string, unknown>): StoredAssignee[] {
  const raw = draft.assignees;
  if (!Array.isArray(raw)) {
    const uid = (draft.assigneeId as string | null | undefined) ?? null;
    const cid = (draft.assigneeContactId as string | null | undefined) ?? null;
    if (uid) return [{ kind: "user", id: uid }];
    if (cid) return [{ kind: "contact", id: cid }];
    return [];
  }
  return raw
    .filter(
      (a): a is StoredAssignee =>
        !!a &&
        typeof a === "object" &&
        (a as StoredAssignee).kind !== undefined &&
        typeof (a as StoredAssignee).id === "string",
    )
    .map((a) => ({ kind: a.kind, id: a.id }));
}

export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function findByName<T>(
  list: T[],
  query: string,
  getter: (item: T) => string | null,
): T | null {
  const q = normalizeName(query);
  if (!q) return null;
  // 1) match exact normalisé
  for (const item of list) {
    const v = getter(item);
    if (v && normalizeName(v) === q) return item;
  }
  // 2) inclusion bidirectionnelle (gère "Bénilde" ↔ "Bénilde Liotard")
  for (const item of list) {
    const v = getter(item);
    if (!v) continue;
    const nv = normalizeName(v);
    if (nv.includes(q) || q.includes(nv)) return item;
  }
  return null;
}

/**
 * Résout côté client le projet / l'assigné suggérés par le LLM (par nom)
 * quand la pré-résolution serveur n'a rien trouvé — anciennes propositions
 * ou matching strict trop restrictif.
 */
export function augmentTaskPayload(
  payload: Record<string, unknown>,
  projects: ProjectOption[],
  users: UserOption[],
  contacts: ContactOption[],
): Record<string, unknown> {
  const next = { ...payload };
  const hasAssignee = next.assigneeId || next.assigneeContactId;
  if (!hasAssignee && typeof next.assigneeName === "string" && next.assigneeName) {
    const kind = next.assigneeKind as "internal" | "external" | undefined;
    if (kind === "external") {
      const c = findByName(contacts, next.assigneeName, (x) => x.fullName);
      if (c) next.assigneeContactId = c.id;
    } else if (kind === "internal") {
      const u = findByName(users, next.assigneeName, (x) => x.fullName);
      if (u) next.assigneeId = u.id;
    } else {
      const u = findByName(users, next.assigneeName, (x) => x.fullName);
      if (u) {
        next.assigneeId = u.id;
      } else {
        const c = findByName(contacts, next.assigneeName, (x) => x.fullName);
        if (c) next.assigneeContactId = c.id;
      }
    }
  }
  if (!next.projectId && typeof next.projectName === "string" && next.projectName) {
    const p = findByName(projects, next.projectName, (x) => x.name);
    if (p) next.projectId = p.id;
  }
  return next;
}

/** Payload initial de l'éditeur : augmenté pour les tâches, brut sinon. */
export function editorDraftFor(
  proposal: Proposal,
  options: { projects: ProjectOption[]; users: UserOption[]; contacts: ContactOption[] },
): Record<string, unknown> {
  const payload = proposal.payload as Record<string, unknown>;
  return proposal.kind === "task"
    ? augmentTaskPayload(payload, options.projects, options.users, options.contacts)
    : payload;
}
