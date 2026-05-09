"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createApiToken, revokeApiToken } from "@/lib/actions/api-tokens";
import { formatDate } from "@/lib/format";
import { Check, Copy, KeyRound, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

type Token = {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export function ApiTokensForm({ tokens }: { tokens: Token[] }) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [pending, startTransition] = useTransition();
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = label.trim();
    if (!trimmed) return;
    startTransition(async () => {
      const res = await createApiToken({ label: trimmed });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setCreatedToken(res.data.token);
      setLabel("");
      router.refresh();
    });
  }

  function revoke(id: string, label: string) {
    if (!window.confirm(`Révoquer le token « ${label} » ? Cette action est irréversible.`)) return;
    startTransition(async () => {
      const res = await revokeApiToken({ id });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Token révoqué.");
      router.refresh();
    });
  }

  async function copyCreated() {
    if (!createdToken) return;
    try {
      await navigator.clipboard.writeText(createdToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Copie impossible — sélectionne et copie à la main.");
    }
  }

  const activeTokens = tokens.filter((t) => !t.revokedAt);

  return (
    <div className="space-y-4">
      {createdToken ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-emerald-900 text-xs dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
          <p className="font-medium">Token créé — copie-le maintenant !</p>
          <p className="mt-1 text-[11px]">
            Il ne sera plus jamais affiché. Stocke-le dans la config de ton client MCP.
          </p>
          <div className="mt-2 flex items-center gap-2 rounded bg-emerald-100/50 p-2 font-mono text-xs dark:bg-emerald-900/40">
            <code className="flex-1 break-all">{createdToken}</code>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={copyCreated}
              className="h-7 gap-1 px-2 text-xs"
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
          <button
            type="button"
            onClick={() => setCreatedToken(null)}
            className="mt-2 text-[11px] underline hover:no-underline"
          >
            J'ai copié, masquer
          </button>
        </div>
      ) : null}

      <form onSubmit={create} className="flex items-center gap-2">
        <Input
          placeholder="Label (ex. « Mon MacBook »)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          disabled={pending}
          maxLength={80}
        />
        <Button type="submit" size="sm" disabled={pending || !label.trim()} className="gap-1.5">
          <KeyRound className="size-3.5" />
          {pending ? "…" : "Générer"}
        </Button>
      </form>

      {activeTokens.length === 0 ? (
        <p className="text-muted-foreground text-xs italic">Aucun token actif.</p>
      ) : (
        <ul className="divide-y rounded-md border bg-background">
          {activeTokens.map((t) => (
            <li key={t.id} className="flex items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-sm">{t.label}</p>
                <p className="text-[11px] text-muted-foreground">
                  Créé le {formatDate(t.createdAt)}
                  {t.lastUsedAt ? ` · Utilisé le ${formatDate(t.lastUsedAt)}` : " · Jamais utilisé"}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => revoke(t.id, t.label)}
                disabled={pending}
                className="text-muted-foreground hover:text-destructive"
                title="Révoquer"
                aria-label={`Révoquer le token ${t.label}`}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
