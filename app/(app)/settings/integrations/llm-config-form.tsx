"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateLlmConfig } from "@/lib/actions/integrations";
import { DEFAULT_LLM_MODEL } from "@/lib/schemas/integrations";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

/**
 * Sélection rapide de modèles populaires sur OpenRouter. L'utilisateur
 * peut aussi taper un slug arbitraire dans le champ — la liste
 * complète est sur https://openrouter.ai/models.
 */
const SUGGESTED_MODELS: { id: string; label: string }[] = [
  { id: "openai/gpt-4.1", label: "GPT-4.1 (default — équivalent à l'ancien)" },
  { id: "openai/gpt-4o", label: "GPT-4o" },
  { id: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4 (recommandé qualité)" },
  { id: "anthropic/claude-haiku-4-5", label: "Claude Haiku 4.5 (rapide & moins cher)" },
  { id: "google/gemini-2.0-flash-exp", label: "Gemini 2.0 Flash" },
  { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B" },
];

export function LlmConfigForm({
  currentKeyPreview,
  currentModel,
}: {
  currentKeyPreview: string | null;
  currentModel: string | null;
}) {
  const router = useRouter();
  const [editingKey, setEditingKey] = useState(currentKeyPreview === null);
  const [keyValue, setKeyValue] = useState("");
  const [model, setModel] = useState(currentModel ?? "");
  const [pending, startTransition] = useTransition();

  function save(opts?: { clearKey?: boolean }) {
    startTransition(async () => {
      // apiKey: `undefined` = ne pas toucher, `""` = supprimer, sinon = set.
      // On n'envoie une nouvelle valeur de clé que si l'user édite
      // explicitement le champ ou demande la suppression.
      const apiKey = opts?.clearKey ? "" : editingKey ? keyValue.trim() : undefined;
      const res = await updateLlmConfig({
        apiKey,
        model: model.trim(),
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Configuration enregistrée.");
      setKeyValue("");
      setEditingKey(false);
      router.refresh();
    });
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    save();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {/* Clé API */}
      <div className="space-y-1.5">
        <Label htmlFor="or-key" className="text-xs">
          Clé API OpenRouter
        </Label>
        {!editingKey && currentKeyPreview ? (
          <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2">
            <span className="font-mono text-muted-foreground text-sm">{currentKeyPreview}</span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setEditingKey(true)}
                disabled={pending}
              >
                Modifier
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => save({ clearKey: true })}
              >
                Supprimer
              </Button>
            </div>
          </div>
        ) : (
          <Input
            id="or-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-or-v1-…"
            value={keyValue}
            onChange={(e) => setKeyValue(e.target.value)}
            disabled={pending}
            className="font-mono"
          />
        )}
        <p className="text-muted-foreground text-xs">
          Crée une clé sur{" "}
          <a
            href="https://openrouter.ai/keys"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
          >
            openrouter.ai/keys
          </a>
          . Une clé = accès à 200+ modèles (Claude, GPT, Gemini, Llama…) avec un seul billing.
        </p>
      </div>

      {/* Modèle */}
      <div className="space-y-1.5">
        <Label htmlFor="or-model" className="text-xs">
          Modèle (slug OpenRouter)
        </Label>
        <Input
          id="or-model"
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder={DEFAULT_LLM_MODEL}
          value={model}
          onChange={(e) => setModel(e.target.value)}
          disabled={pending}
          className="font-mono text-sm"
          list="or-model-suggestions"
        />
        <datalist id="or-model-suggestions">
          {SUGGESTED_MODELS.map((m) => (
            <option key={m.id} value={m.id} label={m.label} />
          ))}
        </datalist>
        <p className="text-muted-foreground text-xs">
          Format <code>provider/model</code>. Vide = défaut <code>{DEFAULT_LLM_MODEL}</code>.
          Suggestions :
        </p>
        <ul className="space-y-0.5 text-[11px] text-muted-foreground">
          {SUGGESTED_MODELS.map((m) => (
            <li key={m.id} className="flex gap-2">
              <button
                type="button"
                onClick={() => setModel(m.id)}
                className="font-mono text-foreground/80 hover:text-foreground hover:underline"
                disabled={pending}
              >
                {m.id}
              </button>
              <span className="truncate">— {m.label}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex gap-2 border-t pt-3">
        <Button
          type="submit"
          size="sm"
          disabled={pending || (editingKey && keyValue.trim() === "" && !currentKeyPreview)}
        >
          {pending ? "Enregistrement…" : "Enregistrer"}
        </Button>
        {editingKey && currentKeyPreview ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => {
              setEditingKey(false);
              setKeyValue("");
            }}
          >
            Annuler
          </Button>
        ) : null}
      </div>
    </form>
  );
}
