import { PageHeader } from "@/components/page-header";
import { dougsSessions } from "@/db/schema/dougs";
import { getCurrentUserRole } from "@/lib/auth/admin";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db/server";
import { SETTING_KEYS, getSetting, getSettingStatus } from "@/lib/settings";
import { eq } from "drizzle-orm";
import { ApiTokensSection } from "./api-tokens-section";
import { DougsSection } from "./dougs-section";
import { DriveTranscriptsSection } from "./drive-transcripts-section";
import { GoogleCalendarSection } from "./google-calendar-section";
import { GoogleDriveSection } from "./google-drive-section";
import { IntegrationsTabs } from "./integrations-tabs";
import { LlmConfigForm } from "./llm-config-form";
import { OauthCallbackToast } from "./oauth-callback-toast";

export default async function IntegrationsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ google?: string; tab?: string }>;
}) {
  const user = await requireUser();
  const role = await getCurrentUserRole(user);
  const isAdmin = role === "admin";

  const [llmKey, llmModel, params, conn] = await Promise.all([
    isAdmin ? getSettingStatus(SETTING_KEYS.OPENROUTER_API_KEY) : Promise.resolve(null),
    isAdmin ? getSetting(SETTING_KEYS.LLM_MODEL) : Promise.resolve(null),
    searchParams,
    db(),
  ]);

  const [dougsSession] = await conn
    .select({
      companyId: dougsSessions.companyId,
      lastUsedAt: dougsSessions.lastUsedAt,
      expiresAt: dougsSessions.expiresAt,
    })
    .from(dougsSessions)
    .where(eq(dougsSessions.userId, user.id))
    .limit(1);

  const comptaTab = (
    <DougsSection
      connected={Boolean(dougsSession)}
      companyId={dougsSession?.companyId ?? null}
      lastUsedAt={dougsSession?.lastUsedAt?.toISOString() ?? null}
      expiresAt={dougsSession?.expiresAt?.toISOString() ?? null}
    />
  );

  const googleTab = (
    <>
      <GoogleDriveSection userId={user.id} />
      <GoogleCalendarSection userId={user.id} />
      {isAdmin ? <DriveTranscriptsSection /> : null}
    </>
  );

  const apiTab = (
    <>
      <ApiTokensSection userId={user.id} />
      {isAdmin && llmKey ? (
        <section className="rounded-lg border bg-card p-6">
          <header className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 className="font-medium text-sm">LLM (OpenRouter)</h2>
              <p className="mt-1 text-muted-foreground text-xs">
                OpenRouter expose 200+ modèles (Claude, GPT, Gemini, Llama…) via une API unique.
                Utilisé pour les résumés de meetings et l'extraction de tâches / contacts /
                opportunités. Accès admin uniquement.
              </p>
            </div>
            <Status status={llmKey} />
          </header>
          <LlmConfigForm currentKeyPreview={llmKey.preview} currentModel={llmModel} />
        </section>
      ) : null}
    </>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Réglages"
        title="Intégrations"
        description="Connexions personnelles (Google Drive…) et clés API partagées des pipelines automatisés."
      />

      {params.google ? <OauthCallbackToast status={params.google} /> : null}

      <IntegrationsTabs compta={comptaTab} google={googleTab} api={apiTab} />
    </div>
  );
}

function Status({
  status,
}: {
  status: NonNullable<Awaited<ReturnType<typeof getSettingStatus>>>;
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
