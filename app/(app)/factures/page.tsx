import { redirect } from "next/navigation";

// Les factures classées ont été intégrées comme onglet de la page Compta.
// On garde cette route comme redirection pour les anciens favoris/liens.
export default function FacturesRedirect() {
  redirect("/compta?tab=factures");
}
