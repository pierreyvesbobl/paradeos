import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";

/**
 * Page 404 de la zone authentifiée. Déclenchée par `notFound()` dans les
 * pages détail (projet, contact, tâche… supprimé ou id invalide) et par
 * toute URL inconnue sous (app).
 */
export default function AppNotFound() {
  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-6 py-12">
      <EmptyState
        icon={MagnifyingGlass}
        title="Introuvable."
        description="Cet élément n'existe pas ou a été supprimé."
        action={
          <Button variant="outline" asChild>
            <Link href="/">Retour à l'accueil</Link>
          </Button>
        }
      />
    </div>
  );
}
