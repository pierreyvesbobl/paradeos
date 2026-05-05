import { eq } from "drizzle-orm";
import { users } from "@/db/schema/users";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db/server";
import { AvatarUploader } from "./avatar-uploader";
import { PasswordForm } from "./password-form";
import { ProfileForm } from "./profile-form";

function initialsFromName(name: string | null, email: string | null | undefined): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    const first = parts[0]?.[0] ?? "";
    const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
    return (first + last).toUpperCase() || "?";
  }
  return email ? email.slice(0, 2).toUpperCase() : "?";
}

export default async function ProfileSettingsPage() {
  const authUser = await requireUser();
  const conn = await db();
  const [profile] = await conn
    .select({
      id: users.id,
      fullName: users.fullName,
      avatarUrl: users.avatarUrl,
      role: users.role,
      costRateHourly: users.costRateHourly,
    })
    .from(users)
    .where(eq(users.id, authUser.id))
    .limit(1);

  return (
    <div className="mx-auto max-w-xl space-y-8">
      <div className="space-y-1">
        <p className="text-muted-foreground text-sm">Paramètres</p>
        <h1 className="font-semibold text-2xl tracking-tight">Profil</h1>
      </div>

      <div className="space-y-6 rounded-lg border bg-card p-6">
        <AvatarUploader
          avatarUrl={profile?.avatarUrl ?? null}
          initials={initialsFromName(profile?.fullName ?? null, authUser.email)}
        />
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs uppercase tracking-wide">E-mail</p>
          <p className="text-sm">{authUser.email}</p>
        </div>
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs uppercase tracking-wide">Rôle</p>
          <p className="text-sm capitalize">{profile?.role ?? "—"}</p>
        </div>
      </div>

      <ProfileForm
        defaultValues={{
          fullName: profile?.fullName ?? "",
          costRateHourly: profile?.costRateHourly ?? "",
        }}
      />

      <PasswordForm />
    </div>
  );
}
