import { cn } from "@/lib/utils";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type MentionResolver = {
  /** Map login (lowercased) → user link href. */
  users: Record<string, { id: string; fullName: string | null }>;
  /** Map slug (lowercased) → entity link. */
  entities: Record<string, string>;
  projects: Record<string, string>;
  contacts: Record<string, string>;
  opportunities: Record<string, string>;
  tasks: Record<string, string>;
};

type Props = {
  content: string;
  resolver?: MentionResolver;
  className?: string;
};

const MENTION_RE =
  /(@[\p{L}][\p{L}\p{N}_-]*)|(#(?:project|projet|opp|opportunite|opportunité|contact|entity|entite|entité|task|tache|tâche):[^\s)\]]+)/giu;

/**
 * Pré-traite le contenu pour transformer @mention et #subject:slug en
 * liens markdown que react-markdown rendra automatiquement.
 */
function inlineLinkify(content: string, resolver?: MentionResolver): string {
  if (!resolver) return content;
  return content.replace(MENTION_RE, (match) => {
    if (match.startsWith("@")) {
      const key = match.slice(1).toLowerCase();
      const user = resolver.users[key];
      if (user) return `[${match}](/settings/profile)`;
      return match;
    }
    // #kind:slug
    const m = match.match(/^#([^:]+):(.+)$/);
    if (!m) return match;
    const kind = m[1]?.toLowerCase() ?? "";
    const slug = (m[2] ?? "").toLowerCase();
    const map: Record<string, Record<string, string>> = {
      project: resolver.projects,
      projet: resolver.projects,
      opp: resolver.opportunities,
      opportunite: resolver.opportunities,
      opportunité: resolver.opportunities,
      contact: resolver.contacts,
      entity: resolver.entities,
      entite: resolver.entities,
      entité: resolver.entities,
      task: resolver.tasks,
      tache: resolver.tasks,
      tâche: resolver.tasks,
    };
    const href = map[kind]?.[slug];
    if (href) return `[${match}](${href})`;
    return match;
  });
}

export function Markdown({ content, resolver, className }: Props) {
  const prepared = inlineLinkify(content, resolver);
  return (
    <div
      className={cn(
        "prose prose-sm dark:prose-invert max-w-none",
        "prose-headings:font-semibold prose-headings:tracking-tight",
        "prose-p:my-1.5 prose-pre:my-2 prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-[12px] prose-code:before:content-none prose-code:after:content-none",
        "prose-a:text-primary prose-a:no-underline hover:prose-a:underline",
        "prose-li:my-0.5 prose-ol:my-1.5 prose-ul:my-1.5",
        "prose-hr:my-3",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children, ...rest }) => {
            if (!href) return <span>{children}</span>;
            const isInternal = href.startsWith("/");
            if (isInternal) {
              return (
                <Link href={href as never} {...rest}>
                  {children}
                </Link>
              );
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
                {children}
              </a>
            );
          },
        }}
      >
        {prepared}
      </ReactMarkdown>
    </div>
  );
}
