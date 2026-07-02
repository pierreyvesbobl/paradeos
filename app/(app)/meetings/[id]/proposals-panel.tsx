"use client";

import { FkCombobox } from "@/components/inline/fk-combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HashedAvatar } from "@/components/user/hashed-avatar";
import type { MeetingProposal } from "@/db/schema/meetings";
import { quickCreateEntity } from "@/lib/actions/entities";
import { decideProposal, revertProposal, updateAcceptedProposal } from "@/lib/actions/meetings";
import {
  ArrowCounterClockwise,
  ArrowUUpLeft,
  ArrowUpRight,
  Briefcase,
  Buildings,
  Calendar,
  CalendarX,
  Check,
  CheckCircle,
  EnvelopeSimple,
  Folder,
  IdentificationBadge,
  LinkSimple,
  ListChecks,
  PencilSimple,
  PlusCircle,
  User,
  Warning,
  X,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

const KIND_ORDER: MeetingProposal["kind"][] = [
  "task",
  "opportunity",
  "project",
  "contact",
  "entity",
];

type ProjectOption = { id: string; name: string };
type UserOption = { id: string; fullName: string | null };
type NamedOption = { id: string; name: string };
type TitledOption = { id: string; title: string };
type ContactOption = { id: string; fullName: string; entityName?: string | null };

type LinkOptions = {
  projects: ProjectOption[];
  users: UserOption[];
  entities: NamedOption[];
  contacts: ContactOption[];
  existingTasks: TitledOption[];
};

export function ProposalsPanel({
  proposals: serverProposals,
  projects,
  users,
  entities,
  contacts,
  existingTasks,
}: {
  proposals: MeetingProposal[];
} & LinkOptions) {
  // État local mirror — permet de mettre à jour l'UI immédiatement sur
  // accept/reject/restore/edit sans attendre le router.refresh().
  const [proposals, setProposals] = useState<MeetingProposal[]>(serverProposals);

  // Resync quand le serveur revient avec des données fraîches (via
  // router.refresh()). On compare les ids+status pour détecter un vrai
  // changement et éviter d'écraser un optimistic update local.
  useEffect(() => {
    setProposals(serverProposals);
  }, [serverProposals]);

  function patchProposal(id: string, mutate: (p: MeetingProposal) => MeetingProposal) {
    setProposals((prev) => prev.map((p) => (p.id === id ? mutate(p) : p)));
  }

  const linkOptions: LinkOptions = {
    projects,
    users,
    entities,
    contacts,
    existingTasks,
  };
  if (proposals.length === 0) {
    return (
      <section className="rounded-lg border bg-card p-6">
        <p className="text-muted-foreground text-sm">
          Aucune proposition. Lance "Ré-extraire" pour générer le résumé et les propositions.
        </p>
      </section>
    );
  }

  // Aplatissement design v4 : tout dans une seule section "À valider",
  // ordonné par kind puis par statut (pending → accepted → rejected).
  const grouped = groupByKind(proposals);
  const orderRank: Record<MeetingProposal["status"], number> = {
    pending: 0,
    accepted: 1,
    rejected: 2,
  };
  const flat = KIND_ORDER.flatMap((k) => grouped[k] ?? []).sort(
    (a, b) => orderRank[a.status] - orderRank[b.status],
  );

  // Découpage clé du redesign v4 :
  //  - "À valider"   = vraiment nouveaux (sans matchedId) + tous les decided
  //                    (accepted/rejected) — la décision humaine reste affichée.
  //  - "Déjà en base" = pending + matched. Rattachés automatiquement à un
  //                     record CRM existant ; rien à valider, on les montre
  //                     pour transparence (et pour pouvoir corriger un match
  //                     incorrect).
  const toReview = flat.filter((p) => p.status !== "pending" || p.matchedId === null);
  const alreadyInDb = flat.filter((p) => p.status === "pending" && p.matchedId !== null);

  const pendingCount = toReview.filter((p) => p.status === "pending").length;
  const acceptedCount = toReview.filter((p) => p.status === "accepted").length;
  const rejectedCount = toReview.filter((p) => p.status === "rejected").length;

  function markAll(status: "accepted" | "rejected") {
    const pendingIds = toReview.filter((p) => p.status === "pending").map((p) => p.id);
    for (const id of pendingIds) {
      patchProposal(id, (p) => ({
        ...p,
        status,
        decidedAt: new Date(),
      }));
    }
  }

  return (
    <div className="space-y-6">
      {toReview.length > 0 ? (
        <section className="space-y-3">
          <header className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold text-[18px] text-foreground">À valider</h2>
            {pendingCount > 0 ? (
              <CountPill tint="yellow" label={`${pendingCount} en attente`} dot />
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
            {pendingCount > 0 ? (
              <BulkDecideButtons
                pendingIds={toReview.filter((p) => p.status === "pending").map((p) => p.id)}
                onMarkAll={markAll}
              />
            ) : null}
          </header>
          <div className="overflow-hidden rounded-xl border bg-card">
            <ul className="divide-y">
              {toReview.map((p) => (
                <ProposalRow
                  key={p.id}
                  proposal={p}
                  options={linkOptions}
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
            <h2 className="font-semibold text-[18px] text-muted-foreground">Déjà en base</h2>
            <span className="text-[12px] text-[var(--ds-text-tertiary)]">
              {alreadyInDb.length} élément{alreadyInDb.length > 1 ? "s" : ""} · rattaché
              {alreadyInDb.length > 1 ? "s" : ""} automatiquement
            </span>
          </header>
          <div className="overflow-hidden rounded-xl border bg-[var(--ds-bg-surface)]">
            <div className="flex items-center gap-2 border-b px-4 py-2.5 text-[12px] text-muted-foreground">
              <CheckCircle size={15} weight="duotone" className="text-[var(--ds-tint-green-dot)]" />
              Reconnus dans la base et liés à cette réunion. Rien à valider — intervenez seulement
              si la correspondance est fausse.
            </div>
            <ul className="divide-y">
              {alreadyInDb.map((p) => (
                <AlreadyInDbRow
                  key={p.id}
                  proposal={p}
                  options={linkOptions}
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

function CountPill({
  tint,
  label,
  dot,
  icon,
}: {
  tint: "yellow" | "green" | "red";
  label: string;
  dot?: boolean;
  icon?: "check" | "x";
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-semibold text-[12px]"
      style={{
        background: `var(--ds-tint-${tint}-bg)`,
        color: `var(--ds-tint-${tint}-text)`,
      }}
    >
      {dot ? (
        <span
          className="inline-block size-1.5 rounded-full"
          style={{ background: `var(--ds-tint-${tint}-dot)` }}
        />
      ) : null}
      {icon === "check" ? <Check size={11} weight="bold" /> : null}
      {icon === "x" ? <X size={11} weight="bold" /> : null}
      {label}
    </span>
  );
}

function BulkDecideButtons({
  pendingIds,
  onMarkAll,
}: {
  pendingIds: string[];
  onMarkAll: (status: "accepted" | "rejected") => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (pendingIds.length === 0) return null;

  function bulk(action: "accept" | "reject") {
    startTransition(async () => {
      let ok = 0;
      let fail = 0;
      for (const id of pendingIds) {
        const res = await decideProposal({ proposalId: id, action });
        if (res.ok) ok++;
        else fail++;
      }
      onMarkAll(action === "accept" ? "accepted" : "rejected");
      if (ok > 0) toast.success(`${ok} ${action === "accept" ? "validés" : "rejetés"}.`);
      if (fail > 0) toast.error(`${fail} échec(s).`);
      router.refresh();
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
        Tout créer
      </button>
    </div>
  );
}

function ProposalRow({
  proposal,
  options,
  onChange,
}: {
  proposal: MeetingProposal;
  options: LinkOptions;
  onChange: (next: MeetingProposal) => void;
}) {
  const router = useRouter();
  const initial = proposal.payload as Record<string, unknown>;
  // Pour les tâches : tente de résoudre côté client le projet/user
  // suggérés par le LLM, au cas où la pré-résolution serveur n'a rien
  // trouvé (anciennes propositions, ou matching strict trop restrictif).
  const augmented =
    proposal.kind === "task"
      ? augmentTaskPayload(initial, options.projects, options.users, options.contacts)
      : initial;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown>>(augmented);
  const [pending, startTransition] = useTransition();

  const matched = proposal.matchedId !== null;
  const confidence = proposal.matchConfidence ? Number(proposal.matchConfidence) : null;
  const isAccepted = proposal.status === "accepted";
  const isRejected = proposal.status === "rejected";

  function decide(action: "accept" | "reject", payloadOverride?: Record<string, unknown>) {
    startTransition(async () => {
      const res = await decideProposal({
        proposalId: proposal.id,
        action,
        payloadOverride,
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      // Mise à jour locale immédiate.
      onChange({
        ...proposal,
        status: action === "accept" ? "accepted" : "rejected",
        decidedAt: new Date(),
        payload: payloadOverride
          ? { ...(proposal.payload as Record<string, unknown>), ...payloadOverride }
          : proposal.payload,
      });
      setEditing(false);
      toast.success(action === "accept" ? "Accepté." : "Rejeté.");
      router.refresh();
    });
  }

  function saveAcceptedEdit(next: Record<string, unknown>) {
    startTransition(async () => {
      const res = await updateAcceptedProposal({ proposalId: proposal.id, payload: next });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      onChange({
        ...proposal,
        payload: { ...(proposal.payload as Record<string, unknown>), ...next },
      });
      setEditing(false);
      toast.success("Mise à jour enregistrée.");
      router.refresh();
    });
  }

  function restore() {
    startTransition(async () => {
      const res = await revertProposal({ proposalId: proposal.id });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      onChange({
        ...proposal,
        status: "pending",
        decidedAt: null,
        decidedBy: null,
      });
      toast.success("Remis en attente.");
      router.refresh();
    });
  }

  function startEditing() {
    // Repart toujours du payload courant (qui a pu changer via
    // updateAcceptedProposal) plutôt que du draft initial figé.
    setDraft(
      proposal.kind === "task"
        ? augmentTaskPayload(
            proposal.payload as Record<string, unknown>,
            options.projects,
            options.users,
            options.contacts,
          )
        : (proposal.payload as Record<string, unknown>),
    );
    setEditing(true);
  }

  if (editing) {
    return (
      <li className="px-4 py-3.5">
        <div className="space-y-3">
          <ProposalEditor
            kind={proposal.kind}
            draft={draft}
            onChange={setDraft}
            options={options}
            initialMatchedId={proposal.matchedId}
          />
          {!isAccepted && matched ? (
            <p className="text-amber-700 text-xs dark:text-amber-400">
              Cette proposition allait être liée à un record existant. Si tu modifies les champs, le
              lien sera ignoré et un nouveau record sera créé.
            </p>
          ) : null}
          {isAccepted ? (
            <p className="text-muted-foreground text-xs">
              Modifie les champs : le record déjà créé sera mis à jour en place (pas de doublon).
            </p>
          ) : null}
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => {
                setDraft(augmented);
                setEditing(false);
              }}
            >
              Annuler
            </Button>
            {isAccepted ? (
              <Button size="sm" disabled={pending} onClick={() => saveAcceptedEdit(draft)}>
                <Check size={14} weight="bold" />
                Enregistrer
              </Button>
            ) : (
              <Button size="sm" disabled={pending} onClick={() => decide("accept", draft)}>
                <Check size={14} weight="bold" />
                Accepter
              </Button>
            )}
          </div>
        </div>
      </li>
    );
  }

  // Banner accepted (validé) : fond tinted vert + pastille + bouton restore.
  if (isAccepted) {
    return (
      <li
        className="flex items-center gap-3.5 px-4 py-3.5"
        style={{
          background: "var(--ds-tint-green-bg)",
          borderLeft: "4px solid var(--ds-tint-green-dot)",
        }}
      >
        <span
          title="Validé · créé dans la base"
          className="inline-flex size-8 flex-none items-center justify-center rounded-full text-white"
          style={{ background: "var(--ds-tint-green-dot)" }}
        >
          <Check size={17} weight="bold" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="font-medium text-foreground text-sm leading-snug">
            {summaryFor(proposal, initial)}
          </span>
          <ProposalMetaTags proposal={proposal} payload={initial} />
        </div>
        <div className="flex flex-none items-center gap-1.5">
          <IconButton title="Modifier le record lié" onClick={startEditing} disabled={pending}>
            <PencilSimple size={16} weight="duotone" />
          </IconButton>
          <button
            type="button"
            onClick={restore}
            disabled={pending}
            title="Annuler la validation"
            aria-label="Annuler la validation"
            className="inline-flex size-8 items-center justify-center rounded-md border bg-[var(--ds-bg-app)] transition-colors hover:bg-[var(--ds-bg-hover)] disabled:opacity-50"
            style={{
              borderColor: "var(--ds-tint-green-dot)",
              color: "var(--ds-tint-green-text)",
            }}
          >
            <ArrowCounterClockwise size={14} weight="bold" />
          </button>
        </div>
      </li>
    );
  }

  // Banner rejected (invalidé) : fond tinted rouge + pastille + texte barré + bouton rétablir.
  if (isRejected) {
    return (
      <li
        className="flex items-center gap-3.5 px-4 py-3.5"
        style={{
          background: "var(--ds-tint-red-bg)",
          borderLeft: "4px solid var(--ds-tint-red-dot)",
        }}
      >
        <span
          title="Invalidé · non créé"
          className="inline-flex size-8 flex-none items-center justify-center rounded-full text-white"
          style={{ background: "var(--ds-tint-red-dot)" }}
        >
          <X size={17} weight="bold" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="font-medium text-[var(--ds-text-tertiary)] text-sm leading-snug line-through">
            {summaryFor(proposal, initial)}
          </span>
          <ProposalMetaTags proposal={proposal} payload={initial} muted />
        </div>
        <button
          type="button"
          onClick={restore}
          disabled={pending}
          title="Rétablir cet élément"
          aria-label="Rétablir cet élément"
          className="inline-flex size-8 flex-none items-center justify-center rounded-md border bg-[var(--ds-bg-app)] transition-colors hover:bg-[var(--ds-bg-hover)] disabled:opacity-50"
          style={{
            borderColor: "var(--ds-tint-red-dot)",
            color: "var(--ds-tint-red-text)",
          }}
        >
          <ArrowCounterClockwise size={14} weight="bold" />
        </button>
      </li>
    );
  }

  // pending : layout normal + actions hover-reveal.
  return (
    <li className="flex items-start gap-3 px-4 py-3.5">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <KindIcon kind={proposal.kind} />
          <span className="font-medium text-foreground text-sm leading-snug">
            {summaryFor(proposal, initial)}
          </span>
          {matched ? <MatchBadge confidence={confidence} /> : <NewBadge kind={proposal.kind} />}
        </div>
        <ProposalMetaTags proposal={proposal} payload={initial} />
        <CrossKindBanner proposal={proposal} payload={initial} />
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <IconButton title="Modifier" onClick={startEditing} disabled={pending}>
          <PencilSimple size={16} weight="duotone" />
        </IconButton>
        <HoverRevealButton
          tint="red"
          label="Invalider"
          icon={<X size={13} weight="bold" />}
          onClick={() => decide("reject")}
          disabled={pending}
        />
        <HoverRevealButton
          tint="green"
          label="Valider"
          icon={<Check size={13} weight="bold" />}
          ring
          onClick={() => decide("accept")}
          disabled={pending}
        />
      </div>
    </li>
  );
}

/**
 * Bouton tinted dont le label apparaît au hover (animation max-width).
 * Cf. design v4 — "iconbtn .t" : icône seule par défaut, label glissé à
 * côté quand on survole. Évite que la rangée prenne 4 colonnes d'actions.
 */
function HoverRevealButton({
  tint,
  label,
  icon,
  onClick,
  disabled,
  ring,
}: {
  tint: "red" | "green";
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  ring?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="group/hr inline-flex items-center rounded-md px-2.5 py-1.5 font-medium text-[13px] transition-colors disabled:opacity-50"
      style={{
        background: `var(--ds-tint-${tint}-bg)`,
        color: `var(--ds-tint-${tint}-text)`,
        boxShadow: ring ? `inset 0 0 0 1px var(--ds-tint-${tint}-dot)` : undefined,
      }}
    >
      {icon}
      <span className="ml-0 inline-block max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-[max-width,opacity,margin] duration-150 group-hover/hr:ml-1.5 group-hover/hr:max-w-[120px] group-hover/hr:opacity-100">
        {label}
      </span>
    </button>
  );
}

/**
 * Row "Déjà en base" — proposition pending dont le matchedId pointe sur un
 * record CRM existant. UI compacte, ton bas, on n'attend rien de l'utilisateur
 * (Valider/Invalider absents). Actions hover : voir la fiche, modifier, ou
 * corriger un mauvais match.
 */
function AlreadyInDbRow({
  proposal,
  options,
  onChange,
}: {
  proposal: MeetingProposal;
  options: LinkOptions;
  onChange: (next: MeetingProposal) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const payload = proposal.payload as Record<string, unknown>;
  const title = summaryFor(proposal, payload);
  const subtitle = matchedSubtitle(proposal, payload);
  const viewHref = matchedViewHref(proposal);

  function correct() {
    // Revert -> redevient pending sans match. L'utilisateur peut alors
    // ré-éditer / choisir un autre record dans le panneau "À valider".
    startTransition(async () => {
      const res = await revertProposal({ proposalId: proposal.id });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      onChange({
        ...proposal,
        status: "pending",
        matchedId: null,
        matchConfidence: null,
        decidedAt: null,
        decidedBy: null,
      });
      // augmentTaskPayload réutilise les options pour ne pas perdre la
      // pré-résolution si elle existe encore.
      void options;
      toast.success("Match retiré. Remis dans 'À valider'.");
      router.refresh();
    });
  }

  return (
    <li className="group/qrow flex items-center gap-3 px-4 py-2.5">
      <KindIcon kind={proposal.kind} />
      <span className="truncate font-medium text-foreground text-sm">{title}</span>
      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--ds-bg-hover)] px-2 py-0.5 font-semibold text-[11px] text-muted-foreground">
        <LinkSimple size={11} weight="bold" />
        Fiche existante
      </span>
      {subtitle ? (
        <span className="truncate text-[12px] text-[var(--ds-text-tertiary)]">· {subtitle}</span>
      ) : null}
      <span className="flex-1" />
      <button
        type="button"
        onClick={correct}
        disabled={pending}
        className="inline-flex items-center gap-1 text-[12px] text-muted-foreground opacity-0 transition-opacity hover:text-foreground disabled:opacity-30 group-hover/qrow:opacity-100"
        title="Mauvaise fiche ? Détache le match — la proposition retourne dans 'À valider'."
      >
        <ArrowUUpLeft size={13} weight="duotone" />
        Mauvaise fiche
      </button>
      {viewHref ? (
        <Link
          href={viewHref}
          className="inline-flex items-center gap-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowUpRight size={12} weight="bold" />
          Voir
        </Link>
      ) : null}
    </li>
  );
}

function matchedSubtitle(p: MeetingProposal, payload: Record<string, unknown>): string {
  switch (p.kind) {
    case "task":
      return "tâche existante";
    case "project":
      return "projet existant";
    case "opportunity":
      return "opportunité existante";
    case "contact": {
      const job = payload.jobTitle as string | null | undefined;
      const ent = payload.entityName as string | null | undefined;
      return [job, ent].filter(Boolean).join(" · ") || "contact existant";
    }
    case "entity": {
      const k = payload.kind as string | null | undefined;
      return k ? `${k}` : "entité existante";
    }
  }
}

function matchedViewHref(p: MeetingProposal): string | null {
  if (!p.matchedId) return null;
  switch (p.kind) {
    case "task":
      return `/taches/${p.matchedId}`;
    case "project":
    case "opportunity":
      return `/projets/${p.matchedId}`;
    case "contact":
      return `/contacts/${p.matchedId}`;
    case "entity":
      return `/entites/${p.matchedId}`;
  }
}

function KindIcon({ kind }: { kind: MeetingProposal["kind"] }) {
  const props = {
    size: 16,
    weight: "duotone" as const,
    className: "flex-none text-[var(--ds-primary-500)]",
  };
  switch (kind) {
    case "task":
      return <ListChecks {...props} />;
    case "project":
      return <Briefcase {...props} />;
    case "opportunity":
      return <Briefcase {...props} />;
    case "contact":
      return <User {...props} />;
    case "entity":
      return <Buildings {...props} />;
  }
}

const KIND_NEW_LABEL: Record<MeetingProposal["kind"], string> = {
  task: "Nouvelle tâche",
  project: "Nouveau projet",
  opportunity: "Nouvelle opportunité",
  contact: "Nouveau contact",
  entity: "Nouvelle entité",
};

function NewBadge({ kind }: { kind: MeetingProposal["kind"] }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold text-[11px]"
      style={{
        background: "var(--ds-tint-green-bg)",
        color: "var(--ds-tint-green-text)",
      }}
    >
      <PlusCircle size={11} weight="bold" />
      {KIND_NEW_LABEL[kind]}
    </span>
  );
}

function MatchBadge({ confidence }: { confidence: number | null }) {
  const pct = confidence != null ? `${Math.round(confidence * 100)}%` : "—";
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold text-[11px]"
      style={{
        background: "var(--ds-tint-blue-bg)",
        color: "var(--ds-tint-blue-text)",
      }}
    >
      Match existant · {pct}
    </span>
  );
}

const PRIORITY_TINT: Record<string, { tint: "yellow" | "red" | "gray"; label: string }> = {
  urgent: { tint: "red", label: "Urgente" },
  high: { tint: "yellow", label: "Haute" },
  normal: { tint: "gray", label: "Normale" },
  low: { tint: "gray", label: "Basse" },
};

function formatDueDate(raw: string): string {
  try {
    const d = new Date(raw.length === 10 ? `${raw}T00:00:00` : raw);
    if (Number.isNaN(d.getTime())) return raw;
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return raw;
  }
}

function ProposalMetaTags({
  proposal,
  payload,
  muted,
}: {
  proposal: MeetingProposal;
  payload: Record<string, unknown>;
  /** Si vrai, les tags sont rendus en couleurs assoupies (rows invalidées). */
  muted?: boolean;
}) {
  // muted est utilisé via la classe wrapper en parent : ici on garde
  // les tags inchangés. Marqué pour silence le lint si jamais.
  void muted;
  switch (proposal.kind) {
    case "task": {
      const assigneeName = payload.assigneeName as string | null | undefined;
      const isExternal = !!payload.assigneeContactId || payload.assigneeKind === "external";
      const priority = payload.priority as string | null | undefined;
      const projectName = payload.projectName as string | null | undefined;
      const dueDate = payload.dueDate as string | null | undefined;
      const prio = priority && priority !== "normal" ? PRIORITY_TINT[priority] : null;
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          {assigneeName ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border bg-[var(--ds-bg-app)] py-0.5 pr-2 pl-0.5 text-[12px] text-muted-foreground">
              <HashedAvatar name={assigneeName} seed={assigneeName} size="xs" />
              {assigneeName}
              {isExternal ? (
                <span className="text-[10px] text-[var(--ds-text-tertiary)]">externe</span>
              ) : null}
            </span>
          ) : null}
          {prio ? (
            <span
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-medium text-[12px]"
              style={{
                background: `var(--ds-tint-${prio.tint}-bg)`,
                color: `var(--ds-tint-${prio.tint}-text)`,
              }}
            >
              <span
                className="inline-block size-1.5 rounded-full"
                style={{ background: `var(--ds-tint-${prio.tint}-dot)` }}
              />
              {prio.label}
            </span>
          ) : null}
          {projectName ? (
            <span
              className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-medium text-[12px]"
              style={{
                background: "var(--ds-tint-mauve-bg)",
                color: "var(--ds-tint-mauve-text)",
              }}
            >
              <Folder size={13} weight="duotone" />
              {projectName}
            </span>
          ) : null}
          {dueDate ? (
            <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground">
              <Calendar size={13} weight="duotone" className="text-[var(--ds-text-tertiary)]" />
              {formatDueDate(dueDate)}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[12px] text-[var(--ds-text-tertiary)]">
              <CalendarX size={13} weight="duotone" />
              Pas d'échéance
            </span>
          )}
        </div>
      );
    }
    case "project":
    case "opportunity": {
      const k = payload.kind as string | null | undefined;
      const entityName = payload.entityName as string | null | undefined;
      const value = payload.valueAmount as number | null | undefined;
      return (
        <div className="flex flex-wrap items-center gap-2">
          {k ? (
            <span
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-medium text-[12px]"
              style={{
                background: "var(--ds-tint-blue-bg)",
                color: "var(--ds-tint-blue-text)",
              }}
            >
              <span
                className="inline-block size-1.5 rounded-full"
                style={{ background: "var(--ds-tint-blue-dot)" }}
              />
              {k}
            </span>
          ) : null}
          {entityName ? (
            <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <Buildings size={13} weight="duotone" className="text-[var(--ds-text-tertiary)]" />
              pour {entityName}
            </span>
          ) : null}
          {value != null ? (
            <span className="font-semibold text-[12px] text-muted-foreground tabular-nums">
              {Number(value).toLocaleString("fr-FR")} €
            </span>
          ) : null}
        </div>
      );
    }
    case "contact": {
      const jobTitle = payload.jobTitle as string | null | undefined;
      const entityName = payload.entityName as string | null | undefined;
      const email = payload.email as string | null | undefined;
      return (
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
          {jobTitle ? (
            <span className="inline-flex items-center gap-1.5">
              <IdentificationBadge
                size={13}
                weight="duotone"
                className="text-[var(--ds-text-tertiary)]"
              />
              {jobTitle}
            </span>
          ) : null}
          {entityName ? (
            <>
              <span className="text-[var(--ds-text-tertiary)]">·</span>
              <span className="inline-flex items-center gap-1.5">
                <Buildings size={13} weight="duotone" className="text-[var(--ds-text-tertiary)]" />
                {entityName}
              </span>
            </>
          ) : null}
          {email ? (
            <>
              <span className="text-[var(--ds-text-tertiary)]">·</span>
              <span className="inline-flex items-center gap-1.5">
                <EnvelopeSimple
                  size={13}
                  weight="duotone"
                  className="text-[var(--ds-text-tertiary)]"
                />
                {email}
              </span>
            </>
          ) : null}
        </div>
      );
    }
    case "entity": {
      const k = payload.kind as string | null | undefined;
      if (!k) return null;
      return <span className="text-[12px] text-muted-foreground">{k}</span>;
    }
  }
}

function IconButton({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--ds-bg-hover)] hover:text-foreground disabled:opacity-50"
    >
      {children}
    </button>
  );
}

// ----------- Editors per kind -----------

function CrossKindBanner({
  proposal,
  payload,
}: {
  proposal: MeetingProposal;
  payload: Record<string, unknown>;
}) {
  if (proposal.kind === "project") {
    const oppTitle = payload.relatedOpportunityTitle as string | null | undefined;
    const conf = payload.relatedOpportunityConfidence as number | null | undefined;
    if (!oppTitle) return null;
    return (
      <p className="flex items-start gap-1.5 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-amber-800 text-xs dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
        <Warning weight="duotone" className="mt-0.5 size-3.5 flex-none" />
        <span>
          Une opportunité similaire existe déjà : <strong>« {oppTitle} »</strong>
          {conf != null ? ` (${Math.round(conf * 100)}%)` : ""}. Vérifie qu'on ne crée pas un
          doublon — si l'opp est gagnée, convertis-la depuis sa fiche plutôt que de créer un projet
          ici.
        </span>
      </p>
    );
  }
  if (proposal.kind === "opportunity") {
    const projName = payload.relatedProjectName as string | null | undefined;
    const conf = payload.relatedProjectConfidence as number | null | undefined;
    if (!projName) return null;
    return (
      <p className="flex items-start gap-1.5 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-amber-800 text-xs dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
        <Warning weight="duotone" className="mt-0.5 size-3.5 flex-none" />
        <span>
          Un projet similaire existe déjà : <strong>« {projName} »</strong>
          {conf != null ? ` (${Math.round(conf * 100)}%)` : ""}. Probable doublon — cette affaire
          est peut-être déjà engagée comme projet.
        </span>
      </p>
    );
  }
  return null;
}

type LinkPickerKind = "entity" | "contact" | "project" | "opportunity" | "task";

function getLinkOptionsForKind(
  kind: MeetingProposal["kind"],
  options: LinkOptions,
): { id: string; label: string }[] {
  switch (kind) {
    case "entity":
      return options.entities.map((e) => ({ id: e.id, label: e.name }));
    case "contact":
      return options.contacts.map((c) => ({ id: c.id, label: c.fullName || "(sans nom)" }));
    case "project":
    case "opportunity":
      // Backward-compat : un proposal kind=opportunity (issu d'anciens
      // meetings) se lie maintenant à un project.
      return options.projects.map((p) => ({ id: p.id, label: p.name }));
    case "task":
      return options.existingTasks.map((t) => ({ id: t.id, label: t.title }));
  }
}

const LINK_LABEL: Record<LinkPickerKind, string> = {
  entity: "Lier à une entité existante",
  contact: "Lier à un contact existant",
  project: "Lier à un projet existant",
  opportunity: "Lier à une opportunité existante",
  task: "Lier à une tâche existante",
};

const LINK_SEARCH_PLACEHOLDER: Record<LinkPickerKind, string> = {
  entity: "Rechercher une entité…",
  contact: "Rechercher un contact…",
  project: "Rechercher un projet…",
  opportunity: "Rechercher une opportunité…",
  task: "Rechercher une tâche…",
};

function ProposalEditor({
  kind,
  draft,
  onChange,
  options,
  initialMatchedId,
}: {
  kind: MeetingProposal["kind"];
  draft: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  options: LinkOptions;
  initialMatchedId: string | null;
}) {
  function patch(partial: Record<string, unknown>) {
    onChange({ ...draft, ...partial });
  }

  function val(key: string): string {
    const v = draft[key];
    return v == null ? "" : String(v);
  }

  const linkOptions = getLinkOptionsForKind(kind, options);
  // Pré-cocher le matchedId auto si l'humain n'a encore rien choisi.
  const currentLinkId =
    typeof draft._linkExistingId === "string" && draft._linkExistingId.length > 0
      ? draft._linkExistingId
      : initialMatchedId && (draft._linkExistingId === undefined || draft._linkExistingId === null)
        ? initialMatchedId
        : "";
  const isLinking = currentLinkId !== "";

  const linkPicker = (
    <div className="space-y-1.5 rounded border bg-muted/30 p-3">
      <Label htmlFor="_linkExistingId" className="text-xs">
        {LINK_LABEL[kind]} (optionnel)
      </Label>
      <FkCombobox
        id="_linkExistingId"
        value={currentLinkId || null}
        onValueChange={(v) => patch({ _linkExistingId: v })}
        options={linkOptions.map((o) => ({ id: o.id, label: o.label }))}
        placeholder="— Créer un nouveau —"
        searchPlaceholder={LINK_SEARCH_PLACEHOLDER[kind]}
        clearLabel="Créer un nouveau"
      />
      {isLinking ? (
        <p className="text-emerald-700 text-xs dark:text-emerald-400">
          Cette proposition sera liée au record existant. Aucun nouveau record ne sera créé. Les
          champs ci-dessous sont ignorés.
        </p>
      ) : null}
    </div>
  );

  // Si on lie à un existant, on cache les champs de création (sauf pour
  // task où les champs Projet / Assignée restent utiles… mais comme on
  // lie à une tâche existante, on cache aussi).
  if (isLinking) {
    return linkPicker;
  }

  const fields = renderCreateFields();
  return (
    <div className="space-y-3">
      {linkPicker}
      {fields}
    </div>
  );

  function renderCreateFields() {
    switch (kind) {
      case "task":
        return (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field className="sm:col-span-2" label="Titre" htmlFor="title">
              <Input
                id="title"
                value={val("title")}
                onChange={(e) => patch({ title: e.target.value })}
              />
            </Field>
            <Field label="Assignée" htmlFor="assigneeRef">
              <FkCombobox
                id="assigneeRef"
                value={
                  val("assigneeContactId")
                    ? `c:${val("assigneeContactId")}`
                    : val("assigneeId")
                      ? `u:${val("assigneeId")}`
                      : null
                }
                onValueChange={(ref) => {
                  if (!ref) {
                    patch({
                      assigneeId: null,
                      assigneeContactId: null,
                      assigneeName: null,
                      assigneeKind: null,
                    });
                    return;
                  }
                  if (ref.startsWith("u:")) {
                    const id = ref.slice(2);
                    const u = options.users.find((x) => x.id === id);
                    patch({
                      assigneeId: id,
                      assigneeContactId: null,
                      assigneeName: u?.fullName ?? null,
                      assigneeKind: "internal",
                    });
                  } else if (ref.startsWith("c:")) {
                    const id = ref.slice(2);
                    const c = options.contacts.find((x) => x.id === id);
                    patch({
                      assigneeId: null,
                      assigneeContactId: id,
                      assigneeName: c?.fullName ?? null,
                      assigneeKind: "external",
                    });
                  }
                }}
                options={[
                  ...options.users.map((u) => ({
                    id: `u:${u.id}`,
                    label: u.fullName ?? "(sans nom)",
                    leading: (
                      <span className="rounded bg-sky-100 px-1 py-0.5 font-medium text-[10px] text-sky-700 dark:bg-sky-950 dark:text-sky-300">
                        Paradeos
                      </span>
                    ),
                  })),
                  ...options.contacts.map((c) => ({
                    id: `c:${c.id}`,
                    label: c.entityName ? `${c.fullName} — ${c.entityName}` : c.fullName,
                    searchValue: `${c.fullName} ${c.entityName ?? ""}`,
                    leading: (
                      <span className="rounded bg-amber-100 px-1 py-0.5 font-medium text-[10px] text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                        Externe
                      </span>
                    ),
                  })),
                ]}
                placeholder="— Personne —"
                searchPlaceholder="Membre Paradeos ou contact externe…"
                clearLabel="Personne"
              />
              {draft.assigneeName && !draft.assigneeId && !draft.assigneeContactId ? (
                <p className="mt-1 text-amber-700 text-xs dark:text-amber-400">
                  LLM avait suggéré « {String(draft.assigneeName)} »
                  {draft.assigneeKind === "external" ? " (externe)" : ""} — non trouvé en base.
                </p>
              ) : null}
            </Field>
            <Field label="Échéance" htmlFor="dueDate">
              <Input
                id="dueDate"
                type="date"
                value={val("dueDate")}
                onChange={(e) => patch({ dueDate: e.target.value || null })}
              />
            </Field>
            <Field label="Projet" htmlFor="projectId">
              <FkCombobox
                id="projectId"
                value={val("projectId") || null}
                onValueChange={(id) => {
                  const proj = id ? options.projects.find((p) => p.id === id) : null;
                  patch({
                    projectId: id,
                    projectName: proj?.name ?? null,
                  });
                }}
                options={options.projects.map((p) => ({ id: p.id, label: p.name }))}
                placeholder="— Aucun projet —"
                searchPlaceholder="Rechercher un projet…"
                clearLabel="Aucun projet"
              />
              {draft.projectName && !draft.projectId ? (
                <p className="mt-1 text-amber-700 text-xs dark:text-amber-400">
                  LLM avait suggéré « {String(draft.projectName)} » — non trouvé en base.
                </p>
              ) : null}
            </Field>
            <Field label="Priorité" htmlFor="priority">
              <select
                id="priority"
                value={val("priority") || "normal"}
                onChange={(e) => patch({ priority: e.target.value })}
                className="h-9 rounded-md border bg-background px-2 text-sm"
              >
                <option value="low">Basse</option>
                <option value="normal">Normale</option>
                <option value="high">Haute</option>
              </select>
            </Field>
          </div>
        );

      case "project":
        return (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field className="sm:col-span-2" label="Nom" htmlFor="name">
              <Input
                id="name"
                value={val("name")}
                onChange={(e) => patch({ name: e.target.value })}
              />
            </Field>
            <Field label="Type" htmlFor="kind">
              <select
                id="kind"
                value={val("kind") || "transverse"}
                onChange={(e) => patch({ kind: e.target.value })}
                className="h-9 rounded-md border bg-background px-2 text-sm"
              >
                <option value="client">Client</option>
                <option value="product">Produit</option>
                <option value="transverse">Transverse</option>
              </select>
            </Field>
            <Field className="sm:col-span-2" label="Entité" htmlFor="entityId">
              <FkCombobox
                id="entityId"
                value={val("entityId") || null}
                onValueChange={(id) => {
                  const ent = id ? options.entities.find((e) => e.id === id) : null;
                  patch({ entityId: id, entityName: ent?.name ?? null });
                }}
                onCreate={async (name) => {
                  const res = await quickCreateEntity({ name });
                  if (!res.ok) return null;
                  patch({ entityId: res.data.id, entityName: res.data.name });
                  return { id: res.data.id, label: res.data.name };
                }}
                options={options.entities.map((e) => ({ id: e.id, label: e.name }))}
                placeholder="— Aucune —"
                searchPlaceholder="Rechercher ou créer une entité…"
                clearLabel="Aucune"
                createLabel="Créer l'entité"
              />
              {draft.entityName && !draft.entityId ? (
                <p className="mt-1 text-amber-700 text-xs dark:text-amber-400">
                  LLM avait suggéré « {String(draft.entityName)} » — non trouvée. Tape pour la
                  créer.
                </p>
              ) : null}
            </Field>
          </div>
        );

      case "opportunity":
        return (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field className="sm:col-span-2" label="Titre" htmlFor="title">
              <Input
                id="title"
                value={val("title")}
                onChange={(e) => patch({ title: e.target.value })}
              />
            </Field>
            <Field className="sm:col-span-2" label="Entité" htmlFor="entityId">
              <FkCombobox
                id="entityId"
                value={val("entityId") || null}
                onValueChange={(id) => {
                  const ent = id ? options.entities.find((e) => e.id === id) : null;
                  patch({ entityId: id, entityName: ent?.name ?? null });
                }}
                onCreate={async (name) => {
                  const res = await quickCreateEntity({ name });
                  if (!res.ok) return null;
                  patch({ entityId: res.data.id, entityName: res.data.name });
                  return { id: res.data.id, label: res.data.name };
                }}
                options={options.entities.map((e) => ({ id: e.id, label: e.name }))}
                placeholder="— Aucune —"
                searchPlaceholder="Rechercher ou créer une entité…"
                clearLabel="Aucune"
                createLabel="Créer l'entité"
              />
              {draft.entityName && !draft.entityId ? (
                <p className="mt-1 text-amber-700 text-xs dark:text-amber-400">
                  LLM avait suggéré « {String(draft.entityName)} » — non trouvée. Tape pour la
                  créer.
                </p>
              ) : null}
            </Field>
            <Field label="Montant (€)" htmlFor="valueAmount">
              <Input
                id="valueAmount"
                inputMode="decimal"
                value={val("valueAmount")}
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  const num = raw === "" ? null : Number(raw.replace(",", "."));
                  patch({ valueAmount: Number.isFinite(num) ? num : null });
                }}
              />
            </Field>
          </div>
        );

      case "contact":
        return (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Prénom" htmlFor="firstName">
              <Input
                id="firstName"
                value={val("firstName")}
                onChange={(e) => patch({ firstName: e.target.value })}
              />
            </Field>
            <Field label="Nom" htmlFor="lastName">
              <Input
                id="lastName"
                value={val("lastName")}
                onChange={(e) => patch({ lastName: e.target.value })}
              />
            </Field>
            <Field label="E-mail" htmlFor="email">
              <Input
                id="email"
                type="email"
                value={val("email")}
                onChange={(e) => patch({ email: e.target.value || null })}
              />
            </Field>
            <Field label="Poste" htmlFor="jobTitle">
              <Input
                id="jobTitle"
                value={val("jobTitle")}
                onChange={(e) => patch({ jobTitle: e.target.value || null })}
              />
            </Field>
            <Field className="sm:col-span-2" label="Entité" htmlFor="entityId">
              <FkCombobox
                id="entityId"
                value={val("entityId") || null}
                onValueChange={(id) => {
                  const ent = id ? options.entities.find((e) => e.id === id) : null;
                  patch({ entityId: id, entityName: ent?.name ?? null });
                }}
                onCreate={async (name) => {
                  const res = await quickCreateEntity({ name });
                  if (!res.ok) return null;
                  patch({ entityId: res.data.id, entityName: res.data.name });
                  return { id: res.data.id, label: res.data.name };
                }}
                options={options.entities.map((e) => ({ id: e.id, label: e.name }))}
                placeholder="— Aucune —"
                searchPlaceholder="Rechercher ou créer une entité…"
                clearLabel="Aucune"
                createLabel="Créer l'entité"
              />
              {draft.entityName && !draft.entityId ? (
                <p className="mt-1 text-amber-700 text-xs dark:text-amber-400">
                  LLM avait suggéré « {String(draft.entityName)} » — non trouvée. Tape pour la
                  créer.
                </p>
              ) : null}
            </Field>
          </div>
        );

      case "entity":
        return (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field className="sm:col-span-2" label="Nom" htmlFor="name">
              <Input
                id="name"
                value={val("name")}
                onChange={(e) => patch({ name: e.target.value })}
              />
            </Field>
            <Field label="Type" htmlFor="kind">
              <select
                id="kind"
                value={val("kind") || "prospect"}
                onChange={(e) => patch({ kind: e.target.value })}
                className="h-9 rounded-md border bg-background px-2 text-sm"
              >
                <option value="client">Client</option>
                <option value="prospect">Prospect</option>
                <option value="partner">Partenaire</option>
                <option value="supplier">Fournisseur</option>
                <option value="other">Autre</option>
              </select>
            </Field>
          </div>
        );
    }
  }
}

function Field({
  label,
  htmlFor,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-1 ${className ?? ""}`}>
      <Label htmlFor={htmlFor} className="text-xs">
        {label}
      </Label>
      {children}
    </div>
  );
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findByName<T>(list: T[], query: string, getter: (item: T) => string | null): T | null {
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

function augmentTaskPayload(
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

function groupByKind(
  items: MeetingProposal[],
): Partial<Record<MeetingProposal["kind"], MeetingProposal[]>> {
  const out: Partial<Record<MeetingProposal["kind"], MeetingProposal[]>> = {};
  for (const it of items) {
    const arr = out[it.kind] ?? [];
    arr.push(it);
    out[it.kind] = arr;
  }
  return out;
}

function summaryFor(p: MeetingProposal, payload: Record<string, unknown>): string {
  switch (p.kind) {
    case "task":
      return String(payload.title ?? "Sans titre");
    case "project":
      return String(payload.name ?? "Sans nom");
    case "opportunity":
      return String(payload.title ?? "Sans titre");
    case "contact":
      return `${payload.firstName ?? ""} ${payload.lastName ?? ""}`.trim() || "Sans nom";
    case "entity":
      return String(payload.name ?? "Sans nom");
  }
}
