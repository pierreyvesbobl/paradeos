"use client";

import { Button } from "@/components/ui/button";
import { updateMeetingSummary } from "@/lib/actions/meetings";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

export function SummaryEditor({
  meetingId,
  initial,
}: {
  meetingId: string;
  initial: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initial ?? "");
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const res = await updateMeetingSummary({
        meetingId,
        summary: draft.trim() === "" ? null : draft,
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setEditing(false);
      toast.success("Résumé enregistré.");
      router.refresh();
    });
  }

  if (!editing) {
    return (
      <div className="space-y-2">
        {initial ? (
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{initial}</pre>
        ) : (
          <p className="text-muted-foreground text-sm">—</p>
        )}
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
          Modifier
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <textarea
        rows={10}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={pending}
        className="block w-full rounded-md border bg-background p-3 text-sm leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={pending}>
          {pending ? "Enregistrement…" : "Enregistrer"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            setDraft(initial ?? "");
            setEditing(false);
          }}
        >
          Annuler
        </Button>
      </div>
    </div>
  );
}
