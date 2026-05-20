"use client";

import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart3, FolderOpen, Info, ListTodo, Receipt, StickyNote, Video } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";

const ALL_TABS = [
  { value: "overview", label: "Vue d'ensemble", icon: Info },
  { value: "tasks", label: "Tâches", icon: ListTodo },
  { value: "notes", label: "Notes", icon: StickyNote },
  { value: "meetings", label: "Meetings", icon: Video },
  { value: "files", label: "Fichiers", icon: FolderOpen },
  { value: "billing", label: "Facturation", icon: Receipt },
  { value: "time", label: "Temps & marge", icon: BarChart3 },
] as const;

type TabValue = (typeof ALL_TABS)[number]["value"];

type Props = {
  defaultTab?: TabValue;
  overview: React.ReactNode;
  tasks: React.ReactNode;
  notes: React.ReactNode;
  meetings: React.ReactNode;
  files: React.ReactNode;
  /** Null = onglet caché (projets non-client). */
  billing: React.ReactNode | null;
  time: React.ReactNode;
};

/**
 * Onglets pour la fiche projet. Persiste l'onglet actif via `?tab=`
 * pour permettre les liens partageables. Le tab par défaut dépend
 * du type de projet (cf. page parent).
 */
export function ProjectTabs({
  defaultTab = "overview",
  overview,
  tasks,
  notes,
  meetings,
  files,
  billing,
  time,
}: Props) {
  const params = useSearchParams();
  const tabParam = params.get("tab");

  // Onglet facturation masqué pour les projets non-client.
  const tabs = ALL_TABS.filter((t) => t.value !== "billing" || billing !== null);
  const initialValue: TabValue = tabs.some((t) => t.value === tabParam)
    ? (tabParam as TabValue)
    : defaultTab;

  // Onglet en state local pour switcher sans round-trip serveur.
  // Avant : router.replace(?tab=…) re-render TOUTE la page Server
  // Component à chaque clic (2-3 s sur une fiche projet chargée). Le
  // contenu de tous les tabs est déjà rendu en props → switch instantané
  // via Radix. L'URL est juste maj via history.replaceState pour rester
  // partageable au reload (pas de navigation Next.js).
  const [value, setValue] = useState<TabValue>(initialValue);

  const handleChange = useCallback(
    (next: string) => {
      setValue(next as TabValue);
      const sp = new URLSearchParams(window.location.search);
      if (next === defaultTab) sp.delete("tab");
      else sp.set("tab", next);
      const qs = sp.toString();
      const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
      window.history.replaceState(null, "", url);
    },
    [defaultTab],
  );

  const contents: Record<TabValue, React.ReactNode> = {
    overview,
    tasks,
    notes,
    meetings,
    files,
    billing,
    time,
  };

  return (
    <Tabs value={value} onValueChange={handleChange}>
      <ScrollArea>
        <TabsList className="mb-3 gap-1 bg-transparent">
          {tabs.map((t) => {
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
      {tabs.map((t) => (
        <TabsContent key={t.value} value={t.value} className="space-y-6">
          {contents[t.value]}
        </TabsContent>
      ))}
    </Tabs>
  );
}
