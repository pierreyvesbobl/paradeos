"use client";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useState } from "react";

const fmt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });

function formatMoney(canonical: string): string {
  if (!canonical) return "";
  const n = Number(canonical);
  if (!Number.isFinite(n)) return canonical;
  return fmt.format(n);
}

/** Conserve uniquement les chiffres et un séparateur décimal, en `.`. */
function toCanonical(input: string): string {
  const stripped = input.replace(/\s/g, "").replace(",", ".");
  let seenDot = false;
  let out = "";
  for (const c of stripped) {
    if (c >= "0" && c <= "9") out += c;
    else if (c === "." && !seenDot) {
      out += ".";
      seenDot = true;
    }
  }
  return out;
}

type Props = {
  /** Valeur canonique (ex: "12500" ou "12500.5"). Vide = aucune. */
  value: string;
  onValueChange: (value: string) => void;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Symbole de devise affiché en suffixe. Défaut: € */
  currency?: string;
};

export function MoneyInput({
  value,
  onValueChange,
  id,
  placeholder,
  disabled,
  className,
  currency = "€",
}: Props) {
  const [focused, setFocused] = useState(false);
  const display = focused ? value.replace(".", ",") : formatMoney(value);

  return (
    <div className={cn("relative", className)}>
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={display}
        onChange={(e) => onValueChange(toCanonical(e.target.value))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        disabled={disabled}
        className="pr-8"
      />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground text-sm">
        {currency}
      </span>
    </div>
  );
}
