"use client";

import { FkCombobox } from "@/components/inline/fk-combobox";
import { Label } from "@/components/ui/label";
import { updateMeetingSubject } from "@/lib/actions/meetings";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

type Props = {
  meetingId: string;
  initialProjectId: string | null;
  projects: { id: string; name: string }[];
};

export function MeetingSubjectEditor({ meetingId, initialProjectId, projects }: Props) {
  const router = useRouter();
  const [projectId, setProjectId] = useState<string | null>(initialProjectId);
  const [pending, startTransition] = useTransition();

  function persist(nextProjectId: string | null) {
    startTransition(async () => {
      const res = await updateMeetingSubject({
        meetingId,
        projectId: nextProjectId,
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Lien mis à jour.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor="meeting-project" className="text-muted-foreground text-xs">
        Projet (couvre les phases commerciales et delivery)
      </Label>
      <FkCombobox
        id="meeting-project"
        value={projectId}
        onValueChange={(v) => {
          setProjectId(v);
          persist(v);
        }}
        options={projects.map((p) => ({ id: p.id, label: p.name }))}
        searchPlaceholder="Rechercher un projet…"
        disabled={pending}
      />
    </div>
  );
}
