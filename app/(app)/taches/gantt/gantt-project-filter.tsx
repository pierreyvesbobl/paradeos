"use client";

import { FkCombobox } from "@/components/inline/fk-combobox";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

/**
 * Filtre projet pour le Gantt — combobox avec recherche au lieu de
 * chips. Aligne avec la pref "préférer recherche aux dropdowns" pour
 * les FK existantes. Navigue via querystring (`?project=<id>`) pour
 * que l'état soit bookmark-able et survive aux refresh.
 */
export function GanttProjectFilter({
  projects,
  selected,
  viewStartIso,
}: {
  projects: { id: string; name: string }[];
  selected: string | null;
  viewStartIso: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function navigate(projectId: string | null) {
    const params = new URLSearchParams();
    params.set("from", viewStartIso);
    if (projectId) params.set("project", projectId);
    startTransition(() => {
      router.push(`/taches/gantt?${params.toString()}`);
    });
  }

  return (
    <div className="max-w-sm">
      <FkCombobox
        value={selected}
        onValueChange={navigate}
        options={projects.map((p) => ({ id: p.id, label: p.name }))}
        placeholder="Tous les projets"
        searchPlaceholder="Filtrer par projet…"
        clearLabel="Tous les projets"
        disabled={pending}
      />
    </div>
  );
}
