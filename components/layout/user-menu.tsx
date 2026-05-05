"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { signOut } from "@/lib/actions/auth";
import type { User } from "@supabase/supabase-js";
import { LogOut, Plug, Settings, Users as UsersIcon } from "lucide-react";
import Link from "next/link";

function initialsFromEmail(email: string | undefined): string {
  if (!email) return "?";
  const local = email.split("@")[0] ?? "";
  return local.slice(0, 2).toUpperCase();
}

export function UserMenu({
  user,
  avatarUrl,
  isAdmin,
}: {
  user: User;
  avatarUrl?: string | null;
  isAdmin?: boolean;
}) {
  const initials = initialsFromEmail(user.email);
  const resolvedAvatar = avatarUrl ?? (user.user_metadata?.avatar_url as string | undefined);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded-full outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring">
        <Avatar className="size-8">
          {resolvedAvatar ? <AvatarImage src={resolvedAvatar} alt="" /> : null}
          <AvatarFallback className="text-xs">{initials}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate font-normal text-muted-foreground text-xs">
          {user.email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings/profile" className="flex items-center gap-2">
            <Settings className="size-4" />
            Profil
          </Link>
        </DropdownMenuItem>
        {isAdmin ? (
          <>
            <DropdownMenuItem asChild>
              <Link href="/settings/utilisateurs" className="flex items-center gap-2">
                <UsersIcon className="size-4" />
                Utilisateurs
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/settings/integrations" className="flex items-center gap-2">
                <Plug className="size-4" />
                Intégrations
              </Link>
            </DropdownMenuItem>
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <form action={signOut}>
            <button type="submit" className="flex w-full items-center gap-2 text-left">
              <LogOut className="size-4" />
              Se déconnecter
            </button>
          </form>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
