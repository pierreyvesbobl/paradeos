import { Breadcrumbs } from "@/components/breadcrumbs";
import { TagsManagement } from "@/components/emails/tags-management";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth/server";
import { listAllTags } from "@/lib/gmail/queries";
import { getGoogleAccount } from "@/lib/google/account";
import { hasRequiredGmailScopes } from "@/lib/google/oauth";

export default async function EmailTagsPage() {
  const user = await requireUser();
  const [tags, account] = await Promise.all([listAllTags(user.id), getGoogleAccount(user.id)]);
  const scopesOk = account ? hasRequiredGmailScopes(account.scopes) : false;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={<Breadcrumbs items={[{ label: "Emails", href: "/emails" }, { label: "Tags" }]} />}
        title="Tags Gmail"
        description="Catégories personnalisées (Compta, Annexe…) et tags auto-créés depuis le CRM. Chaque tag = un label Gmail Paradeos/…"
      />

      {!account ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-amber-900 text-sm dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Connecte d'abord Google dans{" "}
          <a className="underline" href="/settings/integrations">
            /settings/integrations
          </a>
          .
        </div>
      ) : !scopesOk ? (
        <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-amber-900 text-sm dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <p className="font-medium">⚠ Reconnexion Google requise pour créer les labels</p>
          <p className="text-xs">
            Le compte connecté n'a pas le scope <code>gmail.modify</code> (qui permet à Paradeos de
            créer/appliquer des labels Gmail). Tant que ce scope n'est pas accordé, on peut créer
            des entrées en base mais le label Gmail correspondant n'est{" "}
            <strong>pas créé côté Gmail</strong> — c'est ce qui affiche "Label Gmail non créé" sur
            les tags.
          </p>
          <a
            href="/api/google/oauth/start"
            className="inline-flex items-center gap-2 rounded-md bg-foreground px-3 py-1.5 text-background text-xs hover:opacity-90"
          >
            Reconnecter Google pour activer la création
          </a>
        </div>
      ) : null}

      <TagsManagement
        scopesOk={scopesOk}
        categories={tags.filter((t) => t.kind === "category")}
        projects={tags.filter((t) => t.kind === "project")}
        entities={tags.filter((t) => t.kind === "entity")}
      />
    </div>
  );
}
