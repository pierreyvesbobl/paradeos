import { desc, eq, sql } from "drizzle-orm";
import { candidatureReplies } from "@/db/schema/candidature-replies";
import { gmailMessages } from "@/db/schema/gmail";
import { db } from "@/lib/db/server";
import {
  DEFAULT_CANDIDATURE_REPLY_BODY,
  DEFAULT_CANDIDATURE_REPLY_FROM,
} from "@/lib/gmail/candidature-reply";
import { getSetting, SETTING_KEYS } from "@/lib/settings";
import { CandidaturesSettings } from "./candidatures-settings";

export async function CandidaturesSection({ userId }: { userId: string }) {
  const conn = await db();
  const [enabledSetting, from, body, statsRows, recent] = await Promise.all([
    getSetting(SETTING_KEYS.CANDIDATURE_AUTOREPLY_ENABLED),
    getSetting(SETTING_KEYS.CANDIDATURE_REPLY_FROM),
    getSetting(SETTING_KEYS.CANDIDATURE_REPLY_BODY),
    conn
      .select({ status: candidatureReplies.status, n: sql<number>`count(*)::int` })
      .from(candidatureReplies)
      .where(eq(candidatureReplies.userId, userId))
      .groupBy(candidatureReplies.status),
    conn
      .select({
        id: candidatureReplies.id,
        status: candidatureReplies.status,
        candidateEmail: candidatureReplies.candidateEmail,
        candidateName: candidatureReplies.candidateName,
        reason: candidatureReplies.reason,
        errorMessage: candidatureReplies.errorMessage,
        subject: gmailMessages.subject,
        receivedAt: gmailMessages.internalDate,
        repliedAt: candidatureReplies.repliedAt,
      })
      .from(candidatureReplies)
      .innerJoin(gmailMessages, eq(gmailMessages.id, candidatureReplies.messageId))
      .where(eq(candidatureReplies.userId, userId))
      .orderBy(desc(candidatureReplies.createdAt))
      .limit(12),
  ]);
  const enabled = enabledSetting !== "false";
  const statMap = new Map(statsRows.map((s) => [s.status, s.n]));

  return (
    <section className="rounded-lg border bg-card p-6">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="font-medium text-sm">Agent candidatures</h2>
          <p className="mt-1 text-muted-foreground text-xs">
            À chaque sync Gmail, les mails de candidature (spontanée, stage, alternance) reçoivent
            la réponse « pas de poste ouvert » dans leur fil, puis le fil reçoit le libellé{" "}
            <code>Paradeos/Candidature</code> et quitte la boîte de réception. Un LLM confirme
            chaque candidature avant l'envoi ; un fil ne reçoit jamais deux réponses, et un mail de
            plus de 30 jours n'en reçoit aucune.
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${enabled ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" : "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"}`}
        >
          {enabled ? "Activé" : "Désactivé"}
        </span>
      </header>

      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Répondues" value={String(statMap.get("replied") ?? 0)} tone="emerald" />
        <Stat label="En attente" value={String(statMap.get("pending") ?? 0)} tone="amber" />
        <Stat label="Écartées" value={String(statMap.get("rejected") ?? 0)} />
        <Stat label="Erreurs" value={String(statMap.get("error") ?? 0)} tone="rose" />
      </div>

      <CandidaturesSettings
        enabled={enabled}
        from={from ?? ""}
        body={body ?? ""}
        defaultFrom={DEFAULT_CANDIDATURE_REPLY_FROM}
        defaultBody={DEFAULT_CANDIDATURE_REPLY_BODY}
        recent={recent.map((r) => ({
          id: r.id,
          status: r.status,
          candidate: r.candidateName || r.candidateEmail || "(inconnu)",
          subject: r.subject ?? "(sans objet)",
          detail: r.status === "error" ? (r.errorMessage ?? "") : (r.reason ?? ""),
          receivedAt: r.receivedAt?.toISOString() ?? null,
          repliedAt: r.repliedAt?.toISOString() ?? null,
        }))}
      />
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "emerald" | "amber" | "rose";
}) {
  const tint =
    tone === "emerald"
      ? "text-emerald-700 dark:text-emerald-400"
      : tone === "amber"
        ? "text-amber-700 dark:text-amber-400"
        : tone === "rose"
          ? "text-rose-700 dark:text-rose-400"
          : "text-foreground";
  return (
    <div className="rounded border bg-background p-2">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={`mt-0.5 font-semibold text-sm tabular-nums ${tint}`}>{value}</p>
    </div>
  );
}
