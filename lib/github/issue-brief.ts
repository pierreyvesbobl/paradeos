import { excerptFingerprint } from "@/lib/tasks/task-sources";

/** Ce que le brief d'une issue a besoin de savoir d'une tâche. Pur. */
export type IssueBriefInput = {
  task: {
    id: string;
    title: string;
    description: string | null;
    priority: "low" | "medium" | "high" | "urgent";
  };
  project: { name: string } | null;
  sources: {
    source: "meeting" | "email";
    label: string;
    occurredAt: Date | null;
    fromName: string | null;
    excerpts: { quote: string; speaker: string | null; relation: string }[];
  }[];
  /** URL absolue de Parade OS, pour le lien retour. */
  appUrl: string;
};

export const ISSUE_MARKER_PREFIX = "<!-- paradeos:task:";

/** Marqueur caché qui relie l'issue à sa tâche, quoi qu'il arrive au titre. */
export function issueMarker(taskId: string): string {
  return `${ISSUE_MARKER_PREFIX}${taskId} -->`;
}

/** Lit l'id de tâche d'un corps d'issue, null s'il n'en porte pas. */
export function taskIdFromIssueBody(body: string | null | undefined): string | null {
  if (!body) return null;
  const m = /<!-- paradeos:task:([0-9a-f-]{36}) -->/i.exec(body);
  return m?.[1] ?? null;
}

const PRIORITY_LABEL: Record<IssueBriefInput["task"]["priority"], string> = {
  low: "basse",
  medium: "normale",
  high: "haute",
  urgent: "urgente",
};

function formatDay(d: Date | null): string {
  if (!d) return "date inconnue";
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/**
 * Le brief d'une issue : le titre de la tâche, puis ce que le client en a
 * dit, mot pour mot et attribué, source par source dans l'ordre
 * chronologique. Un agent de code n'a ainsi pas à deviner le besoin derrière
 * un titre de dix mots. Le lien retour et le marqueur caché relient
 * l'issue à la tâche.
 */
export function buildIssueBrief(input: IssueBriefInput): {
  title: string;
  body: string;
  fingerprint: string;
} {
  const { task, project, sources, appUrl } = input;
  const lines: string[] = [];

  const intro: string[] = [];
  if (project) intro.push(`Projet : **${project.name}**`);
  intro.push(`Priorité : ${PRIORITY_LABEL[task.priority]}`);
  intro.push(`Tâche Parade OS : ${appUrl.replace(/\/$/, "")}/taches/${task.id}`);
  lines.push(intro.join(" · "));

  if (task.description?.trim()) {
    lines.push("", "## Description", "", task.description.trim());
  }

  if (sources.length > 0) {
    lines.push("", "## Ce qui a été dit", "");
    lines.push(
      "_Passages verbatim des réunions et mails qui ont motivé ou précisé ce besoin, du plus ancien au plus récent. Les transcriptions automatiques gardent leurs approximations._",
    );
    for (const g of sources) {
      const where = g.source === "meeting" ? "Réunion" : "Mail";
      const who = g.source === "email" && g.fromName ? ` de ${g.fromName}` : "";
      lines.push("", `### ${where} du ${formatDay(g.occurredAt)}${who} · ${g.label}`, "");
      for (const e of g.excerpts) {
        const speaker = e.speaker ?? (g.source === "email" ? g.fromName : null);
        const tag =
          e.relation === "origin"
            ? "à l'origine"
            : e.relation === "completion"
              ? "donnée pour faite"
              : "réévoquée";
        lines.push(`> ${e.quote}`);
        lines.push(`> — ${speaker ?? "non attribué"} _(${tag})_`, "");
      }
    }
  } else {
    lines.push("", "_Aucun passage verbatim attaché à cette tâche pour l'instant._");
  }

  lines.push(
    "",
    "---",
    "",
    "_Issue créée par Parade OS. Le titre et ce brief sont tenus à jour depuis la tâche ; fermer l'issue clôt la tâche._",
    "",
    issueMarker(task.id),
  );

  const body = lines.join("\n");
  return { title: task.title, body, fingerprint: excerptFingerprint(`${task.title}\n${body}`) };
}
