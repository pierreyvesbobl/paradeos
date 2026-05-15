"use client";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { connectDougsSession, disconnectDougsSession } from "@/lib/actions/dougs";
import { createDougsSyncToken, revokeDougsSyncToken } from "@/lib/actions/dougs-sync-tokens";
import { formatDate } from "@/lib/format";
import { Banknote, Check, Copy, ExternalLink, KeyRound, Trash2, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

type SyncToken = {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
};

type Props = {
  connected: boolean;
  companyId: string | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
  appUrl: string;
  syncTokens: SyncToken[];
};

const BOOKMARKLET_JS = `(()=>{const c=document.cookie;navigator.clipboard.writeText(c).then(()=>alert('Cookie Dougs copié dans le presse-papier ('+c.length+' chars). Colle-le dans Paradeos.'));})()`;

export function DougsSection({
  connected,
  companyId,
  lastUsedAt,
  expiresAt,
  appUrl,
  syncTokens,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [cookie, setCookie] = useState("");
  const [companyIdInput, setCompanyIdInput] = useState(companyId ?? "107610");
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [tokenLabel, setTokenLabel] = useState("");
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const syncEndpoint = `${appUrl.replace(/\/+$/, "")}/api/dougs/sync-cookie`;

  function createToken(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const label = tokenLabel.trim();
    if (!label) return;
    startTransition(async () => {
      const res = await createDougsSyncToken({ label });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setCreatedToken(res.data.token);
      setTokenLabel("");
      router.refresh();
    });
  }

  function revokeToken(id: string, label: string) {
    if (!window.confirm(`Révoquer le token « ${label} » ?`)) return;
    startTransition(async () => {
      const res = await revokeDougsSyncToken({ id });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Token révoqué.");
      router.refresh();
    });
  }

  function copyText(text: string, label: string) {
    navigator.clipboard.writeText(text).then(
      () => toast.success(`${label} copié.`),
      () => toast.error("Copie impossible."),
    );
  }

  function handleConnect(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    startTransition(async () => {
      const res = await connectDougsSession({ cookie, companyId: companyIdInput });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(connected ? "Cookie Dougs rafraîchi." : "Session Dougs connectée.");
      setCookie("");
    });
  }

  function handleDisconnect() {
    startTransition(async () => {
      const res = await disconnectDougsSession({});
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Session Dougs déconnectée.");
      setConfirmDisconnect(false);
    });
  }

  function copyBookmarklet() {
    navigator.clipboard.writeText(`javascript:${BOOKMARKLET_JS}`);
    toast.success("Bookmarklet copié — colle-le dans la barre de favoris.");
  }

  const expired = !!(expiresAt && new Date(expiresAt) < new Date());

  return (
    <section className="rounded-lg border bg-card p-6">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div className="flex gap-3">
          <Banknote className="size-5 text-muted-foreground" />
          <div>
            <h2 className="font-medium text-sm">Dougs (compta)</h2>
            <p className="text-muted-foreground text-xs">
              Pousse les brouillons de facture Paradeos vers Dougs via cookie de session. Cookie
              chiffré AES-256-GCM, durée ~24h.
            </p>
          </div>
        </div>
        {connected ? (
          <span
            className={
              expired
                ? "rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-amber-700 text-xs dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
                : "rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-emerald-700 text-xs dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
            }
          >
            {expired ? "Cookie expiré" : "Connecté"}
          </span>
        ) : (
          <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-amber-700 text-xs dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
            Non configurée
          </span>
        )}
      </header>

      {connected ? (
        <div className="space-y-3">
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <dt className="text-muted-foreground">Company ID</dt>
            <dd className="font-mono">{companyId}</dd>
            {lastUsedAt ? (
              <>
                <dt className="text-muted-foreground">Dernière utilisation</dt>
                <dd>{new Date(lastUsedAt).toLocaleString("fr-FR")}</dd>
              </>
            ) : null}
            {expiresAt ? (
              <>
                <dt className="text-muted-foreground">Expire vers</dt>
                <dd>{new Date(expiresAt).toLocaleString("fr-FR")}</dd>
              </>
            ) : null}
          </dl>

          <p className="text-muted-foreground text-xs">
            {expired
              ? "Le cookie est expiré. Re-connecte-toi sur app.dougs.fr puis colle-le ci-dessous pour rafraîchir."
              : "Pour rafraîchir avant expiration, colle un nouveau cookie ci-dessous."}
          </p>
        </div>
      ) : (
        <p className="mb-3 text-muted-foreground text-xs">
          Pas encore configurée. Suis les étapes ci-dessous pour connecter ton compte Dougs.
        </p>
      )}

      {/* Extension Chrome — auto-sync HttpOnly */}
      <div className="mt-5 rounded-md border border-emerald-200 bg-emerald-50/50 p-4 dark:border-emerald-900 dark:bg-emerald-950/30">
        <div className="mb-2 flex items-center gap-2">
          <Zap className="size-4 text-emerald-700 dark:text-emerald-400" />
          <h3 className="font-medium text-sm">Auto-sync via extension Chrome (recommandé)</h3>
        </div>
        <p className="mb-3 text-muted-foreground text-xs">
          Installe l'extension Chrome <code>chrome-extension/</code> (à la racine du repo Paradeos),
          génère un token ci-dessous, colle endpoint + token dans la popup de l'extension. Ensuite :
          1 clic sur l'icône → cookie Dougs (HttpOnly compris) synchro. Détails dans le README de
          l'extension.
        </p>

        {createdToken ? (
          <div className="mb-3 space-y-2 rounded-md border border-emerald-300 bg-background p-3 dark:border-emerald-800">
            <p className="font-medium text-xs">
              Token créé — copie ces deux valeurs dans la popup de l'extension.
            </p>
            <div>
              <p className="text-muted-foreground text-[11px]">Endpoint :</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded bg-muted/60 p-1.5 font-mono text-[11px]">
                  {syncEndpoint}
                </code>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => copyText(syncEndpoint, "Endpoint")}
                  className="h-7 px-2 text-xs"
                >
                  <Copy className="size-3" />
                </Button>
              </div>
            </div>
            <div>
              <p className="text-muted-foreground text-[11px]">Token (affiché une seule fois) :</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded bg-muted/60 p-1.5 font-mono text-[11px]">
                  {createdToken}
                </code>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => copyText(createdToken, "Token")}
                  className="h-7 px-2 text-xs"
                >
                  <Copy className="size-3" />
                </Button>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setCreatedToken(null)}
              className="text-[11px] underline hover:no-underline"
            >
              J'ai copié, masquer
            </button>
          </div>
        ) : null}

        <form onSubmit={createToken} className="flex items-center gap-2">
          <Input
            placeholder="Label (ex. « MacBook »)"
            value={tokenLabel}
            onChange={(e) => setTokenLabel(e.target.value)}
            disabled={pending}
            maxLength={80}
            className="h-8"
          />
          <Button
            type="submit"
            size="sm"
            disabled={pending || !tokenLabel.trim()}
            className="gap-1.5"
          >
            <KeyRound className="size-3.5" />
            {pending ? "…" : "Générer un token"}
          </Button>
        </form>

        {syncTokens.length > 0 ? (
          <ul className="mt-3 divide-y rounded-md border bg-background">
            {syncTokens.map((t) => (
              <li key={t.id} className="flex items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-xs">{t.label}</p>
                  <p className="text-[11px] text-muted-foreground">
                    Créé le {formatDate(t.createdAt)}
                    {t.lastUsedAt
                      ? ` · Dernier sync ${formatDate(t.lastUsedAt)}`
                      : " · Jamais utilisé"}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => revokeToken(t.id, t.label)}
                  disabled={pending}
                  className="text-muted-foreground hover:text-destructive"
                  title="Révoquer"
                  aria-label={`Révoquer ${t.label}`}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <details className="mt-4 rounded-md border bg-muted/30 p-3">
        <summary className="cursor-pointer text-sm">
          Saisie manuelle (fallback — copier le cookie)
        </summary>
        <div className="mt-3 space-y-3 text-xs">
          <div>
            <p className="font-medium">Option A — Bookmarklet (1 clic)</p>
            <p className="text-muted-foreground">
              Crée un favori dans ton navigateur avec ce code, puis ouvre app.dougs.fr et clique
              dessus. Le cookie sera copié dans ton presse-papier.
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={copyBookmarklet}
              className="mt-1.5"
            >
              <Copy className="mr-1 size-3" /> Copier le bookmarklet
            </Button>
          </div>
          <div>
            <p className="font-medium">Option B — DevTools console</p>
            <p className="text-muted-foreground">
              Sur app.dougs.fr, ouvre les devtools (F12) → onglet Console et colle :
            </p>
            <code className="mt-1 block rounded bg-background p-2 font-mono text-[11px]">
              copy(document.cookie)
            </code>
          </div>
          <div>
            <p className="font-medium">Option C — DevTools cookies</p>
            <p className="text-muted-foreground">
              DevTools → Application → Cookies → app.dougs.fr → copie tous les couples `name=value`
              joints par `; `.
            </p>
          </div>
        </div>
      </details>

      <form onSubmit={handleConnect} className="mt-4 space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="dougs-cookie">Cookie de session</Label>
          <Textarea
            id="dougs-cookie"
            value={cookie}
            onChange={(e) => setCookie(e.target.value)}
            placeholder="dougs_token=…; another=…"
            rows={3}
            disabled={pending}
            required
            className="font-mono text-xs"
          />
          <p className="text-[11px] text-muted-foreground">
            Stocké chiffré côté DB. Jamais loggé ni renvoyé en clair.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="dougs-company">Company ID</Label>
            <Input
              id="dougs-company"
              value={companyIdInput}
              onChange={(e) => setCompanyIdInput(e.target.value)}
              disabled={pending}
              className="font-mono"
            />
          </div>
          <div className="sm:col-span-2 sm:flex sm:items-end sm:justify-end sm:gap-2">
            {connected ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setConfirmDisconnect(true)}
                disabled={pending}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="mr-1 size-3.5" />
                Déconnecter
              </Button>
            ) : null}
            <Button type="submit" disabled={pending || cookie.trim().length < 20}>
              <Check className="mr-1 size-4" />
              {pending ? "Enregistrement…" : connected ? "Rafraîchir" : "Connecter"}
            </Button>
          </div>
        </div>
      </form>

      {connected ? (
        <a
          href="https://app.dougs.fr"
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-muted-foreground text-xs hover:underline"
        >
          Ouvrir Dougs <ExternalLink className="size-3" />
        </a>
      ) : null}

      <ConfirmDialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title="Déconnecter Dougs ?"
        description="Le cookie chiffré sera supprimé. Les factures déjà poussées sur Dougs ne seront pas affectées."
        confirmLabel="Déconnecter"
        variant="destructive"
        onConfirm={handleDisconnect}
        pending={pending}
      />
    </section>
  );
}
