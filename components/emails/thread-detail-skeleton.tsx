export function ThreadDetailSkeleton() {
  return (
    <div className="mx-auto max-w-[840px] animate-pulse space-y-6 px-[30px] py-6">
      <header className="flex items-start justify-between gap-4">
        <div className="h-7 flex-1 rounded-md bg-[var(--ds-bg-hover)]" />
        <div className="h-8 w-32 rounded-md bg-[var(--ds-bg-hover)]" />
      </header>
      <div
        className="flex items-center gap-2 rounded-lg border p-2.5"
        style={{ borderColor: "var(--ds-border)" }}
      >
        <div className="h-7 w-7 rounded-md bg-[var(--ds-bg-hover)]" />
        <div className="h-5 flex-1 rounded bg-[var(--ds-bg-hover)]" />
        <div className="h-6 w-16 rounded bg-[var(--ds-bg-hover)]" />
      </div>
      <div
        className="space-y-3 rounded-xl border p-4"
        style={{ borderColor: "var(--ds-border)" }}
      >
        <div className="h-5 w-24 rounded bg-[var(--ds-bg-hover)]" />
        <div className="h-14 rounded bg-[var(--ds-bg-hover)]" />
        <div className="h-14 rounded bg-[var(--ds-bg-hover)]" />
        <div className="h-14 rounded bg-[var(--ds-bg-hover)]" />
      </div>
      <div
        className="h-40 rounded-xl border"
        style={{ borderColor: "var(--ds-border)", background: "var(--ds-bg-app)" }}
      />
    </div>
  );
}
