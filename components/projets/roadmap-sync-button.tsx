"use client";

import { ArrowsClockwise } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { syncProjectRoadmaps } from "@/lib/actions/roadmap";

/** Relit la feuille de route sur GitHub et applique tout de suite. */
export function RoadmapSyncButton({ projectId }: { projectId: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function run() {
    startTransition(async () => {
      const res = await syncProjectRoadmaps({ projectId });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      const errors = res.data.filter((r) => r.status === "error");
      if (errors.length > 0) {
        toast.error(errors.map((e) => e.message).join(" · "));
      } else {
        const changed = res.data.reduce((n, r) => n + r.changedTasks, 0);
        const suggested = res.data.reduce((n, r) => n + r.suggested, 0);
        const auto = res.data.reduce((n, r) => n + r.autoConfirmed, 0);
        const notes = res.data.map((r) => r.message).filter(Boolean);
        toast.success(
          `Feuille de route relue : ${changed} tâche${changed > 1 ? "s" : ""} alignée${
            changed > 1 ? "s" : ""
          }, ${suggested} suggestion${suggested > 1 ? "s" : ""}${auto > 0 ? `, ${auto} confirmée${auto > 1 ? "s" : ""} sans clic` : ""}.${
            notes.length ? ` ${notes.join(" ")}` : ""
          }`,
        );
      }
      router.refresh();
    });
  }

  return (
    <Button type="button" variant="outline" size="sm" disabled={pending} onClick={run}>
      <ArrowsClockwise className={pending ? "size-3.5 animate-spin" : "size-3.5"} />
      Relire
    </Button>
  );
}
