import { entities } from "@/db/schema/entities";
import { opportunities } from "@/db/schema/opportunities";
import { projects } from "@/db/schema/projects";
import { tasks } from "@/db/schema/tasks";
import { users } from "@/db/schema/users";
import { getAppUrl } from "@/lib/app-url";
import { db } from "@/lib/db/server";
import { sendEmail } from "@/lib/email/client";
import { renderDailyDigestEmail } from "@/lib/email/templates";
import { getUserEmails } from "@/lib/email/users";
import { and, asc, eq, gte, isNotNull, lt, ne, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

/**
 * Digest quotidien — 1 e-mail par user contenant :
 *   - opportunités à relancer aujourd'hui ou dans les 3 prochains jours
 *     dont il est l'owner (ou tous les actifs si pas d'owner précis ?)
 *   - tâches en retard qui lui sont assignées
 *
 * Auth : header `Authorization: Bearer <CRON_SECRET>`. Vercel Cron pose
 * automatiquement ce header si CRON_SECRET est défini en env. En dev,
 * tu peux l'invoquer à la main avec curl.
 */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const appUrl = await getAppUrl();
  const conn = await db();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = today.toISOString().slice(0, 10);

  const inThreeDays = new Date(today);
  inThreeDays.setDate(inThreeDays.getDate() + 3);
  const horizonIso = inThreeDays.toISOString().slice(0, 10);

  // 1) Liste tous les users actifs.
  const allUsers = await conn
    .select({ id: users.id, fullName: users.fullName })
    .from(users)
    .where(ne(users.role, "viewer"));

  if (allUsers.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, skipped: 0 });
  }

  const emails = await getUserEmails(allUsers.map((u) => u.id));

  // 2) Pour chaque user, agrège relances et tâches en retard.
  let sent = 0;
  let skipped = 0;

  for (const user of allUsers) {
    const email = emails[user.id];
    if (!email) {
      skipped++;
      continue;
    }

    // Relances dans les 3 prochains jours, opportunités dont user est owner.
    const followUps = await conn
      .select({
        id: opportunities.id,
        title: opportunities.title,
        followUpDate: opportunities.followUpDate,
        entityName: entities.name,
      })
      .from(opportunities)
      .leftJoin(entities, eq(opportunities.entityId, entities.id))
      .where(
        and(
          eq(opportunities.ownerId, user.id),
          isNotNull(opportunities.followUpDate),
          gte(opportunities.followUpDate, todayIso),
          lt(opportunities.followUpDate, horizonIso),
          sql`${opportunities.status} not in ('won', 'lost')`,
        ),
      )
      .orderBy(asc(opportunities.followUpDate));

    // Tâches en retard.
    const overdue = await conn
      .select({
        id: tasks.id,
        title: tasks.title,
        dueDate: tasks.dueDate,
        projectName: projects.name,
      })
      .from(tasks)
      .leftJoin(projects, eq(tasks.projectId, projects.id))
      .where(
        and(
          eq(tasks.assigneeId, user.id),
          isNotNull(tasks.dueDate),
          lt(tasks.dueDate, todayIso),
          sql`${tasks.status} not in ('done', 'cancelled')`,
        ),
      )
      .orderBy(asc(tasks.dueDate));

    if (followUps.length === 0 && overdue.length === 0) {
      skipped++;
      continue;
    }

    const tpl = renderDailyDigestEmail({
      appUrl,
      recipientName: user.fullName?.split(/\s+/)[0] ?? "toi",
      followUps: followUps.map((f) => ({
        title: f.title,
        entityName: f.entityName,
        followUpDate: f.followUpDate ?? "",
        href: `${appUrl}/opportunites/${f.id}`,
      })),
      overdueTasks: overdue.map((t) => ({
        title: t.title,
        projectName: t.projectName,
        dueDate: t.dueDate ?? "",
        href: `${appUrl}/taches/${t.id}`,
      })),
    });

    const result = await sendEmail({
      to: email,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      tags: [{ name: "type", value: "daily-digest" }],
    });

    if (result.ok) sent++;
    else skipped++;
  }

  return NextResponse.json({ ok: true, sent, skipped });
}
