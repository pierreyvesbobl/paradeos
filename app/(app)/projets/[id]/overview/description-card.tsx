import { ProjDescription } from "@/app/(app)/projets/[id]/inline-fields";
import { TextT } from "@phosphor-icons/react/dist/ssr";

/**
 * Carte « Description » — surface + hairline + eyebrow, avec l'éditeur
 * inline riche existant (ProjDescription) qui gère click-to-edit et
 * l'auto-save.
 */
export function DescriptionCard({
  projectId,
  value,
}: {
  projectId: string;
  value: string | null;
}) {
  return (
    <section className="space-y-3 rounded-[10px] border border-ds-border bg-ds-surface p-5">
      <header className="flex items-center gap-2 font-semibold text-[11px] text-muted-foreground uppercase tracking-[0.05em]">
        <TextT size={13} weight="duotone" />
        <span>Description</span>
      </header>
      <ProjDescription id={projectId} value={value} />
    </section>
  );
}
