import { HashedAvatar } from "@/components/user/hashed-avatar";
import type { ProjectKind } from "@/lib/schemas/projects";
import { cn } from "@/lib/utils";
import { Check, Crown, ListBullets, User, UserFocus } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";

export type Scope = "all" | "mine";
export type Role = "lead" | "member";
export type Nature = "opportunity" | "project";
export type State = "active" | "inactive";

type EntityGroup = {
  id: string;
  name: string;
  count: number;
};

type Props = {
  pathname: string;
  scope: Scope;
  roles: Role[];
  types: ProjectKind[];
  entities: string[];
  natures: Nature[];
  states: State[];
  totalCount: number;
  myCount: number;
  typeCounts: Record<ProjectKind, number>;
  natureCounts: Record<Nature, number>;
  stateCounts: Record<State, number>;
  entityGroups: EntityGroup[];
  preservedParams: Record<string, string>;
};

const TYPES: { key: ProjectKind; label: string }[] = [
  { key: "client", label: "Client" },
  { key: "product", label: "Produit" },
  { key: "transverse", label: "Transverse" },
];

const NATURES: { key: Nature; label: string }[] = [
  { key: "opportunity", label: "Opportunité" },
  { key: "project", label: "Projet" },
];

const STATES: { key: State; label: string }[] = [
  { key: "active", label: "Actif" },
  { key: "inactive", label: "Inactif" },
];

function buildParams(
  preserved: Record<string, string>,
  next: {
    scope?: Scope;
    roles?: Role[];
    types?: ProjectKind[];
    entities?: string[];
    natures?: Nature[];
    states?: State[];
  },
): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(preserved)) {
    if (v) sp.set(k, v);
  }
  if (next.scope && next.scope !== "all") sp.set("scope", next.scope);
  if (next.roles && next.roles.length > 0) sp.set("role", next.roles.join(","));
  if (next.types && next.types.length > 0) sp.set("type", next.types.join(","));
  if (next.entities && next.entities.length > 0) sp.set("entity", next.entities.join(","));
  if (next.natures && next.natures.length > 0) sp.set("nature", next.natures.join(","));
  if (next.states && next.states.length > 0) sp.set("state", next.states.join(","));
  return sp.toString();
}

function toggle<T extends string>(arr: T[], value: T): T[] {
  return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
}

export function FacetsPanel({
  pathname,
  scope,
  roles,
  types,
  entities,
  natures,
  states,
  totalCount,
  myCount,
  typeCounts,
  natureCounts,
  stateCounts,
  entityGroups,
  preservedParams,
}: Props) {
  function href(patch: Parameters<typeof buildParams>[1]): string {
    const currentState = { scope, roles, types, entities, natures, states };
    const merged = { ...currentState, ...patch };
    const qs = buildParams(preservedParams, merged);
    return qs ? `${pathname}?${qs}` : pathname;
  }

  return (
    <aside className="flex w-[224px] shrink-0 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <ScopeRow
          active={scope === "all"}
          href={href({ scope: "all", roles: [] })}
          icon={<ListBullets size={18} weight="duotone" />}
          label="Tous les projets"
          count={totalCount}
        />
        <ScopeRow
          active={scope === "mine"}
          href={href({ scope: "mine" })}
          icon={<UserFocus size={18} weight="duotone" />}
          label="Mes projets"
          count={myCount}
        />
      </div>

      {scope === "mine" ? (
        <FacetGroup title="Mon rôle">
          <RoleRow
            active={roles.includes("lead")}
            href={href({ roles: toggle(roles, "lead") })}
            icon={<Crown size={14} weight="duotone" />}
            label="Lead"
          />
          <RoleRow
            active={roles.includes("member")}
            href={href({ roles: toggle(roles, "member") })}
            icon={<User size={14} weight="duotone" />}
            label="Membre"
          />
        </FacetGroup>
      ) : null}

      <div className="h-px" style={{ background: "var(--ds-border)" }} />

      <FacetGroup title="Nature">
        {NATURES.map(({ key, label }) => (
          <CheckboxRow
            key={key}
            active={natures.includes(key)}
            href={href({ natures: toggle(natures, key) })}
            label={label}
            count={natureCounts[key]}
          />
        ))}
      </FacetGroup>

      <div className="h-px" style={{ background: "var(--ds-border)" }} />

      <FacetGroup title="État">
        {STATES.map(({ key, label }) => (
          <CheckboxRow
            key={key}
            active={states.includes(key)}
            href={href({ states: toggle(states, key) })}
            label={label}
            count={stateCounts[key]}
          />
        ))}
      </FacetGroup>

      <div className="h-px" style={{ background: "var(--ds-border)" }} />

      <FacetGroup title="Type">
        {TYPES.map(({ key, label }) => (
          <CheckboxRow
            key={key}
            active={types.includes(key)}
            href={href({ types: toggle(types, key) })}
            label={label}
            count={typeCounts[key]}
          />
        ))}
      </FacetGroup>

      {entityGroups.length > 0 ? (
        <>
          <div className="h-px" style={{ background: "var(--ds-border)" }} />
          <FacetGroup title="Entité">
            {entityGroups.map((g) => (
              <EntityRow
                key={g.id}
                active={entities.includes(g.id)}
                href={href({ entities: toggle(entities, g.id) })}
                name={g.name}
                count={g.count}
              />
            ))}
          </FacetGroup>
        </>
      ) : null}
    </aside>
  );
}

function ScopeRow({
  active,
  href,
  icon,
  label,
  count,
}: {
  active: boolean;
  href: string;
  icon: React.ReactNode;
  label: string;
  count: number;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors",
        active ? "" : "text-ds-text-muted hover:bg-ds-bg-hover",
      )}
      style={
        active
          ? { background: "var(--ds-primary-50)", color: "var(--ds-primary-900)" }
          : undefined
      }
    >
      <span style={{ color: active ? "var(--ds-primary-700)" : "var(--ds-text-tertiary)" }}>
        {icon}
      </span>
      <span className="flex-1 font-medium text-[14px]">{label}</span>
      <span
        className="text-[12px] tabular-nums"
        style={{ color: active ? "var(--ds-primary-700)" : "var(--ds-text-tertiary)" }}
      >
        {count}
      </span>
    </Link>
  );
}

function FacetGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="mb-0.5 text-[11px] font-semibold uppercase"
        style={{ color: "var(--ds-text-tertiary)", letterSpacing: "0.06em" }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function RoleRow({
  active,
  href,
  icon,
  label,
}: {
  active: boolean;
  href: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-ds-bg-hover",
        active ? "" : "text-ds-text-muted",
      )}
      style={
        active
          ? { background: "var(--ds-primary-50)", color: "var(--ds-primary-900)" }
          : undefined
      }
    >
      <CheckboxSquare checked={active} />
      <span className="flex-1 text-[13px]">{label}</span>
      <span style={{ color: active ? "var(--ds-primary-700)" : "var(--ds-text-tertiary)" }}>
        {icon}
      </span>
    </Link>
  );
}

function CheckboxRow({
  active,
  href,
  label,
  count,
}: {
  active: boolean;
  href: string;
  label: string;
  count: number;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-ds-bg-hover"
      style={
        active
          ? { background: "var(--ds-primary-50)", color: "var(--ds-primary-900)" }
          : { color: "var(--ds-text-muted)" }
      }
    >
      <CheckboxSquare checked={active} />
      <span className="flex-1 text-[13px]">{label}</span>
      <span
        className="text-[12px] tabular-nums"
        style={{ color: active ? "var(--ds-primary-700)" : "var(--ds-text-tertiary)" }}
      >
        {count}
      </span>
    </Link>
  );
}

function EntityRow({
  active,
  href,
  name,
  count,
}: {
  active: boolean;
  href: string;
  name: string;
  count: number;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-ds-bg-hover"
      style={
        active
          ? { background: "var(--ds-primary-50)", color: "var(--ds-primary-900)" }
          : { color: "var(--ds-text-muted)" }
      }
    >
      <HashedAvatar name={name} size="xs" />
      <span className="min-w-0 flex-1 truncate text-[13px]">{name}</span>
      <span
        className="text-[12px] tabular-nums"
        style={{ color: active ? "var(--ds-primary-700)" : "var(--ds-text-tertiary)" }}
      >
        {count}
      </span>
    </Link>
  );
}

function CheckboxSquare({ checked }: { checked: boolean }) {
  return (
    <span
      className="inline-flex size-4 flex-none items-center justify-center rounded-[4px] border transition-colors"
      style={{
        borderColor: checked ? "var(--ds-primary-500)" : "var(--ds-border-strong)",
        background: checked ? "var(--ds-primary-500)" : "transparent",
      }}
    >
      {checked ? <Check size={11} weight="bold" color="#fff" /> : null}
    </span>
  );
}
