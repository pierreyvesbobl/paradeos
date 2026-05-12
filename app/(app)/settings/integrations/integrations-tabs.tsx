"use client";

import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Banknote, Cloud, KeyRound } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

const TABS = [
  { value: "compta", label: "Compta", icon: Banknote },
  { value: "google", label: "Google", icon: Cloud },
  { value: "api", label: "API & LLM", icon: KeyRound },
] as const;
type TabValue = (typeof TABS)[number]["value"];

type Props = {
  compta: React.ReactNode;
  google: React.ReactNode;
  api: React.ReactNode;
};

/**
 * Onglets de la page /settings/integrations. Persiste l'onglet actif
 * via `?tab=` pour les liens partageables et le retour de redirect
 * OAuth Google.
 */
export function IntegrationsTabs({ compta, google, api }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tabParam = params.get("tab");
  const value: TabValue = TABS.some((t) => t.value === tabParam)
    ? (tabParam as TabValue)
    : "compta";

  const handleChange = useCallback(
    (next: string) => {
      const sp = new URLSearchParams(params.toString());
      if (next === "compta") sp.delete("tab");
      else sp.set("tab", next);
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, params],
  );

  const contents: Record<TabValue, React.ReactNode> = { compta, google, api };

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
              </TabsTrigger>
            );
          })}
        </TabsList>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
      {TABS.map((t) => (
        <TabsContent key={t.value} value={t.value} className="space-y-6">
          {contents[t.value]}
        </TabsContent>
      ))}
    </Tabs>
  );
}
