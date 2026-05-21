"use client";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { purgeLocalGmail, rebuildAutoLinks, triggerGmailSync } from "@/lib/actions/gmail";
import { RefreshCw, Trash2, Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

export function GmailActions() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [purgeOpen, setPurgeOpen] = useState(false);

  function syncNow() {
    startTransition(async () => {
      const res = await triggerGmailSync({});
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      const { mode, inserted, bodiesFetched, skippedNotFound, hasMore, errors } = res.data;
      const errSuffix = errors.length ? ` · ${errors.length} erreur(s)` : "";
      const tailSuffix = hasMore ? " · à continuer" : "";
      const skippedSuffix = skippedNotFound > 0 ? ` · ${skippedNotFound} dispar(s)` : "";
      toast.success(
        `Sync ${mode} : ${inserted} nouveau(x), ${bodiesFetched} body(s)${skippedSuffix}${tailSuffix}${errSuffix}.`,
      );
      router.refresh();
    });
  }

  function rebuild() {
    startTransition(async () => {
      const res = await rebuildAutoLinks({});
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(`Auto-link recalculé sur ${res.data.rebuilt} thread(s).`);
      router.refresh();
    });
  }

  function purge() {
    startTransition(async () => {
      const res = await purgeLocalGmail({});
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Données Gmail locales purgées. Le prochain sync repartira de zéro.");
      setPurgeOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" onClick={syncNow} disabled={pending} className="gap-1.5">
        <RefreshCw className={`size-3.5 ${pending ? "animate-spin" : ""}`} />
        Sync now
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={rebuild}
        disabled={pending}
        className="gap-1.5"
        title="Recalcule les liens auto contact/projet/entité"
      >
        <Wand2 className="size-3.5" />
        Recalculer les liens
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => setPurgeOpen(true)}
        disabled={pending}
        className="gap-1.5 text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="size-3.5" />
        Purger
      </Button>
      <ConfirmDialog
        open={purgeOpen}
        onOpenChange={setPurgeOpen}
        title="Purger les données Gmail locales ?"
        description="Toutes les copies locales des threads / messages / liens seront supprimées. Le prochain sync repartira en bootstrap (3 derniers mois). Aucun impact sur Gmail lui-même."
        confirmLabel="Purger"
        variant="destructive"
        onConfirm={purge}
        pending={pending}
      />
    </div>
  );
}
