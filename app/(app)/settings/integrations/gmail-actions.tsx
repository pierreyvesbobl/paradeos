"use client";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  cleanupSpamAction,
  pullGmailLabels,
  purgeLocalGmail,
  rebuildAutoLinks,
  triggerGmailSync,
} from "@/lib/actions/gmail";
import { Filter, RefreshCw, Tags, Trash2, Wand2 } from "lucide-react";
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
      const { mode, inserted, bodiesFetched, skippedNotFound, skippedSpam, hasMore, errors } =
        res.data;
      const errSuffix = errors.length ? ` · ${errors.length} erreur(s)` : "";
      const tailSuffix = hasMore ? " · à continuer" : "";
      const skippedSuffix = [
        skippedNotFound > 0 ? `${skippedNotFound} dispar(s)` : "",
        skippedSpam > 0 ? `${skippedSpam} spam(s)` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      const skipFull = skippedSuffix ? ` · ${skippedSuffix}` : "";
      toast.success(
        `Sync ${mode} : ${inserted} nouveau(x), ${bodiesFetched} body(s)${skipFull}${tailSuffix}${errSuffix}.`,
      );
      router.refresh();
    });
  }

  function cleanSpam() {
    startTransition(async () => {
      const res = await cleanupSpamAction({});
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(
        res.data.deletedThreads > 0
          ? `${res.data.deletedThreads} thread(s) spam/trash supprimé(s).`
          : "Aucun spam à nettoyer.",
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
      const { rebuilt, labelsCreated, labelsRenamed } = res.data;
      const suffix = [
        labelsCreated > 0 ? `${labelsCreated} label(s) Gmail créé(s)` : "",
        labelsRenamed > 0 ? `${labelsRenamed} resynchronisé(s)` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      toast.success(`Liens recalculés sur ${rebuilt} thread(s)${suffix ? ` · ${suffix}` : ""}.`);
      router.refresh();
    });
  }

  function pullLabels() {
    startTransition(async () => {
      const res = await pullGmailLabels({});
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      const { linksCreated, threadsImported, threadsSeen, errors } = res.data;
      if (linksCreated === 0 && threadsImported === 0) {
        toast.success(`Rien de nouveau — ${threadsSeen} thread(s) déjà à jour.`);
      } else {
        toast.success(
          `${linksCreated} rattachement(s) importé(s)` +
            `${threadsImported > 0 ? ` · ${threadsImported} thread(s) ajouté(s)` : ""}` +
            `${errors.length > 0 ? ` · ${errors.length} erreur(s)` : ""}.`,
        );
      }
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
        title="Rejoue les liaisons auto contact/projet/entité — sans rétablir celles que tu as retirées"
      >
        <Wand2 className="size-3.5" />
        Recalculer les liens
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={pullLabels}
        disabled={pending}
        className="gap-1.5"
        title="Récupère les mails que tu as rangés à la main dans Gmail sous un label Paradeos/Projets ou Paradeos/Entités — y compris les vieux fils que le sync ne voit pas"
      >
        <Tags className="size-3.5" />
        Importer les labels Gmail
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={cleanSpam}
        disabled={pending}
        className="gap-1.5"
        title="Supprime les threads dont tous les messages sont SPAM ou TRASH"
      >
        <Filter className="size-3.5" />
        Nettoyer les spams
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
