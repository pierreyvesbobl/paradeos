import { redirect } from "next/navigation";

// Le pipeline commercial est désormais l'onglet Pipeline du hub CRM.
// Route conservée comme redirection pour les anciens favoris/liens.
export default function PipelineRedirect() {
  redirect("/crm/pipeline");
}
