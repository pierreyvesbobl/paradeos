"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const SHELL_SCRIPT = 'open "${1/#~/$HOME}"';

/**
 * Setup step-by-step pour l'ouverture 1-clic du dossier Drive en local
 * via Apple Shortcuts. Affiché depuis le bouton « ? » à côté de
 * « Ouvrir en local ».
 *
 * On documente ici plutôt qu'en page settings parce que l'action est
 * contextuelle (sur la fiche projet) et l'aide est lue au moment où
 * elle est utile.
 */
export function DriveLocalOpenSetupDialog({
  open,
  onClose,
  shortcutName,
}: {
  open: boolean;
  onClose: () => void;
  shortcutName: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copyScript() {
    try {
      await navigator.clipboard.writeText(SHELL_SCRIPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Copie impossible — sélectionne et copie à la main.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Ouvrir un dossier Drive d'un clic</DialogTitle>
          <DialogDescription>
            Les navigateurs bloquent <code>file://</code>, donc Paradeos passe par une Apple
            Shortcut que tu installes une seule fois. Ensuite, le bouton « Ouvrir en local »
            déclenche Finder direct.
          </DialogDescription>
        </DialogHeader>

        <ol className="space-y-2.5 text-sm">
          <li className="flex gap-2">
            <Step n={1} />
            <span>
              Ouvre l'app <strong>Shortcuts</strong> (Raccourcis) sur ton Mac — built-in macOS.
            </span>
          </li>
          <li className="flex gap-2">
            <Step n={2} />
            <span>
              Crée un nouveau raccourci (<kbd className="rounded border px-1 text-xs">+</kbd>) et
              ajoute l'action <strong>« Run Shell Script »</strong> (Exécuter un script shell).
            </span>
          </li>
          <li className="flex gap-2">
            <Step n={3} />
            <span>
              Dans l'action, configure :
              <ul className="mt-1.5 ml-4 list-disc space-y-0.5 text-muted-foreground text-xs">
                <li>
                  Shell : <code className="rounded bg-muted px-1">/bin/zsh</code>
                </li>
                <li>
                  Pass input : <code className="rounded bg-muted px-1">as arguments</code>
                </li>
              </ul>
            </span>
          </li>
          <li className="flex gap-2">
            <Step n={4} />
            <div className="flex-1 space-y-1.5">
              <span>Remplace le script par :</span>
              <div className="flex items-center gap-2 rounded-md bg-muted/60 p-2 font-mono text-xs">
                <code className="flex-1">{SHELL_SCRIPT}</code>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={copyScript}
                  className="h-6 gap-1 px-2 text-xs"
                  aria-label="Copier le script"
                >
                  {copied ? (
                    <>
                      <Check className="size-3" />
                      Copié
                    </>
                  ) : (
                    <>
                      <Copy className="size-3" />
                      Copier
                    </>
                  )}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                <code>${"{1/#~/$HOME}"}</code> remplace le <code>~</code> en début par le vrai home
                (sans cette substitution, <code>open</code> chercherait littéralement un dossier
                nommé <code>~</code>).
              </p>
            </div>
          </li>
          <li className="flex gap-2">
            <Step n={5} />
            <span>
              Clique le nom du raccourci en haut → renomme en{" "}
              <strong>
                <code className="rounded bg-muted px-1">{shortcutName}</code>
              </strong>{" "}
              (exact). Puis <kbd className="rounded border px-1 text-xs">⌘S</kbd> pour sauver.
            </span>
          </li>
        </ol>

        <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-900 text-xs dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Au premier clic « Ouvrir en local », macOS te demande d'autoriser Paradeos à déclencher
          Shortcuts. Coche « Toujours autoriser ».
        </p>

        <DialogFooter>
          <Button type="button" onClick={onClose}>
            J'ai compris
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Step({ n }: { n: number }) {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground font-medium text-[11px] text-background">
      {n}
    </span>
  );
}
