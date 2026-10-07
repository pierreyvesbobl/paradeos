import { Receipt } from "@phosphor-icons/react/dist/ssr";
import { and, asc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import Link from "@/components/link";
import { coworkingContracts } from "@/db/schema/coworking";
import { entities } from "@/db/schema/entities";
import { invoices } from "@/db/schema/invoices";
import { projects } from "@/db/schema/projects";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db/server";
import { EntityName, ProjectName } from "@/lib/demo/components";
import { projectTint, SectionHeader, shortDateFmt } from "./shared";

const RELANCES_HREF = "/compta?tab=relances&assignee=me";

export function InvoiceRemindersSectionHeader({ showLink = false }: { showLink?: boolean }) {
  return (
    <SectionHeader
      icon={<Receipt weight="duotone" className="size-4.5 text-tint-mauve-dot" />}
      title="Mes factures à relancer"
      right={
        showLink ? (
          <Link href={RELANCES_HREF} className="text-primary-700 text-sm hover:underline">
            Tout voir
          </Link>
        ) : null
      }
    />
  );
}

/**
 * Mes factures à relancer (top 5 plus en retard). Miroir visuel du widget
 * « Relances cette semaine ».
 */
export async function InvoiceRemindersSection() {
  const authUser = await requireUser();
  const conn = await db();

  const myRelances = await conn
    .select({
      id: invoices.id,
      label: invoices.label,
      amountHt: invoices.amountHt,
      dueDate: invoices.dueDate,
      invoicedAt: invoices.invoicedAt,
      reminderCount: invoices.reminderCount,
      projectId: invoices.projectId,
      projectName: projects.name,
      projectColor: projects.color,
      entityId: entities.id,
      entityName: entities.name,
      contractName: coworkingContracts.name,
      kind: invoices.kind,
    })
    .from(invoices)
    .leftJoin(projects, eq(projects.id, invoices.projectId))
    .leftJoin(entities, eq(entities.id, projects.entityId))
    .leftJoin(coworkingContracts, eq(coworkingContracts.id, invoices.coworkingContractId))
    .where(
      and(
        eq(invoices.status, "sent"),
        eq(invoices.assignedTo, authUser.id),
        inArray(invoices.kind, ["milestone", "coworking", "one_off"]),
        or(ne(invoices.billedBy, "g_and_o"), isNull(invoices.billedBy)),
        sql`${invoices.dueDate} is not null and ${invoices.dueDate} <= current_date`,
      ),
    )
    .orderBy(asc(invoices.dueDate))
    .limit(5);

  return (
    <section>
      <InvoiceRemindersSectionHeader showLink={myRelances.length > 0} />
      <div className="overflow-hidden rounded-[10px] border border-ds-border">
        {myRelances.length === 0 ? (
          <div className="bg-ds-app px-3.5 py-4 text-ds-text-tertiary text-sm">
            Aucune facture en retard.
          </div>
        ) : (
          myRelances.map((r, i) => {
            const due = r.dueDate ? new Date(r.dueDate) : null;
            const overdueDays = due
              ? Math.max(0, Math.round((Date.now() - due.getTime()) / 86_400_000))
              : null;
            const target =
              r.kind === "coworking"
                ? RELANCES_HREF
                : r.projectId
                  ? `/projets/${r.projectId}?tab=billing`
                  : RELANCES_HREF;
            const title = r.projectName ?? r.contractName ?? r.label;
            const subParts: string[] = [];
            if (overdueDays !== null && overdueDays > 0) {
              subParts.push(`${overdueDays} j de retard`);
            }
            if (r.reminderCount > 0) subParts.push(`relancée ${r.reminderCount}×`);
            return (
              <Link
                href={target}
                key={r.id}
                className={`flex items-center gap-2.5 bg-ds-app px-3.5 py-3 transition-colors hover:bg-ds-hover ${i < myRelances.length - 1 ? "border-ds-border border-b" : ""}`}
              >
                <span
                  className="size-[9px] flex-none rounded-full"
                  style={{
                    background: r.projectId
                      ? projectTint({ id: r.projectId, color: r.projectColor ?? null })
                      : "var(--ds-tint-mauve-dot)",
                  }}
                />
                <div className="min-w-0 flex-1">
                  {r.projectId ? (
                    <ProjectName
                      project={{ id: r.projectId, name: title }}
                      className="block truncate text-ds-text text-sm"
                    />
                  ) : (
                    <span className="block truncate text-ds-text text-sm">{title}</span>
                  )}
                  <div className="truncate text-ds-text-tertiary text-xs">
                    {r.entityId ? (
                      <EntityName entity={{ id: r.entityId, name: r.entityName }} />
                    ) : (
                      r.label
                    )}
                    {subParts.length > 0 ? ` · ${subParts.join(" · ")}` : ""}
                  </div>
                </div>
                <span className="font-medium text-ds-text-tertiary text-xs">
                  {due ? shortDateFmt.format(due) : ""}
                </span>
              </Link>
            );
          })
        )}
      </div>
    </section>
  );
}
