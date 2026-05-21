"use client";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import {
  backfillCrmTagsAction,
  createCategoryTagAction,
  deleteTagAction,
  renameTagAction,
} from "@/lib/actions/gmail";
import { Briefcase, Building2, Check, Pencil, Plus, Tag, Trash2, Wand2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

type TagRow = {
  id: string;
  kind: "project" | "contact" | "entity" | "category";
  targetId: string | null;
  labelName: string;
  gmailLabelId: string | null;
  threadCount: number;
};

type Props = {
  scopesOk: boolean;
  categories: TagRow[];
  projects: TagRow[];
  entities: TagRow[];
};

export function TagsManagement({ scopesOk, categories, projects, entities }: Props) {
  const [pending, startTransition] = useTransition();
  const [lastErrors, setLastErrors] = useState<string[]>([]);

  // Compteur de tags sans gmail_label_id (label Gmail pas encore créé).
  const pendingLabelsCount =
    projects.filter((t) => !t.gmailLabelId).length +
    entities.filter((t) => !t.gmailLabelId).length +
    categories.filter((t) => !t.gmailLabelId).length;

  function backfill() {
    setLastErrors([]);
    startTransition(async () => {
      const res = await backfillCrmTagsAction({});
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      const { projectsTagged, entitiesTagged, labelsCreated, errors } = res.data;
      if (errors.length > 0) {
        setLastErrors(errors);
        toast.error(
          `Backfill : ${labelsCreated} label(s) créé(s), ${errors.length} erreur(s). Détails ci-dessous.`,
        );
        return;
      }
      toast.success(
        `Tags CRM : ${projectsTagged} projet(s), ${entitiesTagged} entité(s). ${labelsCreated} label(s) Gmail créé(s).`,
      );
    });
  }

  return (
    <div className="space-y-6">
      {/* Backfill bouton */}
      <section className="rounded-lg border bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-medium text-sm">Initialiser les tags CRM</h2>
            <p className="mt-1 text-muted-foreground text-xs">
              Crée un label Gmail "Paradeos/Projets/X" et "Paradeos/Entités/X" pour chaque projet et
              entité du CRM (les contacts sont exclus pour éviter de saturer la liste de labels).
              Idempotent — relance sans risque après avoir ajouté de nouveaux records.
            </p>
            {pendingLabelsCount > 0 ? (
              <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                {pendingLabelsCount} tag(s) en base sans label Gmail. Re-clique "Lancer" pour
                retenter la création côté Gmail.
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            onClick={backfill}
            disabled={pending || !scopesOk}
            size="sm"
            className="gap-1.5"
            title={
              !scopesOk
                ? "Reconnecte Google avec le scope gmail.modify pour activer ce bouton"
                : undefined
            }
          >
            <Wand2 className={`size-3.5 ${pending ? "animate-spin" : ""}`} />
            Lancer
          </Button>
        </div>

        {lastErrors.length > 0 ? (
          <details className="mt-3 rounded border border-rose-300 bg-rose-50 p-2 text-rose-900 text-xs dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200">
            <summary className="cursor-pointer font-medium">
              {lastErrors.length} erreur(s) lors du dernier backfill
            </summary>
            <ul className="mt-2 space-y-1 font-mono text-[10px]">
              {lastErrors.slice(0, 20).map((e) => (
                <li key={e}>{e}</li>
              ))}
              {lastErrors.length > 20 ? <li>… +{lastErrors.length - 20} autre(s)</li> : null}
            </ul>
          </details>
        ) : null}
      </section>

      {/* Catégories libres */}
      <CategoriesSection categories={categories} />

      {/* Tags CRM (read-only ici, gérés depuis leurs fiches) */}
      <CrmSection title="Projets" icon={Briefcase} tags={projects} kindHref="projets" />
      <CrmSection title="Entités" icon={Building2} tags={entities} kindHref="entites" />
    </div>
  );
}

function CategoriesSection({ categories }: { categories: TagRow[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();

  function create() {
    const n = name.trim();
    if (!n) return;
    startTransition(async () => {
      const res = await createCategoryTagAction({ name: n });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(`Catégorie « ${n} » créée.`);
      setName("");
      setCreating(false);
      router.refresh();
    });
  }

  return (
    <section className="rounded-lg border bg-card p-4">
      <header className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Tag className="size-4 text-muted-foreground" />
          <h2 className="font-medium text-sm">Catégories libres ({categories.length})</h2>
        </div>
        {!creating ? (
          <Button type="button" size="sm" variant="outline" onClick={() => setCreating(true)}>
            <Plus className="size-3.5" />
            Nouvelle
          </Button>
        ) : null}
      </header>

      {creating ? (
        <div className="mb-3 flex items-center gap-1">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nom de la catégorie (Compta, Annexe, Admin…)"
            disabled={pending}
            className="h-8 text-xs"
            // biome-ignore lint/a11y/noAutofocus: form inline
            autoFocus
          />
          <Button type="button" size="sm" onClick={create} disabled={pending || !name.trim()}>
            Créer
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setCreating(false);
              setName("");
            }}
            disabled={pending}
          >
            Annuler
          </Button>
        </div>
      ) : null}

      {categories.length === 0 ? (
        <p className="text-muted-foreground text-xs italic">
          Aucune catégorie. Crée-en pour classer les emails sortant du contexte projet (Compta,
          Admin, Support…).
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {categories.map((t) => (
            <CategoryRow key={t.id} tag={t} />
          ))}
        </ul>
      )}
    </section>
  );
}

function CategoryRow({ tag }: { tag: TagRow }) {
  const router = useRouter();
  const display = tag.labelName.split("/").pop() ?? tag.labelName;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(display);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function rename() {
    const n = name.trim();
    if (!n || n === display) {
      setEditing(false);
      setName(display);
      return;
    }
    startTransition(async () => {
      const res = await renameTagAction({ tagId: tag.id, newName: n });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Renommé.");
      setEditing(false);
      router.refresh();
    });
  }

  function remove() {
    startTransition(async () => {
      const res = await deleteTagAction({ tagId: tag.id });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Catégorie supprimée.");
      setConfirmOpen(false);
      router.refresh();
    });
  }

  return (
    <li className="flex items-center gap-2 px-3 py-2">
      {editing ? (
        <>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={pending}
            className="h-7 flex-1 text-xs"
            // biome-ignore lint/a11y/noAutofocus: edit inline
            autoFocus
          />
          <Button type="button" size="sm" variant="ghost" onClick={rename} disabled={pending}>
            <Check className="size-3.5" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditing(false);
              setName(display);
            }}
            disabled={pending}
          >
            <X className="size-3.5" />
          </Button>
        </>
      ) : (
        <>
          <Tag className="size-3.5 text-muted-foreground" />
          <span className="flex-1 truncate text-sm">{display}</span>
          <span className="text-[11px] text-muted-foreground">{tag.threadCount} thread(s)</span>
          {tag.gmailLabelId ? null : (
            <span className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-800">
              Label Gmail pas encore créé
            </span>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setEditing(true)}
            className="h-7 px-1.5"
          >
            <Pencil className="size-3.5" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setConfirmOpen(true)}
            className="h-7 px-1.5 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </>
      )}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Supprimer « ${display} » ?`}
        description="Le label Gmail correspondant sera supprimé. Les threads taggés perdront ce tag mais les emails restent intacts dans Gmail."
        confirmLabel="Supprimer"
        variant="destructive"
        onConfirm={remove}
        pending={pending}
      />
    </li>
  );
}

function CrmSection({
  title,
  icon: Icon,
  tags,
  kindHref,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  tags: TagRow[];
  kindHref: string;
}) {
  return (
    <section className="rounded-lg border bg-card p-4">
      <header className="mb-3 flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" />
        <h2 className="font-medium text-sm">
          {title} <span className="text-muted-foreground text-xs">({tags.length})</span>
        </h2>
      </header>
      {tags.length === 0 ? (
        <p className="text-muted-foreground text-xs italic">
          Aucun tag. Clique "Initialiser les tags CRM" en haut pour créer un label Gmail par record.
        </p>
      ) : (
        <ul className="max-h-72 divide-y overflow-y-auto rounded-md border">
          {tags.map((t) => {
            const display = t.labelName.split("/").pop() ?? t.labelName;
            return (
              <li key={t.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                {t.targetId ? (
                  <Link
                    href={`/${kindHref}/${t.targetId}`}
                    className="flex-1 truncate hover:underline"
                  >
                    {display}
                  </Link>
                ) : (
                  <span className="flex-1 truncate">{display}</span>
                )}
                <span className="text-[11px] text-muted-foreground">{t.threadCount} thread(s)</span>
                {t.gmailLabelId ? null : (
                  <span className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-800">
                    Label Gmail non créé
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
