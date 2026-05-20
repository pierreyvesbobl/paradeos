import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";
import { listThreadsForSubject } from "@/lib/gmail/queries";
import { Mail } from "lucide-react";
import Link from "next/link";

type Props = {
  linkKind: "project" | "contact" | "entity";
  linkId: string;
  /** Limite de threads affichés sur la fiche (au-delà → lien vers /emails). */
  limit?: number;
};

/**
 * Tab "Emails" réutilisée dans `/projets/[id]`, `/contacts/[id]`,
 * `/entites/[id]`. Liste les threads liés au sujet, triés par date
 * décroissante. Cliquer ouvre le détail dans `/emails/[threadId]`.
 *
 * Server Component — appelé directement dans le JSX de la page (peut
 * être enveloppé dans Suspense par le caller si besoin de streaming).
 */
export async function EmailsTab({ linkKind, linkId, limit = 20 }: Props) {
  const threads = await listThreadsForSubject(linkKind, linkId, { limit });

  if (threads.length === 0) {
    return (
      <section className="space-y-2">
        <header className="flex items-center justify-between">
          <h3 className="font-medium text-foreground text-sm">Emails</h3>
        </header>
        <p className="text-muted-foreground text-xs italic">
          Aucun thread Gmail lié. Les emails contenant ce{" "}
          {linkKind === "project" ? "projet" : linkKind === "contact" ? "contact" : "entité"} (par
          email expéditeur / destinataire) seront listés ici après la prochaine sync.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-2.5">
      <header className="flex items-center justify-between">
        <h3 className="font-medium text-foreground text-sm">
          Emails <span className="text-muted-foreground text-xs">({threads.length})</span>
        </h3>
      </header>
      <ul className="divide-y rounded-md border bg-background">
        {threads.map((t) => {
          const participants = Array.isArray(t.participants)
            ? (t.participants as Array<{ email: string; name?: string }>)
            : [];
          const preview = participants
            .slice(0, 2)
            .map((p) => p.name || p.email)
            .join(", ");
          return (
            <li key={t.id} className="px-3 py-2.5">
              <Link href={`/emails/${t.id}`} className="block space-y-0.5 hover:underline">
                <div className="flex items-center justify-between gap-2">
                  <p
                    className={`min-w-0 flex-1 truncate text-sm ${t.hasUnread ? "font-semibold" : "font-medium"}`}
                  >
                    <Mail className="-mt-0.5 mr-1 inline size-3.5 text-muted-foreground" />
                    {t.subject || "(sans objet)"}
                  </p>
                  <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                    {t.messageCount > 1 ? (
                      <Badge variant="outline" className="text-[10px]">
                        {t.messageCount}
                      </Badge>
                    ) : null}
                    {t.lastMessageAt ? (
                      <span>{formatDate(t.lastMessageAt.toISOString())}</span>
                    ) : null}
                  </div>
                </div>
                <p className="line-clamp-1 text-muted-foreground text-xs">
                  <span className="font-medium text-foreground/70">{preview}</span>
                  {t.snippet ? <span className="ml-2">— {t.snippet}</span> : null}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
