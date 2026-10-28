"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { setDevAutoConfirmMin } from "@/lib/actions/dev-settings";

type Props = {
  value: string;
  choices: { value: string; label: string }[];
};

export function DevAutoConfirmForm({ value, choices }: Props) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function change(next: string) {
    startTransition(async () => {
      const res = await setDevAutoConfirmMin({ value: next as "off" | "0.95" | "0.9" | "0.8" });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(
        next === "off"
          ? "Les rapprochements se valident à la main."
          : `Confirmation sans clic dès ${Math.round(Number(next) * 100)} % de confiance.`,
      );
      router.refresh();
    });
  }

  return (
    <label className="flex flex-wrap items-center gap-3 text-sm">
      <span className="text-muted-foreground text-xs">Confirmer sans clic</span>
      <select
        value={value}
        disabled={pending}
        onChange={(e) => change(e.target.value)}
        className="h-8 rounded-md border bg-background px-2 text-sm"
      >
        {choices.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
    </label>
  );
}
