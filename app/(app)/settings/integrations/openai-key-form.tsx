"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateOpenAiKey } from "@/lib/actions/integrations";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

export function OpenAiKeyForm({
  currentKeyPreview,
}: {
  currentKeyPreview: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(currentKeyPreview === null);
  const [value, setValue] = useState("");
  const [pending, startTransition] = useTransition();

  function save(opts?: { clear?: boolean }) {
    startTransition(async () => {
      const apiKey = opts?.clear ? "" : value.trim();
      const res = await updateOpenAiKey({ apiKey });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(opts?.clear ? "Clé OpenAI supprimée." : "Clé OpenAI enregistrée.");
      setValue("");
      setEditing(false);
      router.refresh();
    });
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    save();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="openai-key" className="text-xs">
          Clé API OpenAI directe
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
            id="openai-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-…"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={pending}
            className="font-mono"
          />
        )}
        <p className="text-muted-foreground text-xs">
          Crée une clé sur{" "}
          <a
            href="https://platform.openai.com/api-keys"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
          >
            platform.openai.com/api-keys
          </a>
          . Distincte de la clé OpenRouter ci-dessus : OpenRouter ne propose pas la transcription
          audio Whisper.
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
