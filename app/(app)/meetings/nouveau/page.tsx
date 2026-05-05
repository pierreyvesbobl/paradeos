import { PageHeader } from "@/components/page-header";
import { NewMeetingForm } from "./new-meeting-form";

export default function NewMeetingPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Meetings"
        title="Nouveau meeting"
        description="Colle le transcript ou téléverse un fichier .txt / .vtt / .srt. L'extraction LLM démarrera après l'enregistrement."
      />
      <NewMeetingForm />
    </div>
  );
}
