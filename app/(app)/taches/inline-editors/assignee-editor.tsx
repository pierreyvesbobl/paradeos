"use client";

import { type AssigneeRef, AssigneesPicker } from "@/components/tasks/assignees-picker";
import type { TaskContactOption, TaskUserOption } from "@/components/tasks/task-types";
import { patchTask } from "@/lib/actions/tasks";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

export type AssigneeValue = AssigneeRef;

/**
 * Éditeur inline d'assignés multi. Hydrate avec la liste actuelle ;
 * sauvegarde via patchTask({ assignees }) à chaque ajout/retrait, avec
 * optimistic UI et rollback en cas d'échec.
 */
export function TaskAssigneeEditor({
  id,
  value,
  options,
  contactOptions,
}: {
  id: string;
  value: AssigneeValue[];
  options: TaskUserOption[];
  contactOptions?: TaskContactOption[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [local, setLocal] = useState<AssigneeValue[]>(value);
  useEffect(() => setLocal(value), [value]);

  function commit(next: AssigneeValue[]) {
    const previous = local;
    setLocal(next);
    startTransition(async () => {
      const res = await patchTask({
        id,
        assignees: next.map((a) => ({ kind: a.kind, id: a.id })),
      });
      if (!res.ok) {
        setLocal(previous);
        toast.error(res.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <AssigneesPicker
      value={local}
      onChange={commit}
      userOptions={options}
      contactOptions={contactOptions}
    />
  );
}
