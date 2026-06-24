import { PageHeader } from "@/components/page-header";
import { getCurrentUserRole } from "@/lib/auth/admin";
import { requireUser } from "@/lib/auth/server";
import { SETTING_KEYS, getSetting } from "@/lib/settings";
import { redirect } from "next/navigation";
import { DemoModeSection } from "./demo-mode-section";

export default async function DemoSettingsPage() {
  const user = await requireUser();
  const role = await getCurrentUserRole(user);
  if (role !== "admin") redirect("/settings/profile");

  const demoMode = await getSetting(SETTING_KEYS.DEMO_MODE);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Réglages"
        title="Mode démo"
        description="Affiche des noms d'entreprises, contacts, projets et montants anonymisés à l'écran. Les données en base ne sont pas modifiées."
      />

      <DemoModeSection enabled={demoMode === "true"} />
    </div>
  );
}
