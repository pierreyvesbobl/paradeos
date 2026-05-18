import { redirect } from "next/navigation";

export default function RapprochementRedirect() {
  redirect("/compta?tab=rapprochement");
}
