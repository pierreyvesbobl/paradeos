"use client";

import { type AssigneeRef, AssigneesPicker } from "@/components/tasks/assignees-picker";
import type { TaskContactOption, TaskUserOption } from "@/components/tasks/task-types";
import { ContactAvatar } from "@/components/user/contact-avatar";
import { UserAvatar } from "@/components/user/user-avatar";
import { patchTask } from "@/lib/actions/tasks";
import { cn } from "@/lib/utils";
import { Plus } from "@phosphor-icons/react/dist/ssr";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

/**
 * Variante rail : chaque assigné rendu comme (avatar 26 + nom + badge
 * Externe si contact CRM), stackée verticalement, puis un « + Ajouter »
 * discret qui ouvre le picker multi. Placeholder « Non assignée » si
 * personne n'est encore assigné.
 */
export function TaskAssigneeRailEditor({
  id,
  value,
  options,
  contactOptions,
}: {
  id: string;
  value: AssigneeRef[];
  options: TaskUserOption[];
  contactOptions?: TaskContactOption[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [local, setLocal] = useState<AssigneeRef[]>(value);
  useEffect(() => setLocal(value), [value]);

  function commit(next: AssigneeRef[]) {
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
    <div className="flex flex-col gap-2">
      {local.length === 0 ? (
        <AssigneesPicker
          value={local}
          onChange={commit}
          userOptions={options}
          contactOptions={contactOptions}
          trigger={
            <button
              type="button"
              className={cn(
                "inline-flex w-fit items-center gap-1.5 rounded-lg border border-[color:var(--ds-border-strong)] border-dashed px-3 py-1.5 text-muted-foreground text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary/40",
              )}
            >
              <Plus size={13} weight="bold" />
              <span>Assigner</span>
            </button>
          }
        />
      ) : (
        <>
          {local.map((a) =>
            a.kind === "user" ? (
              <div key={`u:${a.id}`} className="flex items-center gap-2">
                <UserAvatar size="sm" name={a.fullName} avatarUrl={a.avatarUrl} />
                <span className="font-medium text-sm">{a.fullName ?? "(sans nom)"}</span>
              </div>
            ) : (
              <div key={`c:${a.id}`} className="flex items-center gap-2">
                <ContactAvatar size="sm" name={a.fullName} entityName={a.entityName} />
                <span className="font-medium text-sm">{a.fullName || "(sans nom)"}</span>
                <span className="rounded-md bg-tint-yellow-bg px-2 py-0.5 font-medium text-[11px] text-tint-yellow-text">
                  Externe
                </span>
              </div>
            ),
          )}
          <AssigneesPicker
            value={local}
            onChange={commit}
            userOptions={options}
            contactOptions={contactOptions}
            trigger={
              <button
                type="button"
                className="inline-flex w-fit items-center gap-1 rounded-md px-1.5 py-1 text-muted-foreground text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <Plus size={11} weight="bold" />
                <span>Modifier</span>
              </button>
            }
          />
        </>
      )}
    </div>
  );
}
