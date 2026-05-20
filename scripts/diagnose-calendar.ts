import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL manquant.");
  const sql = postgres(dbUrl, { prepare: false, max: 1, onnotice: () => {} });

  const accounts = await sql`
    select ga.id, ga.user_id, ga.email, ga.expires_at, ga.revoked_at,
           ga.access_token_enc is not null as has_access,
           ga.refresh_token_enc is not null as has_refresh, ga.updated_at
    from public.google_accounts ga
  `;
  console.info("Google accounts :", accounts.length);
  for (const a of accounts) console.info("  ", a);

  const calendars = await sql`
    select gc.id, gc.calendar_id, gc.summary, gc.sync_enabled, gc.last_synced_at,
           ga.email as account_email
    from public.google_calendars gc
    join public.google_accounts ga on ga.id = gc.google_account_id
    order by gc.last_synced_at desc nulls last
  `;
  console.info("\nCalendars :", calendars.length);
  for (const c of calendars) console.info("  ", c);

  const counts = await sql`
    select gc.summary, count(*) as n,
           min(ce.start_at) as min_start, max(ce.start_at) as max_start,
           max(ce.fetched_at) as last_fetch
    from public.calendar_events ce
    join public.google_calendars gc on gc.id = ce.google_calendar_id
    group by gc.summary
    order by n desc
  `;
  console.info("\nEvents par calendrier :");
  for (const c of counts) console.info("  ", c);

  const recentEvents = await sql`
    select ce.summary, ce.start_at, ce.end_at, ce.fetched_at, gc.summary as cal
    from public.calendar_events ce
    join public.google_calendars gc on gc.id = ce.google_calendar_id
    where ce.start_at >= now() - interval '14 days'
      and ce.start_at <= now() + interval '14 days'
    order by ce.start_at
    limit 20
  `;
  console.info("\nEvents proches (J-14 → J+14) :", recentEvents.length);
  for (const e of recentEvents) console.info("  ", e.start_at, "·", e.cal, "·", e.summary);

  await sql.end({ timeout: 5 });
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
