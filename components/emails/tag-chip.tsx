"use client";

import { removeTagAction } from "@/lib/actions/gmail";
import { Briefcase, Building2, Tag, User, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

type Props = {
  threadId: string;
  tagId: string;
  kind: "project" | "contact" | "entity" | "category";
  labelName: string;
  source?: string;
  removable?: boolean;
  /** Affiche un lien vers la fiche CRM si kind != category. */
  targetHref?: string | null;
};

const KIND_ICON = {
  project: Briefcase,
  contact: User,
  entity: Building2,
  category: Tag,
} as const;

/**
 * Chip affichant un tag appliqué à un thread. Icône selon kind. Bouton
 * × pour retirer (push à Gmail).
 */
export function TagChip({
  threadId,
  tagId,
  kind,
  labelName,
  source,
  removable = true,
  targetHref,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const Icon = KIND_ICON[kind];
  const display = labelName.split("/").pop() ?? labelName;

  function remove() {
    startTransition(async () => {
      const res = await removeTagAction({ threadId, tagId });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Tag retiré.");
      router.refresh();
    });
  }

  const content = (
    <span
      className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-xs"
      title={`${labelName}${source ? ` · ${source}` : ""}`}
    >
      <Icon className="size-3 text-muted-foreground" />
      <span className="truncate">{display}</span>
      {removable ? (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            remove();
          }}
          disabled={pending}
          className="ml-0.5 text-muted-foreground hover:text-destructive disabled:opacity-50"
          aria-label="Retirer ce tag"
        >
          <X className="size-3" />
        </button>
      ) : null}
    </span>
  );

  if (targetHref) {
    return (
      <a href={targetHref} className="hover:underline">
        {content}
      </a>
    );
  }
  return content;
}
