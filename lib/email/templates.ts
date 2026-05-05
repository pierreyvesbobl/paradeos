import { emailLayout } from "./client";

const SUBJECT_PATH: Record<string, (id: string) => string> = {
  entity: (id) => `/entites/${id}`,
  contact: (id) => `/contacts/${id}`,
  opportunity: (id) => `/opportunites/${id}`,
  project: (id) => `/projets/${id}`,
  task: (id) => `/taches/${id}`,
};

const SUBJECT_LABELS: Record<string, string> = {
  entity: "l'entité",
  contact: "le contact",
  opportunity: "l'opportunité",
  project: "le projet",
  task: "la tâche",
};

export function renderMentionEmail(input: {
  appUrl: string;
  authorName: string;
  noteTitle: string | null;
  noteContent: string;
  noteSubjectType: string | null;
  noteSubjectId: string | null;
  noteSubjectName: string | null;
}): { subject: string; html: string; text: string } {
  const subject = `${input.authorName} t'a mentionné${
    input.noteTitle ? ` — ${input.noteTitle}` : ""
  }`;

  const link =
    input.noteSubjectType && input.noteSubjectId
      ? `${input.appUrl}${SUBJECT_PATH[input.noteSubjectType]?.(input.noteSubjectId) ?? "/notes"}`
      : `${input.appUrl}/notes`;

  const subjectContext =
    input.noteSubjectType && input.noteSubjectName
      ? `${SUBJECT_LABELS[input.noteSubjectType] ?? "le sujet"} <strong>${escapeHtml(input.noteSubjectName)}</strong>`
      : "une note";

  const truncated =
    input.noteContent.length > 400 ? `${input.noteContent.slice(0, 400)}…` : input.noteContent;

  const content = `
    <p style="margin:0 0 12px 0;font-size:15px;">
      <strong>${escapeHtml(input.authorName)}</strong> t'a mentionné dans ${subjectContext}.
    </p>
    ${
      input.noteTitle
        ? `<p style="margin:0 0 8px 0;font-weight:600;">${escapeHtml(input.noteTitle)}</p>`
        : ""
    }
    <blockquote style="margin:0 0 16px 0;padding:12px 16px;border-left:3px solid #4f46e5;background:#f5f5ff;color:#334155;font-size:13px;white-space:pre-wrap;">${escapeHtml(truncated)}</blockquote>
    <p style="margin:0;">
      <a href="${link}" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:10px 16px;border-radius:8px;text-decoration:none;font-size:13px;">Voir la note</a>
    </p>
  `;

  const text = `${input.authorName} t'a mentionné${input.noteTitle ? ` (${input.noteTitle})` : ""} :\n\n${input.noteContent}\n\n${link}`;

  return { subject, html: emailLayout(content), text };
}

export function renderDailyDigestEmail(input: {
  appUrl: string;
  recipientName: string;
  followUps: {
    title: string;
    entityName: string | null;
    followUpDate: string;
    href: string;
  }[];
  overdueTasks: {
    title: string;
    projectName: string | null;
    dueDate: string;
    href: string;
  }[];
}): { subject: string; html: string; text: string } {
  const total = input.followUps.length + input.overdueTasks.length;
  const subject =
    total === 0
      ? "Parade OS — RAS pour aujourd'hui"
      : `Parade OS — ${input.followUps.length} relance${input.followUps.length > 1 ? "s" : ""} · ${input.overdueTasks.length} tâche${input.overdueTasks.length > 1 ? "s" : ""} en retard`;

  const followUpsHtml =
    input.followUps.length === 0
      ? ""
      : `
      <h2 style="margin:0 0 8px 0;font-size:14px;">Relances aujourd'hui (${input.followUps.length})</h2>
      <ul style="margin:0 0 16px 0;padding-left:18px;">
        ${input.followUps
          .map(
            (f) => `<li style="margin:4px 0;">
          <a href="${f.href}" style="color:#4f46e5;text-decoration:none;">${escapeHtml(f.title)}</a>${
            f.entityName ? ` <span style="color:#64748b;">— ${escapeHtml(f.entityName)}</span>` : ""
          }
        </li>`,
          )
          .join("")}
      </ul>`;

  const tasksHtml =
    input.overdueTasks.length === 0
      ? ""
      : `
      <h2 style="margin:0 0 8px 0;font-size:14px;">Tâches en retard (${input.overdueTasks.length})</h2>
      <ul style="margin:0 0 16px 0;padding-left:18px;">
        ${input.overdueTasks
          .map(
            (t) => `<li style="margin:4px 0;">
          <a href="${t.href}" style="color:#dc2626;text-decoration:none;">${escapeHtml(t.title)}</a>${
            t.projectName
              ? ` <span style="color:#64748b;">— ${escapeHtml(t.projectName)}</span>`
              : ""
          }
          <span style="color:#dc2626;font-size:12px;"> (échéance ${escapeHtml(t.dueDate)})</span>
        </li>`,
          )
          .join("")}
      </ul>`;

  const content = `
    <p style="margin:0 0 16px 0;">Salut ${escapeHtml(input.recipientName)},</p>
    ${
      total === 0
        ? `<p style="margin:0;">Aucune relance ni tâche en retard aujourd'hui. 👋</p>`
        : followUpsHtml + tasksHtml
    }
    <p style="margin:16px 0 0 0;">
      <a href="${input.appUrl}/" style="color:#4f46e5;font-size:12px;">Ouvrir Parade OS →</a>
    </p>
  `;

  const text = `Bonjour ${input.recipientName},\n\n${
    total === 0
      ? "Rien à signaler aujourd'hui."
      : [
          input.followUps.length > 0
            ? `Relances :\n${input.followUps.map((f) => `- ${f.title}`).join("\n")}`
            : "",
          input.overdueTasks.length > 0
            ? `Tâches en retard :\n${input.overdueTasks.map((t) => `- ${t.title}`).join("\n")}`
            : "",
        ]
          .filter(Boolean)
          .join("\n\n")
  }\n\n${input.appUrl}/`;

  return { subject, html: emailLayout(content), text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
