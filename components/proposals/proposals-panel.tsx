"use client";

/**
 * Panneau de propositions extraites par l'IA, commun aux emails et aux
 * meetings.
 *
 * Choix d'architecture : les deux sources partagent la même UI (sections
 * « À valider » / « Déjà en base », lignes, éditeur) mais diffèrent par
 * leurs actions serveur, l'ordre des kinds, quelques libellés et deux
 * comportements (format d'assignés de tâche, action sur une ligne matchée).
 * Tout cela est porté par un `ProposalSourceAdapter` (cf. `sources.ts`)
 * plutôt que par des `if (source === …)` dispersés. Le panneau reçoit le
 * nom de la source — une string, sérialisable depuis une page serveur — et
 * résout l'adapter ici, côté client, car un objet contenant des closures ne
 * peut pas franchir la frontière serveur → client.
 *
 * L'UI spécifique à une source (carte d'extraction, brouillon de réponse
 * côté email) vit dans son wrapper et s'affiche au-dessus de ce panneau.
 */

import { Check, CheckCircle, X } from "@phosphor-icons/react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { orderProposals } from "./helpers";
import { AlreadyInDbRow, ProposalRow } from "./proposal-row";
import { PROPOSAL_SOURCES } from "./sources";
import type { LinkOptions, Proposal, ProposalSource, ProposalSourceAdapter } from "./types";
import { CountPill } from "./ui";

export function ProposalsPanel({
  source,
  proposals: serverProposals,
  options,
}: {
  source: ProposalSource;
  proposals: Proposal[];
  options: LinkOptions;
}) {
  const adapter = PROPOSAL_SOURCES[source];

  // État local miroir — met à jour l'UI immédiatement sur
  // accept/reject/restore/edit sans attendre le re-render serveur.
  const [proposals, setProposals] = useState<Proposal[]>(serverProposals);

  // Resync quand le serveur revient avec des données fraîches.
  useEffect(() => {
    setProposals(serverProposals);
  }, [serverProposals]);

  function patchProposal(id: string, mutate: (p: Proposal) => Proposal) {
    setProposals((prev) => prev.map((p) => (p.id === id ? mutate(p) : p)));
  }

  // Découpage clé du design v4 :
  //  - « À valider »   = vraiment nouveaux (sans matchedId) + tous les decided
  //                      (accepted/rejected) — la décision humaine reste affichée.
  //  - « Déjà en base » = pending + matched. Rattachés automatiquement à un
  //                       record existant ; rien à valider, on les montre pour
  //                       transparence (et pour corriger un match incorrect).
  const flat = orderProposals(proposals, adapter.kindOrder);
  const toReview = flat.filter((p) => p.status !== "pending" || p.matchedId === null);
  const alreadyInDb = flat.filter((p) => p.status === "pending" && p.matchedId !== null);

  const pendingIds = toReview.filter((p) => p.status === "pending").map((p) => p.id);
  const acceptedCount = toReview.filter((p) => p.status === "accepted").length;
  const rejectedCount = toReview.filter((p) => p.status === "rejected").length;

  function markAll(status: "accepted" | "rejected") {
    for (const id of pendingIds) {
      patchProposal(id, (p) => ({ ...p, status, decidedAt: new Date() }));
    }
  }

  if (toReview.length === 0 && alreadyInDb.length === 0) {
    if (!adapter.labels.emptyState) return null;
    return (
      <section className="rounded-lg border bg-card p-6">
        <p className="text-muted-foreground text-sm">{adapter.labels.emptyState}</p>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      {toReview.length > 0 ? (
        <section className="space-y-3">
          <header className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold text-[16px] text-foreground">À valider</h2>
            {pendingIds.length > 0 ? (
              <CountPill tint="yellow" label={`${pendingIds.length} en attente`} dot />
            ) : null}
            {acceptedCount > 0 ? (
              <CountPill
                tint="green"
                label={`${acceptedCount} validé${acceptedCount > 1 ? "s" : ""}`}
                icon="check"
              />
            ) : null}
            {rejectedCount > 0 ? (
              <CountPill
                tint="red"
                label={`${rejectedCount} invalidé${rejectedCount > 1 ? "s" : ""}`}
                icon="x"
              />
            ) : null}
            <span className="flex-1" />
            {pendingIds.length > 0 ? (
              <BulkDecideButtons pendingIds={pendingIds} adapter={adapter} onMarkAll={markAll} />
            ) : null}
          </header>
          <div className="overflow-hidden rounded-xl border bg-card">
            <ul className="divide-y">
              {toReview.map((p) => (
                <ProposalRow
                  key={p.id}
                  proposal={p}
                  options={options}
                  adapter={adapter}
                  onChange={(next) => patchProposal(p.id, () => next)}
                />
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {alreadyInDb.length > 0 ? (
        <section className="space-y-3">
          <header className="flex flex-wrap items-baseline gap-2">
            <h2 className="font-semibold text-[16px] text-muted-foreground">Déjà en base</h2>
            <span className="text-[12px] text-[var(--ds-text-tertiary)]">
              {alreadyInDb.length} élément{alreadyInDb.length > 1 ? "s" : ""} · rattaché
              {alreadyInDb.length > 1 ? "s" : ""} automatiquement
            </span>
          </header>
          <div className="overflow-hidden rounded-xl border bg-[var(--ds-bg-surface)]">
            <div className="flex items-center gap-2 border-b px-4 py-2.5 text-[12px] text-muted-foreground">
              <CheckCircle size={15} weight="duotone" className="text-[var(--ds-tint-green-dot)]" />
              {adapter.labels.alreadyInDbHint}
            </div>
            <ul className="divide-y">
              {alreadyInDb.map((p) => (
                <AlreadyInDbRow
                  key={p.id}
                  proposal={p}
                  adapter={adapter}
                  onChange={(next) => patchProposal(p.id, () => next)}
                />
              ))}
            </ul>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function BulkDecideButtons({
  pendingIds,
  adapter,
  onMarkAll,
}: {
  pendingIds: string[];
  adapter: ProposalSourceAdapter;
  onMarkAll: (status: "accepted" | "rejected") => void;
}) {
  const [pending, startTransition] = useTransition();

  function bulk(action: "accept" | "reject") {
    startTransition(async () => {
      let ok = 0;
      let fail = 0;
      for (const id of pendingIds) {
        const res =
          action === "accept" ? await adapter.actions.accept(id) : await adapter.actions.reject(id);
        if (res.ok) ok++;
        else fail++;
      }
      onMarkAll(action === "accept" ? "accepted" : "rejected");
      if (ok > 0) toast.success(`${ok} ${action === "accept" ? "validés" : "rejetés"}.`);
      if (fail > 0) toast.error(`${fail} échec(s).`);
    });
  }

  return (
    <div className="inline-flex items-center gap-1.5">
      <button
        type="button"
        disabled={pending}
        onClick={() => bulk("reject")}
        className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium text-[13px] transition-colors disabled:opacity-50"
        style={{
          background: "var(--ds-tint-red-bg)",
          color: "var(--ds-tint-red-text)",
        }}
      >
        <X size={13} weight="bold" />
        Tout rejeter
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => bulk("accept")}
        className="inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 font-medium text-[13px] transition-colors disabled:opacity-50"
        style={{
          background: "var(--ds-tint-green-bg)",
          color: "var(--ds-tint-green-text)",
          boxShadow: "inset 0 0 0 1px var(--ds-tint-green-dot)",
        }}
      >
        <Check size={13} weight="bold" />
        {adapter.labels.bulkAccept}
      </button>
    </div>
  );
}
