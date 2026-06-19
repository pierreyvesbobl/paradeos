import Link from "next/link";
import { SidebarNav } from "./sidebar-nav";

export function Sidebar() {
  return (
    <aside className="hidden w-[230px] shrink-0 flex-col border-ds-border border-r bg-ds-sidebar md:flex">
      <div className="flex h-14 items-center gap-2.5 border-ds-border border-b px-4">
        <Link href="/" className="flex items-center gap-2.5">
          <span
            className="parade-mark"
            style={{ width: 28, height: 28, fontSize: 18, borderRadius: 7 }}
          >
            P
          </span>
          <span className="font-brand font-semibold text-[18px] text-ds-text leading-none tracking-tight">
            Parade
          </span>
        </Link>
      </div>
      <SidebarNav />
      <div className="border-ds-border border-t p-3 text-[11px] text-ds-text-tertiary">
        Parade SAS — Lyon
      </div>
    </aside>
  );
}
