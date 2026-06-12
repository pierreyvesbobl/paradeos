import { redirect } from "next/navigation";

// Le planning a été fusionné dans la page « Time tracking » (/temps).
// On garde cette route comme redirection pour les anciens favoris/liens.
type SearchParams = Promise<{ week?: string }>;

export default async function PlanningRedirect({ searchParams }: { searchParams: SearchParams }) {
  const { week } = await searchParams;
  const suffix = week ? `&week=${encodeURIComponent(week)}` : "";
  redirect(`/temps?tab=planning${suffix}`);
}
