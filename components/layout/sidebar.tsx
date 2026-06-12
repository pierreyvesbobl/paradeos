import Link from "next/link";
import { SidebarNav } from "./sidebar-nav";

export function Sidebar() {
  return (
    <aside className="hidden w-60 shrink-0 border-r bg-card md:flex md:flex-col">
      <div className="flex h-14 items-center border-b px-4">
        <Link href="/" className="font-mono font-semibold text-sm tracking-tight">
          Parade OS
        </Link>
      </div>
      <SidebarNav />
      <div className="border-t p-3 text-[11px] text-muted-foreground">Parade SAS — Lyon</div>
    </aside>
  );
}
