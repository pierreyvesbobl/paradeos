import { type NoteSubjectType, noteSubjectTypeLabels } from "@/lib/schemas/notes";
import { cn } from "@/lib/utils";
import { Building2, CheckSquare, FolderKanban, User } from "lucide-react";
import Link from "next/link";

const SUBJECT_ICON: Record<NoteSubjectType, React.ComponentType<{ className?: string }>> = {
  project: FolderKanban,
  contact: User,
  entity: Building2,
  task: CheckSquare,
};

const SUBJECT_PATH: Record<NoteSubjectType, (id: string) => string> = {
  project: (id) => `/projets/${id}`,
  contact: (id) => `/contacts/${id}`,
  entity: (id) => `/entites/${id}`,
  task: (id) => `/taches/${id}`,
};

type Props = {
  type: NoteSubjectType;
  id: string;
  /** Nom lisible (ex: "Refonte Acme"). */
  label: string | null;
  className?: string;
};

/**
 * Pill cliquable affichant l'icône du type + le nom de la ressource liée.
 * Si `label` est null (sujet supprimé / inexistant), affiche juste le type
 * en muted.
 */
export function SubjectPill({ type, id, label, className }: Props) {
  const Icon = SUBJECT_ICON[type];
  const href = SUBJECT_PATH[type](id);
  const display = label ?? noteSubjectTypeLabels[type];
  return (
    <Link
      href={href}
      title={`${noteSubjectTypeLabels[type]} : ${display}`}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs transition-colors hover:bg-muted",
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className={cn("truncate font-medium", !label && "text-muted-foreground")}>
        {display}
      </span>
    </Link>
  );
}
