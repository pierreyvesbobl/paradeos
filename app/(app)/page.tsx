import { Plus } from "@phosphor-icons/react/dist/ssr";
import { eq } from "drizzle-orm";
import { Suspense } from "react";
import Link from "@/components/link";
import { users } from "@/db/schema/users";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db/server";
import { AgendaSection, AgendaSectionHeader } from "./_dashboard/agenda-section";
import { FollowupsSection, FollowupsSectionHeader } from "./_dashboard/followups-section";
import {
  InvoiceRemindersSection,
  InvoiceRemindersSectionHeader,
} from "./_dashboard/invoice-reminders-section";
import { KpiStrip } from "./_dashboard/kpi-strip";
import { ProjectsSection, ProjectsSectionHeader } from "./_dashboard/projects-section";
import {
  CardsSkeleton,
  capitalize,
  dayLabelFmt,
  KpiSkeleton,
  ListSkeleton,
  TasksSkeleton,
} from "./_dashboard/shared";
import { TasksSection } from "./_dashboard/tasks-section";

/**
 * Le dashboard est découpé en sections indépendantes, chacune derrière son
 * propre `Suspense` : la page part au navigateur dès que le greeting est
 * prêt (une seule requête), et chaque bloc arrive quand ses propres
 * requêtes répondent. Avant, les seize requêtes étaient attendues en deux
 * vagues séquentielles avant d'envoyer le moindre octet — la plus lente
 * retardait tout le reste.
 */
export default async function DashboardPage() {
  const authUser = await requireUser();
  const conn = await db();

  // profil (prénom pour le greeting)
  const [profile] = await conn
    .select({ fullName: users.fullName })
    .from(users)
    .where(eq(users.id, authUser.id))
    .limit(1);

  const firstName =
    profile?.fullName?.trim().split(/\s+/)[0] ?? authUser.email?.split("@")[0] ?? "toi";
  const todayLabel = capitalize(dayLabelFmt.format(new Date()));

  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-6">
      {/* greeting */}
      <div className="flex items-end gap-4">
        <div>
          <div className="font-semibold text-[11px] text-ds-text-tertiary uppercase tracking-[0.12em]">
            {todayLabel}
          </div>
          <h1 className="mt-2 whitespace-nowrap font-brand font-semibold text-[30px] text-ds-text leading-tight">
            Bonjour {firstName}.
          </h1>
        </div>
        <span className="flex-1" />
        <Link
          href="/taches/nouveau"
          className="inline-flex items-center gap-2 rounded-lg bg-primary-500 px-3.5 py-2.5 font-medium text-sm text-white transition-colors hover:bg-primary-700"
        >
          <Plus weight="bold" className="size-3.5" />
          Nouvelle tâche
        </Link>
      </div>

      {/* metrics strip */}
      <Suspense fallback={<KpiSkeleton />}>
        <KpiStrip />
      </Suspense>

      {/* two-column body */}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        {/* LEFT: tasks */}
        <Suspense fallback={<TasksSkeleton />}>
          <TasksSection />
        </Suspense>

        {/* RIGHT: projects + agenda + relances */}
        <div className="flex flex-col gap-6">
          <Suspense
            fallback={
              <section>
                <ProjectsSectionHeader />
                <CardsSkeleton count={3} />
              </section>
            }
          >
            <ProjectsSection />
          </Suspense>

          <Suspense
            fallback={
              <section>
                <AgendaSectionHeader />
                <ListSkeleton rows={2} />
              </section>
            }
          >
            <AgendaSection />
          </Suspense>

          <Suspense
            fallback={
              <section>
                <InvoiceRemindersSectionHeader />
                <ListSkeleton rows={2} />
              </section>
            }
          >
            <InvoiceRemindersSection />
          </Suspense>

          <Suspense
            fallback={
              <section>
                <FollowupsSectionHeader />
                <ListSkeleton rows={2} />
              </section>
            }
          >
            <FollowupsSection />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
