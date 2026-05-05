import { users } from "@/db/schema/users";
import { getRecentMentions, getUnreadMentionCount } from "@/lib/db/queries/mentions";
import { db } from "@/lib/db/server";
import type { User } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { CommandPalette } from "./command-palette";
import { MentionsBell } from "./mentions-bell";
import { UserMenu } from "./user-menu";

export async function Topbar({ user }: { user: User }) {
  const conn = await db();
  const [unread, recent, [profile]] = await Promise.all([
    getUnreadMentionCount(user.id),
    getRecentMentions(user.id, 10),
    conn
      .select({ avatarUrl: users.avatarUrl, role: users.role })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1),
  ]);

  return (
    <header className="flex h-14 items-center gap-4 border-b bg-background/80 px-4 backdrop-blur">
      <CommandPalette />
      <div className="ml-auto flex items-center gap-1">
        <MentionsBell
          unreadCount={unread}
          recent={recent.map((m) => ({
            mentionId: m.mentionId,
            readAt: m.readAt,
            noteId: m.noteId,
            noteTitle: m.noteTitle,
            authorName: m.authorName,
            subjectType: m.subjectType,
            subjectId: m.subjectId,
          }))}
        />
        <UserMenu
          user={user}
          avatarUrl={profile?.avatarUrl ?? null}
          isAdmin={profile?.role === "admin"}
        />
      </div>
    </header>
  );
}
