/**
 * Profile les requêtes individuelles de la fiche projet pour identifier
 * laquelle est lente. Imprime le temps de chaque awaitable.
 *
 * Usage : pnpm exec tsx scripts/profile-project-page.ts <projectId>
 */
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

async function main() {
  const projectId = process.argv[2];
  if (!projectId) {
    console.error("Usage : tsx scripts/profile-project-page.ts <projectId>");
    process.exit(1);
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL manquant.");
  const sql = postgres(dbUrl, { prepare: false, max: 1, onnotice: () => {} });

  async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const t = Date.now();
    const r = await fn();
    const d = Date.now() - t;
    const flag = d > 200 ? "⚠️ " : "  ";
    console.info(`${flag}${label.padEnd(40)} ${d.toString().padStart(5)} ms`);
    return r;
  }

  console.info(`Profiling project ${projectId.slice(0, 8)} :\n`);

  await timed("ROW base (projects + entity + owner)", async () => {
    return sql`
      select p.*, e.name as entity_name, u.full_name as owner_name
      from public.projects p
      left join public.entities e on e.id = p.entity_id
      left join public.users u on u.id = p.owner_id
      where p.id = ${projectId}
      limit 1
    `;
  });

  await timed("Quote invoice", async () => {
    return sql`
      select * from public.invoices
      where project_id = ${projectId} and kind = 'quote'
      limit 1
    `;
  });

  await timed("Milestones", async () => {
    return sql`
      select * from public.invoices
      where project_id = ${projectId} and kind = 'milestone'
      order by created_at asc
    `;
  });

  await timed("Entity list (all)", async () => {
    return sql`select id, name from public.entities order by name`;
  });

  await timed("Time stats", async () => {
    return sql`
      select kind, sum(extract(epoch from (end_at - start_at)) / 60)::int as minutes
      from public.time_entries
      where project_id = ${projectId} and end_at is not null
      group by kind
    `;
  });

  await timed("Profitability (time_entries scan)", async () => {
    return sql`
      select kind, count(*) as n
      from public.time_entries
      where project_id = ${projectId}
      group by kind
    `;
  });

  await timed("Notes for subject", async () => {
    return sql`
      select * from public.notes
      where subject_type = 'project' and subject_id = ${projectId}
      order by occurred_at desc
    `;
  });

  await timed("Project tasks (with assignee)", async () => {
    return sql`
      select t.*, u.full_name as assignee_name, u.avatar_url as assignee_avatar
      from public.tasks t
      left join public.users u on u.id = t.assignee_id
      where t.project_id = ${projectId}
      order by t.due_date asc nulls last, t.title asc
    `;
  });

  await timed("User options (all)", async () => {
    return sql`select id, full_name, avatar_url from public.users order by full_name`;
  });

  await timed("Contact options (all)", async () => {
    return sql`select id, first_name, last_name, email from public.contacts
      order by last_name asc, first_name asc`;
  });

  await timed("Project members", async () => {
    return sql`
      select pm.*, u.full_name, u.avatar_url
      from public.project_members pm
      join public.users u on u.id = pm.user_id
      where pm.project_id = ${projectId}
    `;
  });

  await timed("Project contacts", async () => {
    return sql`
      select pc.*, c.first_name, c.last_name, c.email
      from public.project_contacts pc
      join public.contacts c on c.id = pc.contact_id
      where pc.project_id = ${projectId}
    `;
  });

  await sql.end({ timeout: 5 });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
