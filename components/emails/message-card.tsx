import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";
import { parseEmailThread } from "@/lib/gmail/thread-parse";
import { cn } from "@/lib/utils";
import DOMPurify from "isomorphic-dompurify";

/**
 * Rendu d'un message d'un thread : avatar + header propre, corps HTML
 * sanitisé ou texte formaté, historique du fil replié en bas.
 *
 * Server component — la sanitisation DOMPurify tourne côté node (via
 * isomorphic-dompurify + jsdom).
 */
export type MessageCardProps = {
  id: string;
  gmailMessageId: string;
  fromEmail: string | null;
  fromName: string | null;
  toEmails: string[];
  ccEmails: string[];
  subject: string | null;
  snippet: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  internalDate: Date | null;
  isDraft: boolean;
  extractionStatus: string;
};

function initialsFor(name: string | null | undefined, email: string | null | undefined): string {
  const source = name ?? email ?? "";
  if (!source) return "?";
  const parts = source
    .trim()
    .split(/[\s@]+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return (parts[0]?.[0] ?? "?").toUpperCase();
  return ((parts[0]?.[0] ?? "") + (parts.at(1)?.[0] ?? "")).toUpperCase();
}

function linkifyText(text: string): string {
  // Encode HTML entities, puis remplace les URLs par des <a>. Sans
  // décodage ambigu — on part du texte brut donc pas de vraie balise à
  // préserver.
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return escaped.replace(
    /(https?:\/\/[^\s<>"']+)/g,
    '<a href="$1" target="_blank" rel="noreferrer noopener" class="text-primary underline underline-offset-2">$1</a>',
  );
}

const SANITIZE_CONFIG = {
  ADD_ATTR: ["target", "rel"],
  FORBID_TAGS: ["script", "style", "iframe", "form", "input", "object", "embed"],
  FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover"],
};

export function MessageCard({ m }: { m: MessageCardProps }) {
  const parsed = parseEmailThread({ bodyText: m.bodyText, bodyHtml: m.bodyHtml });
  const displayName = m.fromName || m.fromEmail || "(expéditeur inconnu)";

  const hasHtml = !!parsed.cleanHtml && parsed.cleanHtml.length > 20;
  const sanitizedHtml = hasHtml
    ? DOMPurify.sanitize(parsed.cleanHtml ?? "", SANITIZE_CONFIG)
    : null;
  const textAsHtml = !hasHtml && parsed.cleanText ? linkifyText(parsed.cleanText) : null;

  return (
    <article className="rounded-lg border bg-card">
      <header className="flex items-start gap-3 border-b p-4">
        <Avatar className="size-10 shrink-0">
          <AvatarFallback className="bg-primary/10 font-semibold text-[13px] text-primary">
            {initialsFor(m.fromName, m.fromEmail)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <p className="truncate font-medium text-sm">{displayName}</p>
            {m.fromName && m.fromEmail ? (
              <p className="truncate text-[11px] text-muted-foreground">&lt;{m.fromEmail}&gt;</p>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            À : {m.toEmails.join(", ") || "—"}
            {m.ccEmails.length > 0 ? ` · Cc : ${m.ccEmails.join(", ")}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
          {m.isDraft ? (
            <Badge variant="outline" className="text-[10px]">
              Brouillon
            </Badge>
          ) : null}
          {m.extractionStatus === "pending" ? (
            <Badge
              variant="outline"
              className="border-amber-300 bg-amber-50 text-[10px] text-amber-800"
            >
              Extraction en attente
            </Badge>
          ) : null}
          {m.internalDate ? <span>{formatDateTime(m.internalDate)}</span> : null}
        </div>
      </header>

      <div className="space-y-4 p-4">
        {sanitizedHtml ? (
          <div
            className={cn(
              "prose prose-sm max-w-none",
              "prose-p:my-2 prose-headings:mt-3 prose-headings:mb-1 prose-a:text-primary",
              "prose-img:my-2 prose-img:max-w-full",
              "dark:prose-invert",
            )}
            // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized via DOMPurify above.
            dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
          />
        ) : textAsHtml ? (
          <div
            className="whitespace-pre-wrap break-words text-foreground/90 text-sm leading-relaxed"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: linkify only escapes + wraps URLs.
            dangerouslySetInnerHTML={{ __html: textAsHtml }}
          />
        ) : (
          <p className="text-muted-foreground text-xs italic">
            Body non stocké localement.
            {m.snippet ? ` Aperçu : « ${m.snippet} »` : ""}
          </p>
        )}

        {parsed.quotes.length > 0 ? (
          <details className="group rounded-md border bg-muted/30">
            <summary className="cursor-pointer select-none px-3 py-2 text-[11px] text-muted-foreground hover:bg-muted/50">
              <span className="mr-1 inline-block transition-transform group-open:rotate-90">›</span>
              Historique du fil ({parsed.quotes.length} bloc{parsed.quotes.length > 1 ? "s" : ""})
            </summary>
            <div className="space-y-3 border-t px-3 py-2">
              {parsed.quotes.map((q, i) => (
                <div
                  key={`${m.id}-quote-${i}`}
                  className="border-muted-foreground/30 border-l-2 pl-3"
                >
                  {q.header ? (
                    <p className="mb-1 font-medium text-[11px] text-muted-foreground">{q.header}</p>
                  ) : null}
                  <pre className="whitespace-pre-wrap break-words font-sans text-[12px] text-foreground/80">
                    {q.body}
                  </pre>
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </article>
  );
}
