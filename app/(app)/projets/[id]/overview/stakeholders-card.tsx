import { ProjectContactsField } from "@/components/projects/project-contacts-field";
import { ProjectMembersField } from "@/components/projects/project-members-field";
import { UsersThree } from "@phosphor-icons/react/dist/ssr";

type Member = { id: string; fullName: string | null; avatarUrl: string | null };
type Contact = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
};
type ContactOption = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  entityName?: string | null;
};

/**
 * Carte « Parties prenantes » : sous-carte Interne (membres) + sous-carte
 * Externe (contacts CRM) — chacune s'appuie sur les éditeurs existants
 * (ProjectMembersField / ProjectContactsField) qui gèrent déjà les
 * mutations + picker + hover peek.
 */
export function StakeholdersCard({
  projectId,
  members,
  ownerId,
  userOptions,
  contacts,
  contactOptions,
  projectEntityId,
  entityName,
  primaryContactId,
}: {
  projectId: string;
  members: Member[];
  ownerId: string | null;
  userOptions: Member[];
  contacts: Contact[];
  contactOptions: ContactOption[];
  projectEntityId: string | null;
  entityName: string | null;
  primaryContactId: string | null;
}) {
  return (
    <section className="space-y-4 rounded-[10px] border border-ds-border bg-ds-surface p-5">
      <header className="flex items-center gap-2 font-semibold text-[11px] text-muted-foreground uppercase tracking-[0.05em]">
        <UsersThree size={13} weight="duotone" />
        <span>Parties prenantes</span>
      </header>

      <div className="space-y-2">
        <p className="font-medium text-[11px] text-muted-foreground uppercase tracking-[0.05em]">
          Interne
        </p>
        <ProjectMembersField
          projectId={projectId}
          members={members}
          options={userOptions}
          ownerId={ownerId}
        />
      </div>

      <div className="space-y-2">
        <p className="font-medium text-[11px] text-muted-foreground uppercase tracking-[0.05em]">
          Externe
          {entityName ? <span className="normal-case tracking-normal"> · {entityName}</span> : null}
          <span className="text-ds-text-tertiary normal-case tracking-normal">
            {" "}
            · {contacts.length}
          </span>
        </p>
        <ProjectContactsField
          projectId={projectId}
          projectEntityId={projectEntityId}
          contacts={contacts}
          options={contactOptions}
          primaryContactId={primaryContactId}
        />
      </div>
    </section>
  );
}
