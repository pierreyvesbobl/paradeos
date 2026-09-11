"use client";

import { FkCombobox } from "@/components/inline/fk-combobox";
import { type AssigneeRef, AssigneesPicker } from "@/components/tasks/assignees-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { quickCreateEntity } from "@/lib/actions/entities";
import { type EditableKind, type StoredAssignee, readAssignees } from "./helpers";
import type { LinkOptions, ProposalSourceAdapter } from "./types";
import { Field } from "./ui";

const LINK_LABEL: Record<EditableKind, string> = {
  task: "Lier à une tâche existante",
  project: "Lier à un projet existant",
  opportunity: "Lier à une opportunité existante",
  contact: "Lier à un contact existant",
  entity: "Lier à une entité existante",
};

const LINK_SEARCH_PLACEHOLDER: Record<EditableKind, string> = {
  task: "Rechercher une tâche…",
  project: "Rechercher un projet…",
  opportunity: "Rechercher une opportunité…",
  contact: "Rechercher un contact…",
  entity: "Rechercher une entité…",
};

function linkOptionsForKind(kind: EditableKind, options: LinkOptions) {
  switch (kind) {
    case "entity":
      return options.entities.map((e) => ({ id: e.id, label: e.name }));
    case "contact":
      return options.contacts.map((c) => ({ id: c.id, label: c.fullName || "(sans nom)" }));
    case "project":
    case "opportunity":
      // Un proposal kind=opportunity (anciens meetings) se lie à un projet.
      return options.projects.map((p) => ({ id: p.id, label: p.name }));
    case "task":
      return (options.existingTasks ?? []).map((t) => ({ id: t.id, label: t.title }));
  }
}

/**
 * Formulaire d'édition d'une proposition : picker « lier à un existant »
 * (masqué quand la source n'a pas de référentiel pour ce kind), puis les
 * champs de création tant qu'aucun record existant n'est sélectionné.
 */
export function ProposalEditor({
  kind,
  draft,
  onChange,
  options,
  initialMatchedId,
  taskAssigneeField,
}: {
  kind: EditableKind;
  draft: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  options: LinkOptions;
  initialMatchedId: string | null;
  taskAssigneeField: ProposalSourceAdapter["taskAssigneeField"];
}) {
  function patch(partial: Record<string, unknown>) {
    onChange({ ...draft, ...partial });
  }
  function val(key: string): string {
    const v = draft[key];
    return v == null ? "" : String(v);
  }

  const linkOptions = linkOptionsForKind(kind, options);
  // Pré-coche le matchedId auto tant que l'humain n'a rien choisi.
  const currentLinkId =
    typeof draft._linkExistingId === "string" && draft._linkExistingId.length > 0
      ? draft._linkExistingId
      : initialMatchedId && (draft._linkExistingId === undefined || draft._linkExistingId === null)
        ? initialMatchedId
        : "";
  const isLinking = currentLinkId !== "";

  const linkPicker =
    linkOptions.length > 0 ? (
      <div className="space-y-1.5 rounded border bg-muted/30 p-3">
        <Label htmlFor="_linkExistingId" className="text-xs">
          {LINK_LABEL[kind]} (optionnel)
        </Label>
        <FkCombobox
          id="_linkExistingId"
          value={currentLinkId || null}
          onValueChange={(v) => patch({ _linkExistingId: v })}
          options={linkOptions}
          placeholder="— Créer un nouveau —"
          searchPlaceholder={LINK_SEARCH_PLACEHOLDER[kind]}
          clearLabel="Créer un nouveau"
        />
        {isLinking ? (
          <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
            Cette proposition sera liée au record existant. Aucun nouveau record ne sera créé.
          </p>
        ) : null}
      </div>
    ) : null;

  if (isLinking) return <>{linkPicker}</>;

  return (
    <div className="space-y-3">
      {linkPicker}
      {renderCreateFields()}
    </div>
  );

  function entityField() {
    return (
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
          <Suggestion>
            LLM avait suggéré « {String(draft.entityName)} » — non trouvée. Tape pour la créer.
          </Suggestion>
        ) : null}
      </Field>
    );
  }

  function amountField() {
    return (
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
    );
  }

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
            {taskAssigneeField === "multi" ? (
              <Field className="sm:col-span-2" label="Assignés" htmlFor="assignees">
                <TaskAssigneesField draft={draft} onPatch={patch} options={options} />
                {draft.assigneeName && readAssignees(draft).length === 0 ? (
                  <Suggestion>
                    LLM avait suggéré « {String(draft.assigneeName)} » — non trouvé en base.
                  </Suggestion>
                ) : null}
              </Field>
            ) : (
              <Field label="Assignée" htmlFor="assigneeRef">
                <TaskSingleAssigneeField draft={draft} onPatch={patch} options={options} />
                {draft.assigneeName && !draft.assigneeId && !draft.assigneeContactId ? (
                  <Suggestion>
                    LLM avait suggéré « {String(draft.assigneeName)} »
                    {draft.assigneeKind === "external" ? " (externe)" : ""} — non trouvé en base.
                  </Suggestion>
                ) : null}
              </Field>
            )}
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
                  patch({ projectId: id, projectName: proj?.name ?? null });
                }}
                options={options.projects.map((p) => ({ id: p.id, label: p.name }))}
                placeholder="— Aucun projet —"
                searchPlaceholder="Rechercher un projet…"
                clearLabel="Aucun projet"
              />
              {draft.projectName && !draft.projectId ? (
                <Suggestion>
                  LLM avait suggéré « {String(draft.projectName)} » — non trouvé en base.
                </Suggestion>
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
                value={val("kind") || "client"}
                onChange={(e) => patch({ kind: e.target.value })}
                className="h-9 rounded-md border bg-background px-2 text-sm"
              >
                <option value="client">Client</option>
                <option value="product">Produit</option>
                <option value="transverse">Transverse</option>
              </select>
            </Field>
            {entityField()}
            {amountField()}
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
            {entityField()}
            {amountField()}
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
            {entityField()}
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

function Suggestion({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">{children}</p>;
}

// ─── Assignés de tâche : multi (task_assignees) ─────────────────────────

function TaskAssigneesField({
  draft,
  onPatch,
  options,
}: {
  draft: Record<string, unknown>;
  onPatch: (partial: Record<string, unknown>) => void;
  options: LinkOptions;
}) {
  const stored = readAssignees(draft);
  // Hydrate en refs enrichies (fullName/entityName/avatarUrl) pour le picker.
  const value: AssigneeRef[] = stored
    .map((a) => {
      if (a.kind === "user") {
        const u = options.users.find((x) => x.id === a.id);
        if (!u) return null;
        return {
          kind: "user" as const,
          id: u.id,
          fullName: u.fullName,
          avatarUrl: u.avatarUrl ?? null,
        };
      }
      const c = options.contacts.find((x) => x.id === a.id);
      if (!c) return null;
      return {
        kind: "contact" as const,
        id: c.id,
        fullName: c.fullName,
        entityName: c.entityName ?? null,
      };
    })
    .filter((x): x is AssigneeRef => x !== null);

  function handleChange(next: AssigneeRef[]) {
    // Écrit un tableau minimal { kind, id } dans le payload — les
    // fullName/entityName sont ré-hydratés à chaque render depuis options.
    const minimal: StoredAssignee[] = next.map((a) => ({ kind: a.kind, id: a.id }));
    onPatch({
      assignees: minimal,
      // Nettoie les champs legacy pour éviter les états incohérents à
      // l'acceptation côté serveur.
      assigneeId: null,
      assigneeContactId: null,
      assigneeName: minimal.length > 0 ? undefined : null,
      assigneeKind: null,
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border bg-background p-2">
      {value.length === 0 ? (
        <span className="text-[12px] text-muted-foreground">Personne</span>
      ) : (
        value.map((a) => (
          <span
            key={`${a.kind}:${a.id}`}
            className="inline-flex items-center gap-1.5 rounded-full border bg-[var(--ds-bg-app)] py-0.5 pr-2 pl-2 text-[12px]"
          >
            {a.fullName ?? "(sans nom)"}
            {a.kind === "contact" ? (
              <span className="text-[10px] text-[var(--ds-text-tertiary)]">externe</span>
            ) : null}
          </span>
        ))
      )}
      <div className="ml-auto">
        <AssigneesPicker
          value={value}
          onChange={handleChange}
          userOptions={options.users.map((u) => ({
            id: u.id,
            fullName: u.fullName,
            avatarUrl: u.avatarUrl ?? null,
          }))}
          contactOptions={options.contacts.map((c) => ({
            id: c.id,
            fullName: c.fullName,
            entityName: c.entityName ?? null,
          }))}
        />
      </div>
    </div>
  );
}

// ─── Assigné de tâche : mono legacy (assigneeId | assigneeContactId) ────

function TaskSingleAssigneeField({
  draft,
  onPatch,
  options,
}: {
  draft: Record<string, unknown>;
  onPatch: (partial: Record<string, unknown>) => void;
  options: LinkOptions;
}) {
  const contactId = draft.assigneeContactId;
  const userId = draft.assigneeId;
  const value =
    typeof contactId === "string" && contactId
      ? `c:${contactId}`
      : typeof userId === "string" && userId
        ? `u:${userId}`
        : null;

  return (
    <FkCombobox
      id="assigneeRef"
      value={value}
      onValueChange={(ref) => {
        if (!ref) {
          onPatch({
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
          onPatch({
            assigneeId: id,
            assigneeContactId: null,
            assigneeName: u?.fullName ?? null,
            assigneeKind: "internal",
          });
        } else if (ref.startsWith("c:")) {
          const id = ref.slice(2);
          const c = options.contacts.find((x) => x.id === id);
          onPatch({
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
  );
}
