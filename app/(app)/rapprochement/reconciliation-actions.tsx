"use client";

import { Button } from "@/components/ui/button";
import {
  linkCoworkingInvoiceDougs,
  linkProjectAsNewMilestone,
  linkProjectDougsQuote,
  linkProjectMilestoneDougsInvoice,
} from "@/lib/actions/dougs-refresh";
import { Link2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

export function LinkQuoteButton({
  projectId,
  dougsId,
}: {
  projectId: string;
  dougsId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const res = await linkProjectDougsQuote({ projectId, dougsIdOrUrl: dougsId });
          if (!res.ok) {
            toast.error(res.message);
            return;
          }
          toast.success(`Lié : ${res.data.reference ?? "—"}`);
          router.refresh();
        });
      }}
      className="gap-1.5"
    >
      <Link2 className="size-3.5" />
      {pending ? "Lié…" : "Lier"}
    </Button>
  );
}

export function LinkMilestoneButton({
  projectId,
  milestoneId,
  dougsId,
}: {
  projectId: string;
  milestoneId: string;
  dougsId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const res = await linkProjectMilestoneDougsInvoice({
            projectId,
            milestoneId,
            dougsIdOrUrl: dougsId,
          });
          if (!res.ok) {
            toast.error(res.message);
            return;
          }
          toast.success(`Lié : ${res.data.reference ?? "—"}`);
          router.refresh();
        });
      }}
      className="gap-1.5"
    >
      <Link2 className="size-3.5" />
      {pending ? "Lié…" : "Lier"}
    </Button>
  );
}

export function LinkProjectAsMilestoneButton({
  projectId,
  dougsId,
  detectedPercent,
}: {
  projectId: string;
  dougsId: string;
  detectedPercent: number | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const label =
    detectedPercent != null && detectedPercent < 50
      ? `Lier (acompte ${detectedPercent} %)`
      : detectedPercent != null && detectedPercent >= 95
        ? "Lier (solde 100 %)"
        : detectedPercent != null && detectedPercent > 50
          ? `Lier (solde ${detectedPercent} %)`
          : detectedPercent != null
            ? `Lier (${detectedPercent} %)`
            : "Lier (nouveau jalon)";
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const res = await linkProjectAsNewMilestone({
            projectId,
            dougsIdOrUrl: dougsId,
            detectedPercent: detectedPercent ?? null,
          });
          if (!res.ok) {
            toast.error(res.message);
            return;
          }
          toast.success(`Jalon créé : ${res.data.milestoneLabel}`);
          router.refresh();
        });
      }}
      className="gap-1.5"
    >
      <Plus className="size-3.5" />
      {pending ? "Création…" : label}
    </Button>
  );
}

export function LinkCoworkingInvoiceButton({
  coworkingInvoiceId,
  dougsId,
}: {
  coworkingInvoiceId: string;
  dougsId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          const res = await linkCoworkingInvoiceDougs({
            coworkingInvoiceId,
            dougsIdOrUrl: dougsId,
          });
          if (!res.ok) {
            toast.error(res.message);
            return;
          }
          toast.success(`Lié : ${res.data.reference ?? "—"}`);
          router.refresh();
        });
      }}
      className="gap-1.5"
    >
      <Link2 className="size-3.5" />
      {pending ? "Lié…" : "Lier"}
    </Button>
  );
}
