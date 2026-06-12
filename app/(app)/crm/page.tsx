import { redirect } from "next/navigation";

// Le hub CRM ouvre sur l'onglet Contacts par défaut.
export default function CrmPage() {
  redirect("/crm/contacts");
}
