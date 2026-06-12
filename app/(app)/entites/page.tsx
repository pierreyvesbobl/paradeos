import { redirect } from "next/navigation";

// La liste des entités est désormais l'onglet Entités du hub CRM.
// Route conservée comme redirection pour les anciens favoris/liens.
export default function EntitesRedirect() {
  redirect("/crm/entites");
}
