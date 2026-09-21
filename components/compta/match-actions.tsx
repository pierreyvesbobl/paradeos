"use client";

import {
  attachDocumentToOperation,
  detachOperationAttachment,
  rejectMatch,
  restoreMatch,
  runPurchaseMatchingNow,
} from "@/lib/actions/purchase-matching";
import { ArrowClockwise, LinkBreak, Paperclip, X } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

const BUTTON =
  "inline-flex flex-none items-center gap-1 rounded-md border px-2 py-1 font-medium text-[12px] transition-colors disabled:opacity-50";

/** Attacher / écarter une proposition de justificatif. */
export function MatchActions({ matchId }: { matchId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function attach() {
    startTransition(async () => {
      const res = await attachDocumentToOperation({ matchId });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      if (!res.data.ok) {
        toast.error(res.data.message);
        router.refresh();
        return;
      }
      toast.success(res.data.message);
      router.refresh();
    });
  }

  function dismiss() {
    startTransition(async () => {
      const res = await rejectMatch({ matchId });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Proposition écartée.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-none items-center gap-1">
      <button
        type="button"
        onClick={attach}
        disabled={pending}
        className={`${BUTTON} border-transparent bg-foreground text-background hover:opacity-90`}
      >
        <Paperclip size={13} weight="bold" />
        Attacher
      </button>
      <button
        type="button"
        onClick={dismiss}
        disabled={pending}
        className={`${BUTTON} text-[var(--ds-text-tertiary)] hover:bg-muted/40 hover:text-foreground`}
        title="Ne plus proposer ce rapprochement"
      >
        <X size={13} weight="bold" />
      </button>
    </div>
  );
}

/** Retire une pièce déjà déposée chez Dougs. */
export function DetachAction({ matchId }: { matchId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await detachOperationAttachment({ matchId });
          if (!res.ok) {
            toast.error(res.message);
            return;
          }
          if (!res.data.ok) {
            toast.error(res.data.message);
            return;
          }
          toast.success(res.data.message);
          router.refresh();
        })
      }
      className={`${BUTTON} text-[var(--ds-text-tertiary)] hover:bg-muted/40 hover:text-foreground`}
      title="Retirer cette pièce de l'opération Dougs"
    >
      <LinkBreak size={13} weight="bold" />
      Détacher
    </button>
  );
}

/** Remet dans la file une proposition écartée. */
export function RestoreAction({ matchId }: { matchId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await restoreMatch({ matchId });
          if (!res.ok) {
            toast.error(res.message);
            return;
          }
          toast.success("Proposition remise dans la file.");
          router.refresh();
        })
      }
      className={`${BUTTON} text-[var(--ds-text-tertiary)] hover:bg-muted/40 hover:text-foreground`}
    >
      Remettre
    </button>
  );
}

/**
 * Relance le rapprochement. Le cron ne passe qu'une fois par jour : ce
 * bouton sert à voir tout de suite l'effet d'une facture qui vient
 * d'arriver ou d'une session Dougs rafraîchie.
 */
export function RunMatchingButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await runPurchaseMatchingNow({});
          if (!res.ok) {
            toast.error(res.message);
            return;
          }
          if (!res.data.ok) {
            toast.error(res.data.message);
            return;
          }
          const { operations, suggestions, withoutCandidate } = res.data;
          toast.success(
            `${operations} opération(s) relues, ${suggestions} proposition(s), ${withoutCandidate} sans candidat.`,
          );
          router.refresh();
        })
      }
      className={`${BUTTON} hover:bg-muted/40`}
    >
      <ArrowClockwise size={13} weight="bold" className={pending ? "animate-spin" : undefined} />
      {pending ? "Rapprochement…" : "Lancer le rapprochement"}
    </button>
  );
}
