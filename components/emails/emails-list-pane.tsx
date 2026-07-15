import { formatDate } from "@/lib/format";
import {
  Briefcase,
  MagnifyingGlass,
  Receipt,
  Sparkle,
  SpeakerSimpleSlash,
  Tag,
  Tray,
} from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";

export type EmailListRow = {
  id: string;
  subject: string | null;
  snippet: string | null;
  hasUnread: boolean;
  messageCount: number;
  lastMessageAt: Date | null;
  participants: unknown;
};

export type Bucket = "important" | "invoices" | "noise" | "all";

const BUCKET_META: Record<Bucket, { label: string; icon: typeof Sparkle; description: string }> = {
  important: { label: "À traiter", icon: Sparkle, description: "" },
  all: { label: "Tous", icon: Tray, description: "" },
  invoices: { label: "Facturation", icon: Receipt, description: "" },
  noise: { label: "Bruits", icon: SpeakerSimpleSlash, description: "" },
};

const BUCKET_ORDER: Bucket[] = ["important", "all", "invoices", "noise"];

type BucketCounts = { important: number; invoices: number; noise: number; total: number };

type Props = {
  threads: EmailListRow[];
  counts: BucketCounts;
  activeBucket: Bucket;
  activeThreadId: string | null;
  projectsByThread: Map<string, Array<{ id: string; name: string }>>;
  query: string;
};

function participantsPreview(raw: unknown): string {
  const arr = Array.isArray(raw) ? (raw as Array<{ email: string; name?: string }>) : [];
  return arr
    .slice(0, 3)
    .map((p) => (p.name || p.email).split(" ")[0])
    .join(", ");
}

function initialsFor(raw: unknown): Array<{ label: string; tint: string }> {
  const arr = Array.isArray(raw) ? (raw as Array<{ email: string; name?: string }>) : [];
  const tints = [
    "var(--ds-tint-mauve-bg)",
    "var(--ds-tint-blue-bg)",
    "var(--ds-tint-green-bg)",
    "var(--ds-tint-orange-bg)",
    "var(--ds-tint-pink-bg)",
  ] as const;
  return arr.slice(0, 3).map((p, i) => {
    const name = p.name || p.email;
    const label = name
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() ?? "")
      .join("");
    return { label: label || "?", tint: tints[i % tints.length] ?? tints[0] };
  });
}

function bucketHref(next: Bucket, q: string): string {
  const sp = new URLSearchParams();
  if (q) sp.set("q", q);
  if (next !== "important") sp.set("bucket", next);
  const qs = sp.toString();
  return `/emails${qs ? `?${qs}` : ""}`;
}

function threadHref(threadId: string, activeBucket: Bucket, q: string): string {
  const sp = new URLSearchParams();
  sp.set("thread", threadId);
  if (q) sp.set("q", q);
  if (activeBucket !== "important") sp.set("bucket", activeBucket);
  return `/emails?${sp.toString()}`;
}

export function EmailsListPane({
  threads,
  counts,
  activeBucket,
  activeThreadId,
  projectsByThread,
  query,
}: Props) {
  return (
    <aside
      className="flex w-[396px] shrink-0 flex-col overflow-hidden border-r"
      style={{ background: "var(--ds-bg-surface)", borderColor: "var(--ds-border)" }}
    >
      <header
        className="flex flex-col gap-3 border-b px-4 pt-4 pb-[13px]"
        style={{ borderColor: "var(--ds-border)" }}
      >
        <div className="flex items-center gap-2">
          <h1
            className="flex-1 font-semibold text-[20px]"
            style={{ fontFamily: "var(--font-brand)", color: "var(--ds-text)" }}
          >
            Emails
          </h1>
          <span
            className="inline-flex h-5 items-center rounded-full px-2 font-semibold text-[11px]"
            style={{
              background: "var(--ds-primary-50)",
              color: "var(--ds-primary-900)",
            }}
          >
            {counts.important}
          </span>
          <Link
            href="/emails/propositions"
            className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-[7px] border"
            style={{ borderColor: "var(--ds-border)", color: "var(--ds-primary-500)" }}
            aria-label="Propositions LLM"
          >
            <Sparkle size={16} weight="duotone" />
          </Link>
          <Link
            href="/emails/tags"
            className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-[7px] border"
            style={{ borderColor: "var(--ds-border)", color: "var(--ds-text-muted)" }}
            aria-label="Gérer les tags"
          >
            <Tag size={16} weight="duotone" />
          </Link>
        </div>

        <div className="flex flex-wrap gap-[6px]">
          {BUCKET_ORDER.map((b) => {
            const m = BUCKET_META[b];
            const Icon = m.icon;
            const count =
              b === "important"
                ? counts.important
                : b === "invoices"
                  ? counts.invoices
                  : b === "noise"
                    ? counts.noise
                    : counts.total;
            const isActive = activeBucket === b;
            return (
              <Link
                key={b}
                href={bucketHref(b, query)}
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium text-[12px]"
                style={
                  isActive
                    ? {
                        background: "var(--ds-primary-500)",
                        color: "#fff",
                      }
                    : {
                        background: "var(--ds-bg-app)",
                        color: "var(--ds-text-muted)",
                        boxShadow: "inset 0 0 0 1px var(--ds-border)",
                      }
                }
              >
                <Icon size={12} weight="duotone" />
                <span>{m.label}</span>
                <span
                  className="inline-flex h-[15px] min-w-[15px] items-center justify-center rounded-[4px] px-1 font-semibold text-[10px]"
                  style={
                    isActive
                      ? { background: "rgba(255,255,255,0.22)", color: "#fff" }
                      : { background: "var(--ds-bg-hover)", color: "var(--ds-text-muted)" }
                  }
                >
                  {count}
                </span>
              </Link>
            );
          })}
        </div>

        <form method="GET" action="/emails" className="relative">
          <MagnifyingGlass
            size={13}
            className="absolute top-[9px] left-2.5 text-[var(--ds-text-tertiary)]"
          />
          <input
            type="text"
            name="q"
            defaultValue={query}
            placeholder={`Filtrer dans « ${BUCKET_META[activeBucket].label} »…`}
            className="h-8 w-full rounded-lg pr-2.5 pl-7 text-[12px] placeholder:text-[var(--ds-text-tertiary)]"
            style={{
              background: "var(--ds-bg-app)",
              color: "var(--ds-text)",
              boxShadow: "inset 0 0 0 1px var(--ds-border)",
            }}
          />
          {activeBucket !== "important" ? (
            <input type="hidden" name="bucket" value={activeBucket} />
          ) : null}
        </form>
      </header>

      <ul className="flex-1 overflow-y-auto">
        {threads.length === 0 ? (
          <li className="px-4 py-10 text-center text-[12px] text-[var(--ds-text-tertiary)] italic">
            {query ? "Aucun résultat." : "Aucun mail."}
          </li>
        ) : null}
        {threads.map((t) => {
          const isActive = t.id === activeThreadId;
          const projects = projectsByThread.get(t.id) ?? [];
          const initials = initialsFor(t.participants);
          const preview = participantsPreview(t.participants);
          const accent = isActive
            ? "var(--ds-primary-500)"
            : t.hasUnread
              ? "var(--ds-primary-200)"
              : "transparent";
          return (
            <li
              key={t.id}
              className="relative border-b"
              style={{ borderColor: "var(--ds-border)" }}
            >
              <span
                className="absolute top-0 bottom-0 left-0 w-[3px]"
                style={{ background: accent }}
              />
              <Link
                href={threadHref(t.id, activeBucket, query)}
                className="block py-[13px] pr-4 pl-[19px] transition-colors"
                style={{
                  background: isActive ? "var(--ds-bg-hover)" : "transparent",
                }}
              >
                <div className="flex items-center gap-2">
                  {t.hasUnread ? (
                    <span
                      className="size-[7px] shrink-0 rounded-full"
                      style={{ background: "var(--ds-primary-500)" }}
                    />
                  ) : null}
                  <p
                    className="min-w-0 flex-1 truncate text-[13.5px] leading-[1.35]"
                    style={{
                      fontWeight: t.hasUnread ? 600 : 500,
                      color: "var(--ds-text)",
                    }}
                  >
                    {t.subject || "(sans objet)"}
                  </p>
                  <span
                    className="shrink-0 text-[11px]"
                    style={{ color: "var(--ds-text-tertiary)" }}
                  >
                    {t.lastMessageAt ? formatDate(t.lastMessageAt.toISOString()) : ""}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <div className="flex shrink-0">
                    {initials.map((av, i) => (
                      <span
                        key={`${av.label}-${i}`}
                        className="flex size-[19px] items-center justify-center rounded-full font-semibold text-[9px] ring-[1.5px]"
                        style={{
                          background: av.tint,
                          color: "var(--ds-text-muted)",
                          marginLeft: i === 0 ? 0 : "-5px",
                          ["--tw-ring-color" as string]: "var(--ds-bg-surface)",
                        }}
                      >
                        {av.label}
                      </span>
                    ))}
                  </div>
                  <p
                    className="min-w-0 flex-1 truncate text-[12px]"
                    style={{ color: "var(--ds-text-tertiary)" }}
                  >
                    <span style={{ color: "var(--ds-text-muted)", fontWeight: 500 }}>
                      {preview}
                    </span>
                    {t.snippet ? <span className="ml-1.5">— {t.snippet}</span> : null}
                  </p>
                </div>
                {projects.length > 0 || t.messageCount > 1 ? (
                  <div className="mt-1.5 flex items-center gap-1.5">
                    {projects.map((p) => (
                      <span
                        key={p.id}
                        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-[10.5px]"
                        style={{
                          background: "var(--ds-tint-mauve-bg)",
                          color: "var(--ds-tint-mauve-text)",
                        }}
                      >
                        <Briefcase size={10} weight="duotone" />
                        <span className="max-w-[180px] truncate">{p.name}</span>
                      </span>
                    ))}
                    <span className="flex-1" />
                    {t.messageCount > 1 ? (
                      <span
                        className="font-mono text-[10.5px]"
                        style={{ color: "var(--ds-text-tertiary)" }}
                      >
                        {t.messageCount} msgs
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
