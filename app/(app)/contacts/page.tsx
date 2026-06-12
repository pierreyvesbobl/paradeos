import { redirect } from "next/navigation";

// La liste des contacts est désormais l'onglet Contacts du hub CRM.
// Route conservée comme redirection pour les anciens favoris/liens.
export default function ContactsRedirect() {
  redirect("/crm/contacts");
}
