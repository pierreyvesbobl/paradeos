"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { MeetingProposal } from "@/db/schema/meetings";
import { decideProposal, revertProposal } from "@/lib/actions/meetings";
import { Check, Pencil, RotateCcw, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
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

export function ProposalsPanel({
  pending,
  decided,
  projects,
  users,
}: {
  pending: MeetingProposal[];
  decided: MeetingProposal[];
  projects: ProjectOption[];
  users: UserOption[];
}) {
  if (pending.length === 0 && decided.length === 0) {
    return (
      <section className="rounded-lg border bg-card p-6">
        <p className="text-muted-foreground text-sm">
          Aucune proposition. Lance "Ré-extraire" pour générer le résumé et les propositions.
        </p>
      </section>
    );
  }

  const grouped = groupByKind(pending);

  return (
    <div className="space-y-4">
      {KIND_ORDER.filter((k) => (grouped[k]?.length ?? 0) > 0).map((kind) => (
        <section key={kind} className="rounded-lg border bg-card">
          <header className="flex items-center justify-between border-b px-4 py-2">
            <h2 className="font-medium text-sm">
              {KIND_LABEL[kind]}{" "}
              <span className="text-muted-foreground text-xs">({grouped[kind]?.length ?? 0})</span>
            </h2>
            <BulkAcceptButton ids={(grouped[kind] ?? []).map((p) => p.id)} />
          </header>
          <ul className="divide-y">
            {(grouped[kind] ?? []).map((p) => (
              <ProposalRow key={p.id} proposal={p} projects={projects} users={users} />
            ))}
          </ul>
        </section>
      ))}

      {decided.length > 0 ? (
        <details className="rounded-lg border bg-card" open>
          <summary className="cursor-pointer px-4 py-2 font-medium text-sm">
            Historique ({decided.length})
          </summary>
          <ul className="divide-y">
            {decided.map((p) => (
              <DecidedRow key={p.id} proposal={p} />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function BulkAcceptButton({ ids }: { ids: string[] }) {
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
            if (res.ok) ok++;
            else fail++;
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
  projects,
  users,
}: {
  proposal: MeetingProposal;
  projects: ProjectOption[];
  users: UserOption[];
}) {
  const router = useRouter();
  const initial = proposal.payload as Record<string, unknown>;
  // Pour les tâches : tente de résoudre côté client le projet/user
  // suggérés par le LLM, au cas où la pré-résolution serveur n'a rien
  // trouvé (anciennes propositions, ou matching strict trop restrictif).
  const augmented =
    proposal.kind === "task" ? augmentTaskPayload(initial, projects, users) : initial;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown>>(augmented);
  const [pending, startTransition] = useTransition();

  const matched = proposal.matchedId !== null;
  const confidence = proposal.matchConfidence ? Number(proposal.matchConfidence) : null;

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
      toast.success(action === "accept" ? "Accepté." : "Rejeté.");
      router.refresh();
    });
  }

  return (
    <li className="px-4 py-3">
      {editing ? (
        <div className="space-y-3">
          <ProposalEditor
            kind={proposal.kind}
            draft={draft}
            onChange={setDraft}
            projects={projects}
            users={users}
          />
          {matched ? (
            <p className="text-amber-700 text-xs dark:text-amber-400">
              Cette proposition allait être liée à un record existant. Si tu modifies les champs, le
              lien sera ignoré et un nouveau record sera créé.
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
            <Button size="sm" disabled={pending} onClick={() => decide("accept", draft)}>
              <Check className="size-4" />
              Accepter
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <div className="flex-1 space-y-1">
            <p className="font-medium text-sm leading-tight">{summaryFor(proposal, initial)}</p>
            <p className="text-muted-foreground text-xs">{detailsFor(proposal, initial)}</p>
            {matched ? (
              <p className="text-emerald-700 text-xs dark:text-emerald-400">
                Match existant ({confidence != null ? `${Math.round(confidence * 100)}%` : "—"}) —
                sera lié au record actuel.
              </p>
            ) : null}
            <CrossKindBanner proposal={proposal} payload={initial} />
          </div>
          <div className="flex shrink-0 gap-1">
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
              onClick={() => setEditing(true)}
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
          </div>
        </div>
      )}
    </li>
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

function DecidedRow({ proposal }: { proposal: MeetingProposal }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function restore() {
    startTransition(async () => {
      const res = await revertProposal({ proposalId: proposal.id });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Proposition remise en attente.");
      router.refresh();
    });
  }

  return (
    <li className="flex items-center justify-between gap-3 px-4 py-2 text-muted-foreground text-sm">
      <span className="min-w-0 flex-1 truncate">
        <span className="font-mono text-[10px] uppercase tracking-wide">[{proposal.kind}]</span>{" "}
        {summaryFor(proposal, proposal.payload as Record<string, unknown>)}
      </span>
      <span
        className={`shrink-0 text-xs ${
          proposal.status === "accepted" ? "text-emerald-600" : "text-rose-600"
        }`}
      >
        {proposal.status === "accepted" ? "Accepté" : "Rejeté"}
      </span>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={restore}
        title="Restaurer (remet en attente)"
      >
        <RotateCcw className="size-3.5" />
      </Button>
    </li>
  );
}

function ProposalEditor({
  kind,
  draft,
  onChange,
  projects,
  users,
}: {
  kind: MeetingProposal["kind"];
  draft: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  projects: ProjectOption[];
  users: UserOption[];
}) {
  function patch(partial: Record<string, unknown>) {
    onChange({ ...draft, ...partial });
  }

  function val(key: string): string {
    const v = draft[key];
    return v == null ? "" : String(v);
  }

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
                const user = id ? users.find((u) => u.id === id) : null;
                patch({
                  assigneeId: id,
                  assigneeName: user?.fullName ?? null,
                });
              }}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              <option value="">— Personne —</option>
              {users.map((u) => (
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
                const proj = id ? projects.find((p) => p.id === id) : null;
                patch({
                  projectId: id,
                  projectName: proj?.name ?? null,
                });
              }}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              <option value="">— Aucun projet —</option>
              {projects.map((p) => (
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
