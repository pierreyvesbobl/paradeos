"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createLinkedinSyncToken,
  revokeLinkedinSyncToken,
} from "@/lib/actions/linkedin-sync-tokens";
import { formatDate } from "@/lib/format";
import { Check, Copy, KeyRound, Linkedin, Trash2 } from "lucide-react";
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
  appUrl: string;
  syncTokens: SyncToken[];
  lastConversationsSyncAt: string | null;
  lastConnectionsSyncAt: string | null;
  lastError: string | null;
  conversationCount: number;
  pendingMatchCount: number;
};

/** Au-delà, la synchro est probablement à l'arrêt et non simplement lente. */
const STALE_AFTER_HOURS = 48;

function hoursSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : (Date.now() - t) / 3_600_000;
}

export function LinkedinSection({
  appUrl,
  syncTokens,
  lastConversationsSyncAt,
  lastConnectionsSyncAt,
  lastError,
  conversationCount,
  pendingMatchCount,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tokenLabel, setTokenLabel] = useState("");
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const ingestEndpoint = `${appUrl.replace(/\/+$/, "")}/api/linkedin/ingest`;
  const age = hoursSince(lastConversationsSyncAt);
  const connected = syncTokens.length > 0;
  const stale = age !== null && age > STALE_AFTER_HOURS;

  function copyText(value: string, label: string) {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(label);
      toast.success(`${label} copié.`);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  function createToken(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const label = tokenLabel.trim();
    if (!label) return;
    startTransition(async () => {
      const res = await createLinkedinSyncToken({ label });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setCreatedToken(res.data.token);
      setTokenLabel("");
      toast.success("Token créé. Copie-le maintenant, il ne sera plus affiché.");
      router.refresh();
    });
  }

  function revokeToken(id: string, label: string) {
    startTransition(async () => {
      const res = await revokeLinkedinSyncToken({ id });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(`Token « ${label} » révoqué.`);
      router.refresh();
    });
  }

  return (
    <section className="rounded-lg border bg-card p-6">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 font-medium text-sm">
            <Linkedin className="size-4" />
            LinkedIn
          </h2>
          <p className="mt-1 text-muted-foreground text-xs">
            Import des conversations et des relations. Les données sont lues depuis ton navigateur
            par l'extension Chrome, sur ta propre session — LinkedIn n'expose ni les messages ni les
            relations via son API, et un appel depuis nos serveurs ferait restreindre ton compte.
            Ton cookie ne quitte jamais ta machine.
          </p>
        </div>
        <StatusBadge connected={connected} stale={stale} />
      </header>

      {connected ? (
        <dl className="mb-4 grid grid-cols-2 gap-3 rounded-md border bg-background p-3 text-xs sm:grid-cols-4">
          <Stat label="Conversations" value={String(conversationCount)} />
          <Stat label="À rapprocher" value={String(pendingMatchCount)} />
          <Stat
            label="Dernière synchro"
            value={lastConversationsSyncAt ? formatDate(lastConversationsSyncAt) : "jamais"}
          />
          <Stat
            label="Relations"
            value={lastConnectionsSyncAt ? formatDate(lastConnectionsSyncAt) : "jamais"}
          />
        </dl>
      ) : null}

      {stale ? (
        <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-800 text-xs dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          Aucune synchro depuis plus de {STALE_AFTER_HOURS} h. La synchro LinkedIn n'a lieu que
          lorsque Chrome est ouvert avec l'extension active — vérifie qu'elle est toujours installée
          et que tu es connecté sur linkedin.com.
        </p>
      ) : null}

      {lastError ? (
        <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-destructive text-xs">
          Dernière erreur : {lastError}
        </p>
      ) : null}

      <div className="rounded-md border bg-muted/30 p-3">
        <p className="font-medium text-xs">Tokens de synchro</p>
        <p className="mt-1 mb-3 text-[11px] text-muted-foreground">
          Génère un token par machine, puis colle-le dans l'onglet LinkedIn de l'extension «
          Paradeos Sync » avec l'endpoint ci-dessous.
        </p>

        <div className="mb-3">
          <p className="text-[11px] text-muted-foreground">Endpoint :</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded bg-muted/60 p-1.5 font-mono text-[11px]">
              {ingestEndpoint}
            </code>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => copyText(ingestEndpoint, "Endpoint")}
              className="h-7 px-2 text-xs"
              aria-label="Copier l'endpoint"
            >
              {copied === "Endpoint" ? <Check className="size-3" /> : <Copy className="size-3" />}
            </Button>
          </div>
        </div>

        {createdToken ? (
          <div className="mb-3 space-y-2 rounded-md border border-emerald-300 bg-emerald-50 p-2 dark:border-emerald-800 dark:bg-emerald-950">
            <div>
              <p className="text-[11px] text-muted-foreground">Token (affiché une seule fois) :</p>
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
                  aria-label="Copier le token"
                >
                  {copied === "Token" ? <Check className="size-3" /> : <Copy className="size-3" />}
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
        <summary className="cursor-pointer text-sm">Comment ça marche, et les limites</summary>
        <div className="mt-3 space-y-2 text-muted-foreground text-xs">
          <p>
            <strong className="text-foreground">Lecture seule.</strong> Paradeos n'envoie jamais de
            message et n'émet jamais d'invitation. C'est ce qui sépare une lecture discrète d'une
            automation détectable.
          </p>
          <p>
            <strong className="text-foreground">Rythme volontairement lent.</strong> 20
            conversations et 200 relations par passage, avec un délai aléatoire entre chaque appel.
            Un rythme parfaitement régulier est un signal en soi.
          </p>
          <p>
            <strong className="text-foreground">Pas de synchro sans Chrome.</strong> Contrairement à
            Gmail, il n'y a pas de tâche planifiée côté serveur : tout passe par l'extension.
          </p>
          <p>
            <strong className="text-foreground">L'API interne peut changer.</strong> LinkedIn ne
            garantit rien. Si la synchro ne remonte plus rien, le bouton « Diagnostic » de
            l'extension indique quel endpoint a cessé de répondre.
          </p>
        </div>
      </details>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function StatusBadge({ connected, stale }: { connected: boolean; stale: boolean }) {
  if (!connected) {
    return (
      <span className="shrink-0 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-amber-700 text-xs dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
        Non configuré
      </span>
    );
  }
  if (stale) {
    return (
      <span className="shrink-0 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-amber-700 text-xs dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
        Synchro en retard
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-emerald-700 text-xs dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
      Connecté
    </span>
  );
}
