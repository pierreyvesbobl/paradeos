"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateOpenAiKey } from "@/lib/actions/integrations";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

export function OpenAiKeyForm({ currentPreview }: { currentPreview: string | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(currentPreview === null);
  const [value, setValue] = useState("");
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    startTransition(async () => {
      const res = await updateOpenAiKey({ apiKey: value.trim() });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(value.trim() === "" ? "Clé supprimée." : "Clé enregistrée.");
      setValue("");
      setEditing(false);
      router.refresh();
    });
  }

  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-muted-foreground text-sm">{currentPreview ?? "—"}</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            Modifier
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => {
              startTransition(async () => {
                const res = await updateOpenAiKey({ apiKey: "" });
                if (!res.ok) {
                  toast.error(res.message);
                  return;
                }
                toast.success("Clé supprimée.");
                router.refresh();
              });
            }}
          >
            Supprimer
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="openai-key" className="text-xs">
          Clé API
        </Label>
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
        <p className="text-muted-foreground text-xs">
          La clé n'est jamais réaffichée en clair après enregistrement.
        </p>
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending || value.trim() === ""}>
          {pending ? "Enregistrement…" : "Enregistrer"}
        </Button>
        {currentPreview !== null ? (
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
    </form>
  );
}
