"use client";

import { Button } from "@/components/ui/button";
import { rejectInvoiceFiling, retryInvoiceFiling } from "@/lib/actions/invoice-filings";
import { RefreshCw, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

type Props = {
  filingId: string;
  status: string;
};

export function FilingActions({ filingId, status }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function retry() {
    startTransition(async () => {
      const res = await retryInvoiceFiling({ filingId });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      if (res.data.status === "filed") {
        toast.success(`Classée : ${res.data.generatedFilename ?? "OK"}`);
      } else if (res.data.status === "rejected") {
        toast.error(`Écartée : ${res.data.errorMessage ?? "raison inconnue"}`);
      } else {
        toast.error(`Erreur : ${res.data.errorMessage ?? "inconnue"}`);
      }
      router.refresh();
    });
  }

  function reject() {
    startTransition(async () => {
      const res = await rejectInvoiceFiling({ filingId });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={retry}
        disabled={pending}
        className="h-7 gap-1 px-2 text-[11px]"
      >
        <RefreshCw className={`size-3 ${pending ? "animate-spin" : ""}`} />
        Relancer
      </Button>
      {status !== "rejected" ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={reject}
          disabled={pending}
          className="h-7 gap-1 px-2 text-[11px] text-muted-foreground hover:text-destructive"
        >
          <X className="size-3" />
          Écarter
        </Button>
      ) : null}
    </div>
  );
}
