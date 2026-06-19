import { ContactAvatar } from "@/components/user/contact-avatar";
import { UserAvatar } from "@/components/user/user-avatar";

export type StackedAssignee =
  | { kind: "user"; id: string; fullName: string | null; avatarUrl: string | null }
  | { kind: "contact"; id: string; fullName: string; entityName: string | null };

/**
 * Pile d'avatars assignés. Overlap -7px à la Notion : chaque tête sauf la
 * première chevauche la précédente, avec un halo couleur du fond pour
 * rester lisible sur ligne survolée ou sélectionnée.
 */
export function AvatarStack({
  assignees,
  max = 3,
}: {
  assignees: StackedAssignee[];
  max?: number;
}) {
  if (assignees.length === 0) {
    return <span className="text-ds-text-tertiary">—</span>;
  }
  const visible = assignees.slice(0, max);
  const overflow = assignees.length - visible.length;
  return (
    <span className="flex items-center">
      {visible.map((a, i) => (
        <span
          key={`${a.kind}:${a.id}`}
          className="rounded-full ring-[1.5px] ring-ds-app"
          style={i === 0 ? undefined : { marginLeft: -7 }}
        >
          {a.kind === "user" ? (
            <UserAvatar size="sm" name={a.fullName} avatarUrl={a.avatarUrl} />
          ) : (
            <ContactAvatar size="sm" name={a.fullName} entityName={a.entityName} />
          )}
        </span>
      ))}
      {overflow > 0 ? (
        <span
          className="inline-flex size-6 items-center justify-center rounded-full bg-ds-hover font-semibold text-[10px] text-ds-text-muted ring-[1.5px] ring-ds-app"
          style={{ marginLeft: -7 }}
        >
          +{overflow}
        </span>
      ) : null}
    </span>
  );
}
