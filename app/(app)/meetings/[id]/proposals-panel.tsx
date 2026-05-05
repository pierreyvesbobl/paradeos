"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { MeetingProposal } from "@/db/schema/meetings";
import { decideProposal, revertProposal, updateAcceptedProposal } from "@/lib/actions/meetings";
import { Check, Pencil, RotateCcw, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

const KIND_LABEL: Record<MeetingProposal["kind"], string> = {
  task: "Tâches",
  project: "Projets",
  opportunity: "Opportunités",
  contact: "Contacts",
  entity: "Entités",
};

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
type ContactOption = { id: string; fullName: string };

type LinkOptions = {
  projects: ProjectOption[];
  users: UserOption[];
  entities: NamedOption[];
  contacts: ContactOption[];
  opportunities: TitledOption[];
  existingTasks: TitledOption[];
};

export function ProposalsPanel({
  proposals: serverProposals,
  projects,
  users,
  entities,
  contacts,
  opportunities,
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
    opportunities,
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

  const grouped = groupByKind(proposals);
  // Tri intra-section : pending → accepted → rejected.
  const orderRank: Record<MeetingProposal["status"], number> = {
    pending: 0,
    accepted: 1,
    rejected: 2,
  };

  return (
    <div className="space-y-4">
      {KIND_ORDER.filter((k) => (grouped[k]?.length ?? 0) > 0).map((kind) => {
        const all = (grouped[kind] ?? [])
          .slice()
          .sort((a, b) => orderRank[a.status] - orderRank[b.status]);
        const pendingCount = all.filter((p) => p.status === "pending").length;
        const acceptedCount = all.filter((p) => p.status === "accepted").length;
        const rejectedCount = all.filter((p) => p.status === "rejected").length;
        return (
          <section key={kind} className="rounded-lg border bg-card">
            <header className="flex items-center justify-between border-b px-4 py-2">
              <h2 className="font-medium text-sm">
                {KIND_LABEL[kind]}{" "}
                <span className="ml-1 inline-flex items-center gap-2 text-xs">
                  {pendingCount > 0 ? (
                    <span className="text-muted-foreground">{pendingCount} à valider</span>
                  ) : null}
                  {acceptedCount > 0 ? (
                    <span className="text-emerald-600">{acceptedCount} ✓</span>
                  ) : null}
                  {rejectedCount > 0 ? (
                    <span className="text-rose-600">{rejectedCount} ✗</span>
                  ) : null}
                </span>
              </h2>
              <BulkAcceptButton
                ids={all.filter((p) => p.status === "pending").map((p) => p.id)}
                onAccepted={(id) =>
                  patchProposal(id, (p) => ({
                    ...p,
                    status: "accepted",
                    decidedAt: new Date(),
                  }))
                }
              />
            </header>
            <ul className="divide-y">
              {all.map((p) => (
                <ProposalRow
                  key={p.id}
                  proposal={p}
                  options={linkOptions}
                  onChange={(next) => patchProposal(p.id, () => next)}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function BulkAcceptButton({
  ids,
  onAccepted,
}: {
  ids: string[];
  onAccepted: (id: string) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (ids.length === 0) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          let ok = 0;
          let fail = 0;
          for (const id of ids) {
            const res = await decideProposal({ proposalId: id, action: "accept" });
            if (res.ok) {
              ok++;
              onAccepted(id);
            } else fail++;
          }
          if (ok > 0) toast.success(`${ok} accepté(s).`);
          if (fail > 0) toast.error(`${fail} échec(s).`);
          router.refresh();
        })
      }
    >
      Tout accepter
    </Button>
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
      ? augmentTaskPayload(initial, options.projects, options.users)
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
          )
        : (proposal.payload as Record<string, unknown>),
    );
    setEditing(true);
  }

  // Visuel selon le statut.
  const rowBg = isAccepted
    ? "bg-emerald-50/50 dark:bg-emerald-950/20"
    : isRejected
      ? "bg-muted/30 opacity-60"
      : "";

  return (
    <li className={`px-4 py-3 ${rowBg}`}>
      {editing ? (
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
                <Check className="size-4" />
                Enregistrer
              </Button>
            ) : (
              <Button size="sm" disabled={pending} onClick={() => decide("accept", draft)}>
                <Check className="size-4" />
                Accepter
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <StatusDot status={proposal.status} />
          <div className="flex-1 space-y-1">
            <p className={`font-medium text-sm leading-tight ${isRejected ? "line-through" : ""}`}>
              {summaryFor(proposal, initial)}
            </p>
            <p className="text-muted-foreground text-xs">{detailsFor(proposal, initial)}</p>
            {!isAccepted && !isRejected && matched ? (
              <p className="text-emerald-700 text-xs dark:text-emerald-400">
                Match existant ({confidence != null ? `${Math.round(confidence * 100)}%` : "—"}) —
                sera lié au record actuel.
              </p>
            ) : null}
            {!isAccepted && !isRejected ? (
              <CrossKindBanner proposal={proposal} payload={initial} />
            ) : null}
          </div>
          <div className="flex shrink-0 gap-1">
            {isAccepted ? (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={startEditing}
                  title="Modifier le record lié"
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={restore}
                  title="Remettre en attente"
                >
                  <RotateCcw className="size-4" />
                </Button>
              </>
            ) : isRejected ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={restore}
                title="Remettre en attente"
              >
                <RotateCcw className="size-4" />
              </Button>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => decide("accept")}
                  title="Accepter"
                >
                  <Check className="size-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={startEditing}
                  title="Modifier"
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => decide("reject")}
                  title="Rejeter"
                >
                  <X className="size-4" />
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

function StatusDot({ status }: { status: MeetingProposal["status"] }) {
  const cls =
    status === "accepted"
      ? "bg-emerald-500"
      : status === "rejected"
        ? "bg-rose-400"
        : "bg-amber-400";
  const title = status === "accepted" ? "Accepté" : status === "rejected" ? "Rejeté" : "À valider";
  return (
    <span
      className={`mt-1.5 size-2 shrink-0 rounded-full ${cls}`}
      title={title}
      aria-label={title}
    />
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
      <p className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-amber-800 text-xs dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
        ⚠️ Une opportunité similaire existe déjà : <strong>« {oppTitle} »</strong>
        {conf != null ? ` (${Math.round(conf * 100)}%)` : ""}. Vérifie qu'on ne crée pas un doublon
        — si l'opp est gagnée, convertis-la depuis sa fiche plutôt que de créer un projet ici.
      </p>
    );
  }
  if (proposal.kind === "opportunity") {
    const projName = payload.relatedProjectName as string | null | undefined;
    const conf = payload.relatedProjectConfidence as number | null | undefined;
    if (!projName) return null;
    return (
      <p className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-amber-800 text-xs dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
        ⚠️ Un projet similaire existe déjà : <strong>« {projName} »</strong>
        {conf != null ? ` (${Math.round(conf * 100)}%)` : ""}. Probable doublon — cette affaire est
        peut-être déjà engagée comme projet.
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
      return options.projects.map((p) => ({ id: p.id, label: p.name }));
    case "opportunity":
      return options.opportunities.map((o) => ({ id: o.id, label: o.title }));
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
    <div className="space-y-1 rounded border bg-muted/30 p-3">
      <Label htmlFor="_linkExistingId" className="text-xs">
        {LINK_LABEL[kind]} (optionnel)
      </Label>
      <select
        id="_linkExistingId"
        value={currentLinkId}
        onChange={(e) => patch({ _linkExistingId: e.target.value || null })}
        className="block h-9 w-full rounded-md border bg-background px-2 text-sm"
      >
        <option value="">— Créer un nouveau —</option>
        {linkOptions.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
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
            <Field label="Assignée" htmlFor="assigneeId">
              <select
                id="assigneeId"
                value={val("assigneeId")}
                onChange={(e) => {
                  const id = e.target.value || null;
                  const user = id ? options.users.find((u) => u.id === id) : null;
                  patch({
                    assigneeId: id,
                    assigneeName: user?.fullName ?? null,
                  });
                }}
                className="h-9 rounded-md border bg-background px-2 text-sm"
              >
                <option value="">— Personne —</option>
                {options.users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName ?? "(sans nom)"}
                  </option>
                ))}
              </select>
              {draft.assigneeName && !draft.assigneeId ? (
                <p className="mt-1 text-amber-700 text-xs dark:text-amber-400">
                  LLM avait suggéré « {String(draft.assigneeName)} » — non trouvé en base.
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
              <select
                id="projectId"
                value={val("projectId")}
                onChange={(e) => {
                  const id = e.target.value || null;
                  const proj = id ? options.projects.find((p) => p.id === id) : null;
                  patch({
                    projectId: id,
                    projectName: proj?.name ?? null,
                  });
                }}
                className="h-9 rounded-md border bg-background px-2 text-sm"
              >
                <option value="">— Aucun projet —</option>
                {options.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
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
            <Field label="Entité (nom)" htmlFor="entityName">
              <Input
                id="entityName"
                value={val("entityName")}
                onChange={(e) => patch({ entityName: e.target.value || null })}
              />
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
            <Field label="Entité (nom)" htmlFor="entityName">
              <Input
                id="entityName"
                value={val("entityName")}
                onChange={(e) => patch({ entityName: e.target.value || null })}
              />
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
            <Field className="sm:col-span-2" label="Entité (nom)" htmlFor="entityName">
              <Input
                id="entityName"
                value={val("entityName")}
                onChange={(e) => patch({ entityName: e.target.value || null })}
              />
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
): Record<string, unknown> {
  const next = { ...payload };
  if (!next.assigneeId && typeof next.assigneeName === "string" && next.assigneeName) {
    const u = findByName(users, next.assigneeName, (x) => x.fullName);
    if (u) next.assigneeId = u.id;
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

function detailsFor(p: MeetingProposal, payload: Record<string, unknown>): string {
  const bits: string[] = [];
  switch (p.kind) {
    case "task":
      if (payload.assigneeName) bits.push(`→ ${payload.assigneeName}`);
      if (payload.dueDate) bits.push(`📅 ${payload.dueDate}`);
      if (payload.projectName) bits.push(`📁 ${payload.projectName}`);
      if (payload.priority && payload.priority !== "normal")
        bits.push(`priorité ${payload.priority}`);
      break;
    case "project":
      if (payload.kind) bits.push(String(payload.kind));
      if (payload.entityName) bits.push(`pour ${payload.entityName}`);
      break;
    case "opportunity":
      if (payload.entityName) bits.push(`avec ${payload.entityName}`);
      if (payload.valueAmount)
        bits.push(`${Number(payload.valueAmount).toLocaleString("fr-FR")} €`);
      break;
    case "contact":
      if (payload.jobTitle) bits.push(String(payload.jobTitle));
      if (payload.entityName) bits.push(`@ ${payload.entityName}`);
      if (payload.email) bits.push(String(payload.email));
      break;
    case "entity":
      if (payload.kind) bits.push(String(payload.kind));
      break;
  }
  return bits.join(" · ") || "—";
}
