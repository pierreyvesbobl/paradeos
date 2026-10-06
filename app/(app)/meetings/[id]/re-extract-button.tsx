"use client";

import { Sparkle } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { extractMeetingProposals } from "@/lib/actions/meetings";

export function ReExtractButton({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await extractMeetingProposals({ meetingId });
          if (!res.ok) {
            toast.error(res.message);
            return;
          }
          toast.success(`${res.data.count} propositions extraites.`);
          router.refresh();
        })
      }
      className="inline-flex items-center gap-2 rounded-lg bg-(--ds-primary-50) px-3.5 py-2 font-medium text-(--ds-primary-700) text-[14px] shadow-[inset_0_0_0_1px_var(--ds-primary-200)] transition-colors hover:bg-(--ds-primary-100) disabled:opacity-60"
    >
      <Sparkle size={16} weight="duotone" className="text-(--ds-primary-500)" />
      {pending ? "Extraction…" : "Ré-extraire"}
    </button>
  );
}
