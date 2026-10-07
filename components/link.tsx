import NextLink from "next/link";
import type { ComponentProps } from "react";

/**
 * `next/link` sans prefetch au chargement (le prefetch au survol reste).
 *
 * Avec Next 16, chaque page affichée déclenchait une trentaine de requêtes
 * de prefetch (barre latérale, lignes des listes), soit autant d'invocations
 * de fonction sur Vercel, chacune avec ses requêtes SQL de layout — et
 * annulées dès qu'on navigue. Une requête annulée laisse sa connexion du
 * pool bloquée côté Postgres jusqu'au `statement_timeout` ; la fiche projet,
 * gourmande en connexions parallèles, attendait derrière et partait en 500.
 * Toutes nos pages sont dynamiques : le prefetch ne rapportait que le
 * squelette de chargement.
 */
export default function Link(props: ComponentProps<typeof NextLink>) {
  return <NextLink prefetch={false} {...props} />;
}
