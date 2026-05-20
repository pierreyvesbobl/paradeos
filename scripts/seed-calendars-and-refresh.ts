/**
 * One-shot autonome (sans imports server-only, donc utilisable via tsx) :
 * pour chaque google_account, fetch la liste des calendriers Google,
 * upsert dans google_calendars (active tout), puis refresh les events
 * de la fenêtre J-7 / J+30.
 *
 * Doublure de refreshCalendarList + refreshUserEvents — à n'utiliser
 * qu'en debug ou pour seeder un compte initial.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const ALGO = "aes-256-gcm";

function decryptSecret(blob: string, key: Buffer): string {
  const [version, ivPart, tagPart, encPart] = blob.split(":");
  if (version !== "v1" || !ivPart || !tagPart || !encPart) throw new Error("bad secret format");
  const iv = Buffer.from(ivPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  const enc = Buffer.from(encPart, "base64url");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${enc.toString("base64url")}`;
}

async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string;
  expires_in: number;
}> {
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!id || !secret) throw new Error("GOOGLE_OAUTH_CLIENT_ID/SECRET manquant.");
  const body = new URLSearchParams({
    client_id: id,
    client_secret: secret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Google refresh ${res.status}: ${await res.text()}`);
  return res.json();
}

async function fetchJson(url: string, accessToken: string): Promise<unknown> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Google API ${res.status}: ${await res.text()}`);
  return res.json();
}

type GoogleCalendarEntry = {
  id: string;
  summary?: string;
  summaryOverride?: string;
  description?: string;
  primary?: boolean;
  backgroundColor?: string;
  foregroundColor?: string;
};

type GoogleEvent = {
  id: string;
  iCalUID?: string;
  summary?: string;
  description?: string;
  location?: string;
  status?: string;
  htmlLink?: string;
  organizer?: { email?: string };
  attendees?: unknown;
  recurringEventId?: string;
  updated?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
};

function eventRange(e: GoogleEvent): { startAt: Date; endAt: Date; allDay: boolean } | null {
  if (e.start?.dateTime && e.end?.dateTime) {
    return { startAt: new Date(e.start.dateTime), endAt: new Date(e.end.dateTime), allDay: false };
  }
  if (e.start?.date && e.end?.date) {
    return {
      startAt: new Date(`${e.start.date}T00:00:00Z`),
      endAt: new Date(`${e.end.date}T00:00:00Z`),
      allDay: true,
    };
  }
  return null;
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  const encRaw = process.env.SECRETS_ENC_KEY;
  if (!dbUrl) throw new Error("DATABASE_URL manquant.");
  if (!encRaw) throw new Error("SECRETS_ENC_KEY manquant.");
  const encKey = Buffer.from(encRaw, "base64");
  const sql = postgres(dbUrl, { prepare: false, max: 1, onnotice: () => {} });

  const accounts = await sql<
    {
      id: string;
      user_id: string;
      email: string;
      access_token_enc: string;
      refresh_token_enc: string;
      expires_at: Date;
    }[]
  >`
    select id, user_id, email, access_token_enc, refresh_token_enc, expires_at
    from public.google_accounts
    where revoked_at is null
  `;
  console.info(`Comptes Google : ${accounts.length}`);

  for (const a of accounts) {
    console.info(`\n→ ${a.email} (user ${a.user_id.slice(0, 8)})`);

    // Refresh access token si expiré ou proche.
    let accessToken: string;
    if (a.expires_at.getTime() - Date.now() > 60_000) {
      accessToken = decryptSecret(a.access_token_enc, encKey);
      console.info("   token encore valide");
    } else {
      const refreshToken = decryptSecret(a.refresh_token_enc, encKey);
      const refreshed = await refreshAccessToken(refreshToken);
      accessToken = refreshed.access_token;
      const newExp = new Date(Date.now() + refreshed.expires_in * 1000);
      await sql`
        update public.google_accounts
        set access_token_enc = ${encryptSecret(accessToken, encKey)},
            expires_at = ${newExp},
            updated_at = now()
        where id = ${a.id}
      `;
      console.info("   token refresh OK, expire à", newExp.toISOString());
    }

    // Liste calendriers.
    const listRes = (await fetchJson(
      "https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=100",
      accessToken,
    )) as { items?: GoogleCalendarEntry[] };
    const items = listRes.items ?? [];
    console.info(`   ${items.length} calendrier(s) Google :`);

    const calIds: Record<string, string> = {}; // calendar_id Google → row id Paradeos
    for (const cal of items) {
      const summary = cal.summaryOverride ?? cal.summary ?? cal.id;
      console.info(`     - ${cal.primary ? "★ " : "  "}${summary}`);
      const rows = await sql<{ id: string }[]>`
        insert into public.google_calendars
          (google_account_id, calendar_id, summary, description, is_primary,
           background_color, foreground_color, sync_enabled)
        values
          (${a.id}, ${cal.id}, ${summary}, ${cal.description ?? null},
           ${cal.primary ?? false}, ${cal.backgroundColor ?? null},
           ${cal.foregroundColor ?? null}, true)
        on conflict (google_account_id, calendar_id) do update
        set summary = excluded.summary,
            description = excluded.description,
            is_primary = excluded.is_primary,
            background_color = excluded.background_color,
            foreground_color = excluded.foreground_color,
            sync_enabled = true,
            updated_at = now()
        returning id
      `;
      const rowId = rows[0]?.id;
      if (rowId) calIds[cal.id] = rowId;
    }

    // Fetch events sur la fenêtre J-7 / J+30.
    const timeMin = new Date(Date.now() - 7 * 86400_000);
    const timeMax = new Date(Date.now() + 30 * 86400_000);
    let totalEvents = 0;
    for (const [googleCalId, paradeosId] of Object.entries(calIds)) {
      // Delete events existants dans la fenêtre.
      await sql`
        delete from public.calendar_events
        where google_calendar_id = ${paradeosId}
          and start_at >= ${timeMin}
      `;

      const params = new URLSearchParams({
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "250",
      });
      const evRes = (await fetchJson(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(googleCalId)}/events?${params}`,
        accessToken,
      )) as { items?: GoogleEvent[] };
      const evs = evRes.items ?? [];

      for (const e of evs) {
        const range = eventRange(e);
        if (!range) continue;
        await sql`
          insert into public.calendar_events
            (google_calendar_id, google_event_id, ical_uid, summary, description,
             location, start_at, end_at, all_day, status, html_link, organizer_email,
             attendees, recurring_event_id, google_updated_at, fetched_at)
          values
            (${paradeosId}, ${e.id}, ${e.iCalUID ?? null}, ${e.summary ?? null},
             ${e.description ?? null}, ${e.location ?? null}, ${range.startAt},
             ${range.endAt}, ${range.allDay}, ${e.status ?? null}, ${e.htmlLink ?? null},
             ${e.organizer?.email ?? null}, ${sql.json(e.attendees ?? null)},
             ${e.recurringEventId ?? null},
             ${e.updated ? new Date(e.updated) : null}, now())
          on conflict (google_calendar_id, google_event_id) do nothing
        `;
        totalEvents++;
      }

      await sql`
        update public.google_calendars
        set last_synced_at = now()
        where id = ${paradeosId}
      `;
    }
    console.info(`   ${totalEvents} event(s) importé(s) sur la fenêtre J-7 → J+30.`);
  }

  await sql.end({ timeout: 5 });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
