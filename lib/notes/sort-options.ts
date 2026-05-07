import type { NoteSortField } from "@/lib/db/queries/notes";

export type NoteSortOption = {
  field: NoteSortField;
  dir: "asc" | "desc";
  label: string;
};

export const NOTE_SORT_GROUPS: { heading: string; items: NoteSortOption[] }[] = [
  {
    heading: "Date",
    items: [
      { field: "occurredAt", dir: "desc", label: "Plus récent" },
      { field: "occurredAt", dir: "asc", label: "Plus ancien" },
    ],
  },
  {
    heading: "Regrouper par",
    items: [
      { field: "subject", dir: "asc", label: "Sujet (A→Z)" },
      { field: "subject", dir: "desc", label: "Sujet (Z→A)" },
      { field: "kind", dir: "asc", label: "Type" },
      { field: "author", dir: "asc", label: "Auteur" },
    ],
  },
];

export const NOTE_SORT_OPTIONS: NoteSortOption[] = NOTE_SORT_GROUPS.flatMap((g) => g.items);
