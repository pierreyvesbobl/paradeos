import { PageHeader } from "@/components/page-header";
import { projects } from "@/db/schema/projects";
import { db } from "@/lib/db/server";
import { asc } from "drizzle-orm";
import { NewMeetingForm } from "./new-meeting-form";

export default async function NewMeetingPage() {
  const conn = await db();
  const projectList = await conn
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .orderBy(asc(projects.name));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Meetings"
        title="Nouveau meeting"
        description="Colle le transcript ou téléverse un fichier .txt / .vtt / .srt. L'extraction LLM démarrera après l'enregistrement."
      />
      <NewMeetingForm projects={projectList} />
    </div>
  );
}
