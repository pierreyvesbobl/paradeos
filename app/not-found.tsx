import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";

/**
 * 404 hors zone (app) : URL inconnue qui ne matche aucun segment. Le
 * root layout n'a pas de sidebar, on centre simplement le message.
 * Les `notFound()` des pages détail passent par `app/(app)/not-found.tsx`.
 */
export default function RootNotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-[480px]">
        <EmptyState
          icon={MagnifyingGlass}
          title="Page introuvable."
          description="Cette adresse ne correspond à aucune page de Parade OS."
          action={
            <Button variant="outline" asChild>
              <Link href="/">Retour à l'accueil</Link>
            </Button>
          }
        />
      </div>
    </div>
  );
}
