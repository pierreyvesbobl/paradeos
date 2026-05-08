import { getCalendarsForUser } from "@/lib/db/queries/calendar";
import { formatDate } from "@/lib/format";
import { getGoogleAccount } from "@/lib/google/account";
import { hasRequiredCalendarScopes } from "@/lib/google/oauth";
import Link from "next/link";
import { CalendarsList } from "./calendars-list";

/**
 * Section UI pour le pull Google Calendar → /planning. L'user choisit
 * lesquels de ses calendriers Google s'affichent dans le planning de
 * Paradeos.
 *
 * Affichage en lecture seule des events (pas d'écriture vers Google
 * Calendar en v1).
 */
export async function GoogleCalendarSection({ userId }: { userId: string }) {
  const account = await getGoogleAccount(userId);

  if (!account) {
    return (
      <section className="rounded-lg border bg-card p-6">
        <Header connected={false} scopesOk={true} />
        <p className="text-muted-foreground text-xs">
          <Link href="#google-drive" className="underline">
            Connecte Google Drive
          </Link>{" "}
          d'abord — la même connexion donne accès à Calendar.
        </p>
      </section>
    );
  }

  const scopesOk = hasRequiredCalendarScopes(account.scopes);

  if (!scopesOk) {
    return (
      <section className="rounded-lg border bg-card p-6">
        <Header connected={true} scopesOk={false} />
        <div className="space-y-3">
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 text-xs dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            <p className="font-medium">Scope Calendar manquant</p>
            <p className="mt-1">
              Ton compte Google n'a pas accordé l'accès en lecture aux calendriers. Reconnecte pour
              ajouter <code>calendar.readonly</code>.
            </p>
          </div>
          <a
            href="/api/google/oauth/start"
            className="inline-flex items-center rounded-md bg-foreground px-3 py-1.5 text-background text-sm hover:opacity-90"
          >
            Reconnecter
          </a>
        </div>
      </section>
    );
  }

  const calendars = await getCalendarsForUser(userId);

  return (
    <section className="rounded-lg border bg-card p-6">
      <Header connected={true} scopesOk={true} />
      <CalendarsList
        calendars={calendars.map((c) => ({
          id: c.id,
          calendarId: c.calendarId,
          summary: c.summary,
          isPrimary: c.isPrimary,
          backgroundColor: c.backgroundColor,
          syncEnabled: c.syncEnabled,
          lastSyncedAt: c.lastSyncedAt ? formatDate(c.lastSyncedAt.toISOString()) : null,
        }))}
      />
    </section>
  );
}

function Header({ connected, scopesOk }: { connected: boolean; scopesOk: boolean }) {
  let badge: { label: string; tone: "ok" | "warn" };
  if (!connected) badge = { label: "Compte Google requis", tone: "warn" };
  else if (!scopesOk) badge = { label: "Scope manquant", tone: "warn" };
  else badge = { label: "Activé", tone: "ok" };

  return (
    <header className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h2 className="font-medium text-sm">Google Calendar</h2>
        <p className="mt-1 text-muted-foreground text-xs">
          Affiche tes events Google dans le planning de Paradeos. Lecture seule en v1 — refresh auto
          toutes les 15 min.
        </p>
      </div>
      <span
        className={
          badge.tone === "ok"
            ? "rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-emerald-700 text-xs dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
            : "rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-amber-700 text-xs dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
        }
      >
        {badge.label}
      </span>
    </header>
  );
}
