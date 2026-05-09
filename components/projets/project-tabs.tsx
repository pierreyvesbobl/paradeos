"use client";

import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart3, FolderOpen, Info, ListTodo, StickyNote, Video } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

const TABS = [
  { value: "overview", label: "Vue d'ensemble", icon: Info },
  { value: "tasks", label: "Tâches", icon: ListTodo },
  { value: "notes", label: "Notes", icon: StickyNote },
  { value: "meetings", label: "Meetings", icon: Video },
  { value: "files", label: "Fichiers", icon: FolderOpen },
  { value: "time", label: "Temps & marge", icon: BarChart3 },
] as const;

type TabValue = (typeof TABS)[number]["value"];

type Props = {
  defaultTab?: TabValue;
  overview: React.ReactNode;
  tasks: React.ReactNode;
  notes: React.ReactNode;
  meetings: React.ReactNode;
  files: React.ReactNode;
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
  time,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tabParam = params.get("tab");
  const value: TabValue = TABS.some((t) => t.value === tabParam)
    ? (tabParam as TabValue)
    : defaultTab;

  const handleChange = useCallback(
    (next: string) => {
      const sp = new URLSearchParams(params.toString());
      if (next === defaultTab) sp.delete("tab");
      else sp.set("tab", next);
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, params, defaultTab],
  );

  const contents: Record<TabValue, React.ReactNode> = {
    overview,
    tasks,
    notes,
    meetings,
    files,
    time,
  };

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
