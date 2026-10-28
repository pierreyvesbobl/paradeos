"use client";

import { Power } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setGmailAutoArchive } from "@/lib/actions/gmail";

type Props =
  | { kind: "doneTasks"; enabled: boolean }
  | { kind: "automatedDays"; value: string; choices: { value: string; label: string }[] };

export function GmailAutoArchiveForm(props: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (props.kind === "doneTasks") {
    const { enabled } = props;
    return (
      <Button
        type="button"
        size="sm"
        variant={enabled ? "default" : "outline"}
        disabled={pending}
        className="shrink-0 gap-1.5"
        title={enabled ? "Cliquer pour couper" : "Cliquer pour activer"}
        onClick={() =>
          startTransition(async () => {
            const res = await setGmailAutoArchive({ doneTasks: !enabled });
            if (!res.ok) {
              toast.error(res.message);
              return;
            }
            toast.success(
              enabled
                ? "Les fils aux tâches terminées restent en boîte."
                : "Les fils aux tâches terminées seront archivés à la prochaine relève.",
            );
            router.refresh();
          })
        }
      >
        <Power className="size-3.5" />
        {enabled ? "Actif" : "Coupé"}
      </Button>
    );
  }

  return (
    <select
      value={props.value}
      disabled={pending}
      onChange={(e) => {
        const next = e.target.value as "off" | "3" | "7" | "14";
        startTransition(async () => {
          const res = await setGmailAutoArchive({ automatedDays: next });
          if (!res.ok) {
            toast.error(res.message);
            return;
          }
          toast.success(
            next === "off"
              ? "Les notifications de robots restent en boîte."
              : `Les notifications de robots de plus de ${next} jours seront archivées.`,
          );
          router.refresh();
        });
      }}
      className="h-8 shrink-0 rounded-md border bg-background px-2 text-sm"
    >
      {props.choices.map((c) => (
        <option key={c.value} value={c.value}>
          {c.label}
        </option>
      ))}
    </select>
  );
}
