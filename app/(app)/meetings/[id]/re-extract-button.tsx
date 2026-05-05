"use client";

import { Button } from "@/components/ui/button";
import { extractMeetingProposals } from "@/lib/actions/meetings";
import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

export function ReExtractButton({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      size="sm"
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
    >
      <Sparkles className="size-4" />
      {pending ? "Extraction…" : "Ré-extraire"}
    </Button>
  );
}
