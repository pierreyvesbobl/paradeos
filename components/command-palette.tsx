"use client";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { type SearchResults, globalSearch } from "@/lib/actions/global-search";
import { ArrowRight, Building2, CheckSquare, FolderKanban, Plus, User } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const QUICK_ACTIONS = [
  { label: "Nouveau projet / deal", href: "/projets/nouveau" },
  { label: "Nouveau contact", href: "/contacts/nouveau" },
  { label: "Nouvelle entité", href: "/entites/nouveau" },
  { label: "Nouvelle tâche", href: "/taches/nouveau" },
];

const NAV = [
  { label: "Tableau de bord", href: "/" },
  { label: "Projets / Pipeline", href: "/projets" },
  { label: "Contacts", href: "/contacts" },
  { label: "Entités", href: "/entites" },
  { label: "Tâches", href: "/taches" },
  { label: "Notes", href: "/notes" },
  { label: "Meetings", href: "/meetings" },
  { label: "Planning", href: "/planning" },
  { label: "Temps", href: "/temps" },
];

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setResults(null);
    }
  }, [open]);

  useEffect(() => {
    const trimmed = search.trim();
    if (trimmed.length < 2) {
      setResults(null);
      setPending(false);
      return;
    }
    setPending(true);
    const handle = setTimeout(async () => {
      try {
        const r = await globalSearch(trimmed);
        setResults(r);
      } catch {
        setResults({
          contacts: [],
          projects: [],
          entities: [],
          tasks: [],
        });
      } finally {
        setPending(false);
      }
    }, 200);
    return () => clearTimeout(handle);
  }, [search]);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  const hasQuery = search.trim().length >= 2;
  const isEmpty =
    hasQuery &&
    !pending &&
    results !== null &&
    results.contacts.length === 0 &&
    results.projects.length === 0 &&
    results.entities.length === 0 &&
    results.tasks.length === 0;

  return (
    <CommandDialog open={open} onOpenChange={setOpen} shouldFilter={!hasQuery}>
      <CommandInput
        placeholder="Rechercher ou exécuter une action…"
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        {!hasQuery ? (
          <>
            <CommandGroup heading="Créer">
              {QUICK_ACTIONS.map((a) => (
                <CommandItem key={a.href} value={a.label} onSelect={() => go(a.href)}>
                  <Plus className="size-4" />
                  {a.label}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandGroup heading="Aller à">
              {NAV.map((n) => (
                <CommandItem key={n.href} value={n.label} onSelect={() => go(n.href)}>
                  <ArrowRight className="size-4" />
                  {n.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : pending && !results ? (
          <div className="px-3 py-6 text-center text-muted-foreground text-sm">Recherche…</div>
        ) : isEmpty ? (
          <CommandEmpty>Aucun résultat pour « {search.trim()} ».</CommandEmpty>
        ) : results ? (
          <>
            {results.contacts.length > 0 ? (
              <CommandGroup heading="Contacts">
                {results.contacts.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={`cnt-${c.id}`}
                    onSelect={() => go(`/contacts/${c.id}`)}
                  >
                    <User className="size-4" />
                    {`${c.firstName} ${c.lastName}`.trim()}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {results.projects.length > 0 ? (
              <CommandGroup heading="Projets">
                {results.projects.map((p) => (
                  <CommandItem
                    key={p.id}
                    value={`prj-${p.id}`}
                    onSelect={() => go(`/projets/${p.id}`)}
                  >
                    <FolderKanban className="size-4" />
                    {p.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {results.entities.length > 0 ? (
              <CommandGroup heading="Entités">
                {results.entities.map((e) => (
                  <CommandItem
                    key={e.id}
                    value={`ent-${e.id}`}
                    onSelect={() => go(`/entites/${e.id}`)}
                  >
                    <Building2 className="size-4" />
                    {e.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {results.tasks.length > 0 ? (
              <CommandGroup heading="Tâches">
                {results.tasks.map((t) => (
                  <CommandItem
                    key={t.id}
                    value={`tsk-${t.id}`}
                    onSelect={() => go(`/taches/${t.id}`)}
                  >
                    <CheckSquare className="size-4" />
                    {t.title}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </>
        ) : (
          <div className="px-3 py-6 text-center text-muted-foreground text-sm">
            Tape au moins 2 caractères…
          </div>
        )}
      </CommandList>
    </CommandDialog>
  );
}
