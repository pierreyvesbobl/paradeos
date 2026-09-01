import { EmptyState } from "@/components/empty-state";
import { requireUser } from "@/lib/auth/server";
import { DemoBlur } from "@/lib/demo/components";
import { isDemoMode } from "@/lib/demo/server";
import {
  type DougsVendorInvoice,
  buildDougsVendorInvoiceUrl,
  getDougsCompanyId,
} from "@/lib/dougs/client";
import { getDougsVendorInvoicesSafe } from "@/lib/dougs/signals";
import {
  ArrowSquareOut,
  FileArrowDown,
  HandCoins,
  Link as LinkIcon,
  Receipt,
  WarningCircle,
} from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";

/**
 * Factures d'achat (fournisseurs) telles que Dougs les voit.
 *
 * Lecture seule et volontairement non miroitée en base : la source de
 * vérité reste Dougs. L'intérêt ici est de voir, sans quitter Paradeos,
 * ce qui n'est pas encore rapproché et ce qui n'a pas de justificatif —
 * les deux choses qui font perdre du temps en fin de trimestre.
 */
export async function AchatsView() {
  const user = await requireUser();
  const demo = await isDemoMode();
  const [rows, companyId] = await Promise.all([
    getDougsVendorInvoicesSafe(user.id, 100),
    getDougsCompanyId(user.id),
  ]);

  if (rows === null) {
    return (
      <EmptyState
        icon={WarningCircle}
        title="Dougs injoignable"
        description="Impossible de récupérer les factures d'achat. Vérifie ta session dans /settings/integrations, puis recharge."
      />
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Receipt}
        title="Aucune facture d'achat"
        description="Dougs ne remonte aucune facture fournisseur sur la période récente."
      />
    );
  }

  const unmatched = rows.filter((r) => matchState(r) === "none");
  const missingEvidence = rows.filter((r) => !r.fileId);
  const total = rows.reduce((s, r) => s + Math.abs(Number(r.amount) || 0), 0);

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Factures fournisseurs lues chez Dougs (100 plus récentes, cache 5 min). Lecture seule — la
        saisie et le rapprochement se font dans Dougs.
      </p>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Kpi
          tint="blue"
          icon={<Receipt size={16} weight="duotone" />}
          label="Factures"
          value={rows.length.toString()}
          sub={`${formatEur(total)} au total`}
        />
        <Kpi
          tint="orange"
          icon={<LinkIcon size={16} weight="duotone" />}
          label="Non rapprochées"
          value={unmatched.length.toString()}
          sub="Aucune opération bancaire liée"
        />
        <Kpi
          tint="red"
          icon={<WarningCircle size={16} weight="duotone" />}
          label="Sans justificatif"
          value={missingEvidence.length.toString()}
          sub="Pas de pièce jointe côté Dougs"
        />
      </section>

      <ul className="divide-y rounded-xl border bg-card">
        {rows.map((r) => {
          const state = matchState(r);
          const amount = Math.abs(Number(r.amount) || 0);
          const supplier = r.supplierName ?? r.label ?? "(fournisseur inconnu)";
          return (
            <li key={r.id} className="flex items-center gap-3 px-4 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">
                  <DemoBlur>{demo ? "Fournisseur" : supplier}</DemoBlur>
                  {r.isRefund ? (
                    <span className="ml-2 text-[11px] text-[var(--ds-text-tertiary)]">avoir</span>
                  ) : null}
                </p>
                <p className="truncate text-[12px] text-[var(--ds-text-tertiary)]">
                  {formatDateFR(r.date ?? r.createdAt)}
                  {r.reference ? ` · ${r.reference}` : ""}
                  {r.memo ? ` · ${r.memo}` : ""}
                </p>
              </div>

              <MatchBadge state={state} />

              <span className="min-w-[92px] text-right font-semibold text-[14px] tabular-nums">
                {formatEur(amount)}
              </span>

              <div className="flex flex-none items-center gap-1">
                {r.fileId ? (
                  <Link
                    href={`/api/dougs/file/${r.fileId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded p-1 text-[var(--ds-text-tertiary)] hover:bg-muted/40 hover:text-foreground"
                    title={r.fileName ?? "Ouvrir le justificatif"}
                  >
                    <FileArrowDown size={15} weight="duotone" />
                  </Link>
                ) : null}
                {companyId ? (
                  <Link
                    href={buildDougsVendorInvoiceUrl(companyId, r.id)}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded p-1 text-[var(--ds-text-tertiary)] hover:bg-muted/40 hover:text-foreground"
                    title="Ouvrir dans Dougs"
                  >
                    <ArrowSquareOut size={15} />
                  </Link>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

type MatchState = "matched" | "suggested" | "none";

/**
 * Trois états de rapprochement, du plus sûr au moins sûr :
 *  - `matched`   : opération bancaire attachée et validée
 *  - `suggested` : Dougs propose une opération, personne n'a validé
 *  - `none`      : rien, la facture est "en l'air"
 */
function matchState(r: DougsVendorInvoice): MatchState {
  const attachments = Array.isArray(r.operationAttachments) ? r.operationAttachments : [];
  if (r.matchedOperation || attachments.length > 0) return "matched";
  // Un achat est un décaissement : pickDougsPaymentHint filtre sur les
  // entrées d'argent, donc on regarde ici le candidat brut.
  if (r.operationCandidate) return "suggested";
  return "none";
}

function MatchBadge({ state }: { state: MatchState }) {
  if (state === "matched") {
    return (
      <span
        className="inline-flex flex-none items-center gap-1 rounded-full px-2 py-0.5 font-semibold text-[11px]"
        style={tint("green")}
        title="Opération bancaire rapprochée"
      >
        <LinkIcon size={12} weight="duotone" />
        Rapprochée
      </span>
    );
  }
  if (state === "suggested") {
    return (
      <span
        className="inline-flex flex-none items-center gap-1 rounded-full px-2 py-0.5 font-semibold text-[11px]"
        style={tint("blue")}
        title="Dougs propose une opération bancaire, pas encore validée"
      >
        <HandCoins size={12} weight="duotone" />
        Suggérée
      </span>
    );
  }
  return (
    <span
      className="inline-flex flex-none items-center rounded-full px-2 py-0.5 font-semibold text-[11px]"
      style={tint("orange")}
      title="Aucune opération bancaire associée"
    >
      À rapprocher
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
  tint: tone,
  icon,
  label,
  value,
  sub,
}: {
  tint: "blue" | "orange" | "red";
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
