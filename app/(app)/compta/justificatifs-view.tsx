import { DetachAction, MatchActions, RunMatchingButton } from "@/components/compta/match-actions";
import { EmptyState } from "@/components/empty-state";
import {
  dougsOperationMatches,
  dougsOperations,
  purchaseDocuments,
} from "@/db/schema/purchase-matching";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db/server";
import { DemoBlur } from "@/lib/demo/components";
import { isDemoMode } from "@/lib/demo/server";
import { buildDougsOperationsUrl, getDougsCompanyId } from "@/lib/dougs/client";
import {
  ArrowSquareOut,
  CheckCircle,
  FileArrowDown,
  MagnifyingGlass,
  Paperclip,
  Question,
} from "@phosphor-icons/react/dist/ssr";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import Link from "next/link";

/**
 * Les justificatifs manquants côté Dougs, et ce que le Drive propose
 * pour les combler.
 *
 * Reprend, automatisé, le rituel mensuel : lister les opérations « à
 * valider » sans pièce jointe, retrouver la facture du fournisseur,
 * l'attacher. Ici le Drive comptable sert de réservoir, et le
 * rapprochement est calculé par le cron quotidien.
 *
 * Ce qu'on n'automatise pas, jamais : la validation de l'opération. Une
 * pièce attachée laisse l'opération « à valider » chez Dougs.
 */
export async function JustificatifsView() {
  const user = await requireUser();
  const demo = await isDemoMode();
  const conn = await db();

  const [operations, matches, companyId] = await Promise.all([
    conn
      .select()
      .from(dougsOperations)
      .where(and(eq(dougsOperations.userId, user.id), ne(dougsOperations.isInbound, true)))
      .orderBy(desc(dougsOperations.operationDate)),
    conn
      .select({
        id: dougsOperationMatches.id,
        operationId: dougsOperationMatches.operationId,
        score: dougsOperationMatches.score,
        confidence: dougsOperationMatches.confidence,
        status: dougsOperationMatches.status,
        errorMessage: dougsOperationMatches.errorMessage,
        documentId: purchaseDocuments.id,
        driveFileName: purchaseDocuments.driveFileName,
        webViewLink: purchaseDocuments.webViewLink,
        supplierLabel: purchaseDocuments.supplierLabel,
        invoiceDate: purchaseDocuments.invoiceDate,
        amountTtc: purchaseDocuments.amountTtc,
      })
      .from(dougsOperationMatches)
      .innerJoin(purchaseDocuments, eq(purchaseDocuments.id, dougsOperationMatches.documentId))
      .where(
        and(
          eq(dougsOperationMatches.userId, user.id),
          ne(dougsOperationMatches.status, "rejected"),
        ),
      )
      .orderBy(desc(dougsOperationMatches.score), asc(purchaseDocuments.invoiceDate)),
    getDougsCompanyId(user.id).catch(() => null),
  ]);

  if (operations.length === 0) {
    return (
      <div className="space-y-4">
        <Toolbar />
        <EmptyState
          icon={Question}
          title="Aucune opération connue"
          description="Le rapprochement n'a encore rien lu chez Dougs. Vérifie ta session dans /settings/integrations, puis lance le rapprochement."
        />
      </div>
    );
  }

  const byOperation = new Map<string, typeof matches>();
  for (const match of matches) {
    const list = byOperation.get(match.operationId) ?? [];
    list.push(match);
    byOperation.set(match.operationId, list);
  }

  const orphans = operations.filter((o) => o.attachmentCount === 0);
  const toReview = orphans.filter((o) => (byOperation.get(o.id)?.length ?? 0) > 0);
  const notFound = orphans.filter((o) => (byOperation.get(o.id)?.length ?? 0) === 0);
  const attached = operations.filter((o) =>
    (byOperation.get(o.id) ?? []).some((m) => m.status === "attached"),
  );

  return (
    <div className="space-y-6">
      <Toolbar dougsUrl={companyId ? buildDougsOperationsUrl(companyId) : null} />

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Kpi
          tone="blue"
          icon={<Paperclip size={16} weight="duotone" />}
          label="À valider"
          value={String(toReview.length)}
          sub="Une facture du Drive est proposée"
        />
        <Kpi
          tone="orange"
          icon={<MagnifyingGlass size={16} weight="duotone" />}
          label="Introuvables"
          value={String(notFound.length)}
          sub="Aucune facture ne correspond"
        />
        <Kpi
          tone="green"
          icon={<CheckCircle size={16} weight="duotone" />}
          label="Attachées"
          value={String(attached.length)}
          sub="Pièce déposée, à valider dans Dougs"
        />
      </section>

      {toReview.length > 0 ? (
        <Section
          title="Propositions"
          description="Vérifie le fournisseur et le montant, puis attache. L'opération restera « à valider » dans Dougs."
        >
          {toReview.map((operation) => (
            <OperationCard
              key={operation.id}
              operation={operation}
              candidates={(byOperation.get(operation.id) ?? []).filter(
                (m) => m.status !== "attached",
              )}
              demo={demo}
            />
          ))}
        </Section>
      ) : null}

      {attached.length > 0 ? (
        <Section
          title="Attachées"
          description="Déposées chez Dougs par le rapprochement. À valider toi-même depuis Dougs, après contrôle."
        >
          {attached.map((operation) => (
            <OperationCard
              key={operation.id}
              operation={operation}
              candidates={(byOperation.get(operation.id) ?? []).filter(
                (m) => m.status === "attached",
              )}
              demo={demo}
            />
          ))}
        </Section>
      ) : null}

      {notFound.length > 0 ? (
        <Section
          title="Introuvables"
          description="Ces dépenses n'ont aucune facture correspondante dans le Drive. À récupérer chez le fournisseur."
        >
          <ul className="divide-y rounded-xl border bg-card">
            {notFound.map((operation) => (
              <li key={operation.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-foreground">
                    <DemoBlur>
                      {demo ? "Dépense" : (operation.wording ?? "(sans libellé)")}
                    </DemoBlur>
                  </p>
                  <p className="text-[12px] text-[var(--ds-text-tertiary)]">
                    {formatDateFR(operation.operationDate)}
                  </p>
                </div>
                <span className="min-w-[92px] text-right font-semibold text-[14px] tabular-nums">
                  {formatEur(Math.abs(Number(operation.amount) || 0))}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {toReview.length === 0 && attached.length === 0 && notFound.length === 0 ? (
        <EmptyState
          icon={CheckCircle}
          title="Rien à justifier"
          description="Toutes les opérations à valider ont déjà leur pièce jointe côté Dougs."
        />
      ) : null}
    </div>
  );
}

function Toolbar({ dougsUrl }: { dougsUrl?: string | null }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-muted-foreground text-sm">
        Opérations Dougs à valider sans justificatif, et les factures du Drive qui leur
        correspondent. Attacher une pièce ne valide jamais l'opération.
      </p>
      <div className="flex flex-none items-center gap-2">
        {dougsUrl ? (
          <Link
            href={dougsUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md border px-2 py-1 font-medium text-[12px] hover:bg-muted/40"
          >
            <ArrowSquareOut size={13} />
            Ouvrir Dougs
          </Link>
        ) : null}
        <RunMatchingButton />
      </div>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div>
        <h2 className="font-semibold text-[15px] text-foreground">{title}</h2>
        <p className="text-[12px] text-[var(--ds-text-tertiary)]">{description}</p>
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

type OperationRow = {
  id: string;
  operationDate: string | null;
  amount: string | null;
  wording: string | null;
  dougsOperationId: number;
};

type CandidateRow = {
  id: string;
  score: string | null;
  confidence: "certain" | "probable";
  status: "suggested" | "attached" | "rejected" | "failed";
  errorMessage: string | null;
  driveFileName: string;
  webViewLink: string | null;
  supplierLabel: string | null;
  invoiceDate: string | null;
  amountTtc: string | null;
};

/**
 * Une dépense et les factures qui pourraient la justifier. Le montant de
 * l'opération et celui de la facture sont montrés côte à côte : c'est la
 * comparaison qui permet de trancher d'un coup d'œil.
 */
function OperationCard({
  operation,
  candidates,
  demo,
}: {
  operation: OperationRow;
  candidates: CandidateRow[];
  demo: boolean;
}) {
  const operationAmount = Math.abs(Number(operation.amount) || 0);

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex items-center gap-3 border-b px-4 py-2.5 text-sm">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-foreground">
            <DemoBlur>{demo ? "Dépense" : (operation.wording ?? "(sans libellé)")}</DemoBlur>
          </p>
          <p className="text-[12px] text-[var(--ds-text-tertiary)]">
            {formatDateFR(operation.operationDate)} · opération {operation.dougsOperationId}
          </p>
        </div>
        <span className="font-semibold text-[15px] tabular-nums">{formatEur(operationAmount)}</span>
      </div>

      <ul className="divide-y">
        {candidates.map((candidate) => {
          const invoiceAmount = Number(candidate.amountTtc) || 0;
          const sameAmount = Math.abs(invoiceAmount - operationAmount) <= 0.01;
          return (
            <li key={candidate.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate text-foreground">
                  <DemoBlur>
                    {demo ? "Facture" : (candidate.supplierLabel ?? candidate.driveFileName)}
                  </DemoBlur>
                </p>
                <p className="truncate text-[12px] text-[var(--ds-text-tertiary)]">
                  {formatDateFR(candidate.invoiceDate)} · {candidate.driveFileName}
                </p>
                {candidate.errorMessage ? (
                  <p className="truncate text-[12px]" style={{ color: "var(--ds-tint-red-text)" }}>
                    {candidate.errorMessage}
                  </p>
                ) : null}
              </div>

              <ConfidenceBadge
                status={candidate.status}
                confidence={candidate.confidence}
                score={candidate.score}
              />

              <span
                className="min-w-[92px] text-right font-semibold text-[14px] tabular-nums"
                style={sameAmount ? undefined : { color: "var(--ds-tint-orange-text)" }}
                title={sameAmount ? undefined : "Le montant diffère de celui de l'opération"}
              >
                {formatEur(invoiceAmount)}
              </span>

              {candidate.webViewLink ? (
                <Link
                  href={candidate.webViewLink}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-none rounded p-1 text-[var(--ds-text-tertiary)] hover:bg-muted/40 hover:text-foreground"
                  title="Ouvrir la facture dans Drive"
                >
                  <FileArrowDown size={15} weight="duotone" />
                </Link>
              ) : null}

              {candidate.status === "attached" ? (
                <DetachAction matchId={candidate.id} />
              ) : (
                <MatchActions matchId={candidate.id} />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ConfidenceBadge({
  status,
  confidence,
  score,
}: {
  status: CandidateRow["status"];
  confidence: CandidateRow["confidence"];
  score: string | null;
}) {
  const percent = score ? `${Math.round(Number(score) * 100)} %` : "—";

  if (status === "attached") {
    return (
      <Badge tone="green" title="Pièce déposée chez Dougs — l'opération reste à valider">
        Attachée
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge tone="red" title="Le dépôt a échoué">
        Échec
      </Badge>
    );
  }
  if (confidence === "certain") {
    return (
      <Badge tone="green" title={`Montant, fournisseur et date concordent (${percent})`}>
        Certaine
      </Badge>
    );
  }
  return (
    <Badge tone="blue" title={`Score de rapprochement : ${percent}`}>
      {percent}
    </Badge>
  );
}

function Badge({
  tone,
  title,
  children,
}: {
  tone: "green" | "blue" | "orange" | "red";
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className="inline-flex flex-none items-center rounded-full px-2 py-0.5 font-semibold text-[11px]"
      style={tint(tone)}
      title={title}
    >
      {children}
    </span>
  );
}

function tint(name: "green" | "blue" | "orange" | "red") {
  return {
    background: `var(--ds-tint-${name}-bg)`,
    color: `var(--ds-tint-${name}-text)`,
  };
}

function Kpi({
  tone,
  icon,
  label,
  value,
  sub,
}: {
  tone: "green" | "blue" | "orange";
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3">
      <div
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-semibold text-[10px] tracking-wider"
        style={tint(tone)}
      >
        <span style={{ color: `var(--ds-tint-${tone}-dot)` }}>{icon}</span>
        {label.toUpperCase()}
      </div>
      <div className="mt-2 font-semibold text-[22px] text-foreground tabular-nums">{value}</div>
      <div className="text-[12px] text-[var(--ds-text-tertiary)]">{sub}</div>
    </div>
  );
}

function formatEur(n: number): string {
  return n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}

function formatDateFR(d: string | null | undefined): string {
  if (!d) return "—";
  const dt = new Date(d.length === 10 ? `${d}T00:00:00` : d);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "2-digit" });
}

export function JustificatifsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-5 w-2/3 animate-pulse rounded bg-muted-foreground/15" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-[92px] animate-pulse rounded-xl bg-muted-foreground/15" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-xl bg-muted-foreground/15" />
    </div>
  );
}
