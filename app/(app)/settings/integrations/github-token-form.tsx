"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateGithubToken } from "@/lib/actions/integrations";

export function GithubTokenForm({ currentKeyPreview }: { currentKeyPreview: string | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(currentKeyPreview === null);
  const [value, setValue] = useState("");
  const [pending, startTransition] = useTransition();

  function save(opts?: { clear?: boolean }) {
    startTransition(async () => {
      const token = opts?.clear ? "" : value.trim();
      const res = await updateGithubToken({ token });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(opts?.clear ? "Jeton GitHub supprimé." : "Jeton GitHub enregistré.");
      setValue("");
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="space-y-3"
    >
      <div className="space-y-1.5">
        <Label htmlFor="github-token" className="text-xs">
          Jeton d'accès GitHub
        </Label>
        {!editing && currentKeyPreview ? (
          <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2">
            <span className="font-mono text-muted-foreground text-sm">{currentKeyPreview}</span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setEditing(true)}
                disabled={pending}
              >
                Modifier
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => save({ clear: true })}
              >
                Supprimer
              </Button>
            </div>
          </div>
        ) : (
          <Input
            id="github-token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="github_pat_…"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={pending}
            className="font-mono"
          />
        )}
        <p className="text-muted-foreground text-xs">
          Crée un jeton à granularité fine sur{" "}
          <a
            href="https://github.com/settings/personal-access-tokens/new"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
          >
            github.com/settings/personal-access-tokens
          </a>
          , limité aux dépôts rattachés à des projets, avec la permission « Issues : lecture » pour
          les afficher, « lecture et écriture » pour que les fonctionnalités partent en issues.
        </p>
      </div>

      {editing ? (
        <div className="flex gap-2 border-t pt-3">
          <Button type="submit" size="sm" disabled={pending || value.trim() === ""}>
            {pending ? "Enregistrement…" : "Enregistrer"}
          </Button>
          {currentKeyPreview ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => {
                setEditing(false);
                setValue("");
              }}
            >
              Annuler
            </Button>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
