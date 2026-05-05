import { PageHeader } from "@/components/page-header";
import { requireAdmin } from "@/lib/auth/admin";
import { requireUser } from "@/lib/auth/server";
import { SETTING_KEYS, getSettingStatus } from "@/lib/settings";
import { OpenAiKeyForm } from "./openai-key-form";

export default async function IntegrationsSettingsPage() {
  const user = await requireUser();
  await requireAdmin(user);

  const openAi = await getSettingStatus(SETTING_KEYS.OPENAI_API_KEY);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Réglages"
        title="Intégrations"
        description="Clés API utilisées par les pipelines automatisés (résumés de meetings, extractions…)."
      />

      <section className="rounded-lg border bg-card p-6">
        <header className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="font-medium text-sm">OpenAI</h2>
            <p className="mt-1 text-muted-foreground text-xs">
              Utilisée pour les résumés de meetings et l'extraction de tâches / contacts /
              opportunités. Stockée chiffrée côté Postgres avec accès admin uniquement.
            </p>
          </div>
          <Status status={openAi} />
        </header>
        <OpenAiKeyForm currentPreview={openAi.preview} />
      </section>
    </div>
  );
}

function Status({
  status,
}: {
  status: Awaited<ReturnType<typeof getSettingStatus>>;
}) {
  if (!status.set) {
    return (
      <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-amber-700 text-xs dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
        Non configurée
      </span>
    );
  }
  return (
    <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-emerald-700 text-xs dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
      {status.source === "env" ? "Variable d'env" : "Configurée"}
    </span>
  );
}
