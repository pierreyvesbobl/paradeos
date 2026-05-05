"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { quickCreateTask } from "@/lib/actions/tasks";

type Props = {
  /** Si fourni, la tâche créée est rattachée à ce projet. */
  projectId?: string;
  /** Texte d'invite. */
  placeholder?: string;
  /** Style compact (sur fiche projet) ou bordé full-width (page /taches). */
  variant?: "default" | "inline";
};

export function QuickAddTask({
  projectId,
  placeholder = "+ Ajouter une tâche…",
  variant = "default",
}: Props) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement | null>(null);

  function submit() {
    const value = title.trim();
    if (!value) return;
    startTransition(async () => {
      const result = await quickCreateTask({ title: value, projectId });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setTitle("");
      router.refresh();
      // Garde le focus pour enchaîner.
      inputRef.current?.focus();
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
    if (e.key === "Escape") {
      setTitle("");
      inputRef.current?.blur();
    }
  }

  const wrapperClass =
    variant === "inline"
      ? "flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/40"
      : "flex items-center gap-2 rounded-md border bg-card px-3 py-2 focus-within:ring-2 focus-within:ring-ring";

  return (
    <div className={wrapperClass}>
      <Plus className="size-4 shrink-0 text-muted-foreground" />
      <input
        ref={inputRef}
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={pending}
        maxLength={300}
        className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
      />
      {title.trim() ? (
        <span className="hidden text-muted-foreground text-xs sm:inline">
          {pending ? "…" : "Entrée"}
        </span>
      ) : null}
    </div>
  );
}
