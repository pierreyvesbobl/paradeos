"use client";

import { FkCombobox } from "@/components/inline/fk-combobox";
import { retagThreadProject } from "@/lib/actions/gmail";
import { Briefcase, Check, Sparkles, Tag, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

type ProjectOption = { id: string; name: string };

type Props = {
  threadId: string;
  currentProject: {
    id: string;
    name: string;
    /** Source du rattachement pour la pastille visuelle. */
    source: "auto" | "manual" | "gmail" | string;
    /** L'humain a validé/scellé ce lien. */
    manuallyOverridden: boolean;
  } | null;
  projects: ProjectOption[];
};

type SourceTone = {
  label: string;
  Icon: typeof Sparkles;
  bg: string;
  text: string;
  dot: string;
};

function toneFor(source: string, manuallyOverridden: boolean): SourceTone {
  if (manuallyOverridden) {
    return {
      label: "Validé manuellement",
      Icon: Check,
      bg: "var(--ds-tint-green-bg)",
      text: "var(--ds-tint-green-text)",
      dot: "var(--ds-tint-green-dot)",
    };
  }
  if (source === "manual") {
    return {
      label: "Ajouté manuellement",
      Icon: Tag,
      bg: "var(--ds-tint-blue-bg)",
      text: "var(--ds-tint-blue-text)",
      dot: "var(--ds-tint-blue-dot)",
    };
  }
  if (source === "gmail") {
    return {
      label: "Depuis label Gmail",
      Icon: Tag,
      bg: "var(--ds-tint-gray-bg)",
      text: "var(--ds-tint-gray-text)",
      dot: "var(--ds-tint-gray-dot)",
    };
  }
  return {
    label: "Détecté automatiquement",
    Icon: Sparkles,
    bg: "var(--ds-tint-mauve-bg)",
    text: "var(--ds-tint-mauve-text)",
    dot: "var(--ds-tint-mauve-dot)",
  };
}

export function ProjectLinkBadge({ threadId, currentProject, projects }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  function pickProject(nextId: string | null) {
    startTransition(async () => {
      const res = await retagThreadProject({ threadId, projectId: nextId });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(nextId ? "Projet mis à jour." : "Projet détaché.");
      setEditing(false);
      router.refresh();
    });
  }

  const options = projects.map((p) => ({ id: p.id, label: p.name }));

  if (editing) {
    return (
      <div className="space-y-2 rounded-lg border bg-card p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="font-semibold text-[13px]">Rattacher à un projet</p>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Fermer"
          >
            <X className="size-4" />
          </button>
        </div>
        <FkCombobox
          value={currentProject?.id ?? null}
          onValueChange={pickProject}
          options={options}
          placeholder="Aucun projet"
          searchPlaceholder="Rechercher un projet…"
          clearLabel="Détacher"
          disabled={pending}
        />
      </div>
    );
  }

  if (!currentProject) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="inline-flex w-full items-center gap-2 rounded-lg border border-dashed bg-card px-3 py-2 text-left text-muted-foreground text-xs transition-colors hover:border-foreground/30 hover:text-foreground"
      >
        <Briefcase className="size-3.5" />
        <span>Rattacher à un projet</span>
      </button>
    );
  }

  const tone = toneFor(currentProject.source, currentProject.manuallyOverridden);
  const ToneIcon = tone.Icon;

  return (
    <div
      className="flex items-center gap-2 rounded-lg border bg-card p-2.5"
      style={{ borderColor: tone.dot }}
    >
      <span
        className="flex size-7 shrink-0 items-center justify-center rounded-md"
        style={{ background: tone.bg, color: tone.text }}
      >
        <Briefcase className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <Link
          href={`/projets/${currentProject.id}`}
          className="block truncate font-medium text-sm hover:underline"
        >
          {currentProject.name}
        </Link>
        <span
          className="mt-0.5 inline-flex items-center gap-1 text-[10px]"
          style={{ color: tone.text }}
          title={tone.label}
        >
          <ToneIcon className="size-2.5" />
          {tone.label}
        </span>
      </div>
      <button
        type="button"
        onClick={() => setEditing(true)}
        disabled={pending}
        className="rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
      >
        Changer
      </button>
    </div>
  );
}
