"use client";

import { ContactPreviewDialog } from "@/components/projects/contact-preview-dialog";
import {
  addMeetingParticipant,
  removeMeetingParticipant,
} from "@/lib/actions/meeting-participants";
import type { MeetingParticipantRow } from "@/lib/db/queries/meeting-participants";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { PeekField } from "../link-field/link-peek";
import {
  type ParticipantContactOption,
  type ParticipantDraft,
  type ParticipantUserOption,
  ParticipantsPicker,
} from "./participants-picker";

function toDraft(p: MeetingParticipantRow): ParticipantDraft {
  const fields: PeekField[] = [];
  if (p.role) fields.push({ key: "meta", value: p.role });
  if (p.entityName) fields.push({ key: "entity", value: p.entityName });
  if (p.email) fields.push({ key: "email", value: p.email });

  return {
    key: p.id,
    kind: p.kind,
    refId: p.refId,
    name: p.name,
    subtitle: p.role ?? p.entityName,
    avatarUrl: p.avatarUrl,
    ...(p.kind === "contact" && p.refId ? { peek: { href: `/contacts/${p.refId}`, fields } } : {}),
  };
}

/**
 * « Participants » sur la fiche réunion : même sélecteur que le
 * formulaire de création, branché sur les Server Actions plutôt que sur
 * un état local.
 */
export function MeetingParticipantsField({
  meetingId,
  participants,
  users,
  contacts,
  defaultEntityId,
}: {
  meetingId: string;
  participants: MeetingParticipantRow[];
  users: ParticipantUserOption[];
  contacts: ParticipantContactOption[];
  /** Entité du projet du meeting — préremplit la création de contact. */
  defaultEntityId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [previewId, setPreviewId] = useState<string | null>(null);

  return (
    <div>
      <ParticipantsPicker
        participants={participants.map(toDraft)}
        users={users}
        contacts={contacts}
        defaultEntityId={defaultEntityId}
        disabled={pending}
        onOpenContact={setPreviewId}
        onAdd={(target) =>
          startTransition(async () => {
            const res = await addMeetingParticipant({ meetingId, ...target });
            if (!res.ok) {
              toast.error(res.message);
              return;
            }
            router.refresh();
          })
        }
        onRemove={(participantId) =>
          startTransition(async () => {
            const res = await removeMeetingParticipant({ meetingId, participantId });
            if (!res.ok) {
              toast.error(res.message);
              return;
            }
            router.refresh();
          })
        }
      />
      <ContactPreviewDialog contactId={previewId} onClose={() => setPreviewId(null)} />
    </div>
  );
}
