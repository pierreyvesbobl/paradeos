"use client";

import { Button } from "@/components/ui/button";
import { updateMeetingSummary } from "@/lib/actions/meetings";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
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
  const [current, setCurrent] = useState<string | null>(initial);
  const [draft, setDraft] = useState(initial ?? "");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setCurrent(initial);
  }, [initial]);

  function save() {
    startTransition(async () => {
      const next = draft.trim() === "" ? null : draft;
      const res = await updateMeetingSummary({ meetingId, summary: next });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setCurrent(next);
      setEditing(false);
      toast.success("Résumé enregistré.");
      router.refresh();
    });
  }

  if (!editing) {
    return (
      <div className="space-y-2">
        {current ? (
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{current}</pre>
        ) : (
          <p className="text-muted-foreground text-sm">—</p>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setDraft(current ?? "");
            setEditing(true);
          }}
        >
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
            setDraft(current ?? "");
            setEditing(false);
          }}
        >
          Annuler
        </Button>
      </div>
    </div>
  );
}
