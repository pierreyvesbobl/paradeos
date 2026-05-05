import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { users } from "@/db/schema/users";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db/server";
import { getUserEmails } from "@/lib/email/users";
import { userRoleLabels } from "@/lib/schemas/users";
import { asc } from "drizzle-orm";
import { redirect } from "next/navigation";
import { InviteForm } from "./invite-form";
import { UserRowActions } from "./user-row-actions";

function initialsFromName(name: string | null, email: string | null): string {
  if (name?.trim()) {
    const parts = name.trim().split(/\s+/);
    const first = parts[0]?.[0] ?? "";
    const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
    return (first + last).toUpperCase() || "?";
  }
  return email ? email.slice(0, 2).toUpperCase() : "?";
}

export default async function UsersSettingsPage() {
  const authUser = await requireUser();
  const conn = await db();

  const rows = await conn
    .select({
      id: users.id,
      fullName: users.fullName,
      avatarUrl: users.avatarUrl,
      role: users.role,
      costRateHourly: users.costRateHourly,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(asc(users.fullName));

  const me = rows.find((r) => r.id === authUser.id);
  if (me?.role !== "admin") redirect("/settings/profile");

  const emails = await getUserEmails(rows.map((r) => r.id));

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="space-y-1">
        <p className="text-muted-foreground text-sm">Paramètres</p>
        <h1 className="font-semibold text-2xl tracking-tight">Utilisateurs</h1>
        <p className="text-muted-foreground text-sm">
          Invite des membres, ajuste les rôles et les taux de coût horaire. L'invitation envoie un
          magic link de connexion (valable 1 h).
        </p>
      </div>

      <InviteForm />

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Membre</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Rôle</TableHead>
              <TableHead className="text-right">Taux €/h</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Avatar className="size-7">
                      {u.avatarUrl ? <AvatarImage src={u.avatarUrl} alt="" /> : null}
                      <AvatarFallback className="text-xs">
                        {initialsFromName(u.fullName, emails[u.id] ?? null)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="font-medium text-sm">{u.fullName ?? "(sans nom)"}</span>
                    {u.id === authUser.id ? (
                      <span className="text-muted-foreground text-xs">(toi)</span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {emails[u.id] ?? "—"}
                </TableCell>
                <TableCell className="text-sm">{userRoleLabels[u.role]}</TableCell>
                <TableCell className="text-right text-sm tabular-nums">
                  {u.costRateHourly ?? "—"}
                </TableCell>
                <TableCell>
                  <UserRowActions
                    user={{
                      id: u.id,
                      fullName: u.fullName ?? "",
                      role: u.role,
                      costRateHourly: u.costRateHourly ?? "",
                    }}
                    isSelf={u.id === authUser.id}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
