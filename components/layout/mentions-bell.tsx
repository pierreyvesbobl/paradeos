"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { markAllMyMentionsRead } from "@/lib/actions/notes";
import { Bell } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

const SUBJECT_PATH: Record<string, (id: string) => string> = {
  entity: (id) => `/entites/${id}`,
  contact: (id) => `/contacts/${id}`,
  opportunity: (id) => `/opportunites/${id}`,
  project: (id) => `/projets/${id}`,
  task: (id) => `/taches/${id}`,
};

type MentionItem = {
  mentionId: string;
  readAt: Date | null;
  noteId: string;
  noteTitle: string | null;
  authorName: string | null;
  subjectType: string | null;
  subjectId: string | null;
};

export function MentionsBell({
  unreadCount,
  recent,
}: {
  unreadCount: number;
  recent: MentionItem[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onMarkAllRead() {
    startTransition(async () => {
      await markAllMyMentionsRead({});
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="size-4" />
          {unreadCount > 0 ? (
            <span className="-right-0.5 -top-0.5 absolute inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 font-semibold text-[10px] text-destructive-foreground">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          ) : null}
          <span className="sr-only">Mentions</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <div className="flex items-center justify-between px-2 py-1.5">
          <DropdownMenuLabel className="p-0 text-sm">Mentions</DropdownMenuLabel>
          {unreadCount > 0 ? (
            <button
              type="button"
              onClick={onMarkAllRead}
              disabled={pending}
              className="text-muted-foreground text-xs hover:underline"
            >
              Tout marquer lu
            </button>
          ) : null}
        </div>
        <DropdownMenuSeparator />
        {recent.length === 0 ? (
          <p className="px-3 py-4 text-center text-muted-foreground text-xs">Aucune mention.</p>
        ) : (
          recent.map((m) => {
            const href =
              m.subjectType && m.subjectId
                ? (SUBJECT_PATH[m.subjectType]?.(m.subjectId) ?? "/notes")
                : "/notes";
            const isUnread = m.readAt === null;
            return (
              <DropdownMenuItem key={m.mentionId} asChild>
                <Link
                  href={href}
                  className={`flex items-start gap-2 ${isUnread ? "font-medium" : ""}`}
                >
                  {isUnread ? (
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                  ) : (
                    <span className="mt-1.5 size-1.5 shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs">
                      <span className="text-muted-foreground">{m.authorName ?? "Quelqu'un"}</span>{" "}
                      t'a mentionné
                    </p>
                    {m.noteTitle ? (
                      <p className="truncate text-muted-foreground text-xs">{m.noteTitle}</p>
                    ) : null}
                  </div>
                </Link>
              </DropdownMenuItem>
            );
          })
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/notes" className="text-muted-foreground text-xs">
            Voir toutes les notes →
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
