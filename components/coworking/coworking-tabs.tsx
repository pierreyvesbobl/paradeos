"use client";

import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText, Receipt, Users } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";

const TABS = [
  { value: "invoices", label: "Factures", icon: Receipt },
  { value: "contracts", label: "Contrats", icon: FileText },
  { value: "coworkers", label: "Coworkers", icon: Users },
] as const;
type TabValue = (typeof TABS)[number]["value"];

type Props = {
  contracts: React.ReactNode;
  invoices: React.ReactNode;
  coworkers: React.ReactNode;
  contractsCount: number;
  invoicesCount: number;
  coworkersCount: number;
};

export function CoworkingTabs({
  contracts,
  invoices,
  coworkers,
  contractsCount,
  invoicesCount,
  coworkersCount,
}: Props) {
  const params = useSearchParams();
  const tabParam = params.get("tab");
  const initialValue: TabValue = TABS.some((t) => t.value === tabParam)
    ? (tabParam as TabValue)
    : "invoices";
  // Switch tab purement client (Radix) — pas de round-trip Next.js qui
  // re-render le Server Component complet. URL mise à jour via history
  // pour rester partageable au reload.
  const [value, setValue] = useState<TabValue>(initialValue);

  const handleChange = useCallback((next: string) => {
    setValue(next as TabValue);
    const sp = new URLSearchParams(window.location.search);
    if (next === "invoices") sp.delete("tab");
    else sp.set("tab", next);
    const qs = sp.toString();
    const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, "", url);
  }, []);

  const counts: Record<TabValue, number> = {
    contracts: contractsCount,
    invoices: invoicesCount,
    coworkers: coworkersCount,
  };
  const contents: Record<TabValue, React.ReactNode> = { contracts, invoices, coworkers };

  return (
    <Tabs value={value} onValueChange={handleChange}>
      <ScrollArea>
        <TabsList className="mb-3 gap-1 bg-transparent">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <TabsTrigger
                key={t.value}
                value={t.value}
                className="rounded-full data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-none"
              >
                <Icon
                  className="-ms-0.5 me-1.5 opacity-60"
                  size={16}
                  strokeWidth={2}
                  aria-hidden="true"
                />
                {t.label}
                <span className="ml-1.5 text-[11px] opacity-60">{counts[t.value]}</span>
              </TabsTrigger>
            );
          })}
        </TabsList>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
      {TABS.map((t) => (
        <TabsContent key={t.value} value={t.value}>
          {contents[t.value]}
        </TabsContent>
      ))}
    </Tabs>
  );
}
