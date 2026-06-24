import { CommandPalette } from "@/components/command-palette";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { requireUser } from "@/lib/auth/server";
import { DemoModeProvider } from "@/lib/demo/context";
import { isDemoMode } from "@/lib/demo/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [user, demo] = await Promise.all([requireUser(), isDemoMode()]);
  return (
    <DemoModeProvider value={demo}>
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar user={user} />
          <main className="flex-1 overflow-x-auto p-6">{children}</main>
        </div>
        <CommandPalette />
      </div>
    </DemoModeProvider>
  );
}
