import "server-only";

import { projects } from "@/db/schema/projects";
import { fuzzyMatchProject } from "@/lib/crm/match";
import { db } from "@/lib/db/server";
import { syncParticipantsFromAttendees } from "@/lib/meetings/participants";
import { sql } from "drizzle-orm";

/**
 * Ce qu'une source d'ingestion déclare *avant* toute extraction : le
 * projet, les personnes présentes.
 *
 * Les deux pipelines automatiques ont la même matière à exploiter, écrite
 * à deux endroits différents — l'objet ou l'entête d'un mail (cf.
 * `email-directives.ts`), le nom du fichier Drive (cf.
 * `drive-filename.ts`). Ce qui vient après est identique, d'où ce module
 * commun : le projet est rapproché de l'existant, les participants
 * partent en base, et le prompt d'extraction les lit au lieu de les
 * deviner.
 */

/**
 * Longueur minimale d'un nom de projet pour qu'on accepte de le
 * reconnaître *dans* un titre. En dessous, un nom comme « IA » se
 * retrouverait dans la moitié des titres de réunion.
 */
const MIN_PROJECT_NAME_IN_TITLE = 4;

/**
 * Rapproche le projet déclaré de l'existant.
 *
 * La similarité trigramme ne suffit pas ici : on écrit « GpasPlus »
 * pour « GpasPlus - Automatisation des processus e-commerce », et huit
 * caractères sur cinquante ne franchissent aucun seuil raisonnable. Ce
 * qu'on écrit est un morceau du nom, donc on cherche d'abord un nom qui
 * le contient, et on ne retombe sur le flou que pour les fautes de
 * frappe.
 *
 * Deux projets contiennent le morceau → aucun n'est choisi : rattacher
 * la réunion au mauvais « GpasPlus » coûte plus cher que de la laisser
 * sans projet, où l'extraction le proposera et où un clic suffit.
 *
 * `fuzzy: false` pour une piste qui n'a pas été écrite exprès — un titre
 * de fichier Drive, par exemple. Une directive `[projet: X]` dans un mail
 * est une déclaration, et mérite qu'on rattrape la faute de frappe ; un
 * titre entier n'en est pas une, et le seuil trigramme y produirait des
 * rattachements arbitraires (« Sprint Parade » → projet « Parade »). En
 * échange, on accepte alors la reconnaissance dans l'autre sens : le
 * titre qui **contient** un nom de projet (« Point hebdo GpasPlus »).
 */
export async function resolveDeclaredProject(
  hint: string | null,
  { fuzzy = true }: { fuzzy?: boolean } = {},
): Promise<string | null> {
  const needle = hint?.trim();
  if (!needle || needle.length < 3) return null;

  const conn = await db();
  const contained = await conn
    .select({ id: projects.id })
    .from(projects)
    .where(sql`${projects.name} ilike ${`%${needle}%`}`)
    .limit(2);
  if (contained.length === 1) return contained[0]?.id ?? null;
  if (contained.length > 1) return null;

  if (fuzzy) {
    const match = await fuzzyMatchProject(needle);
    return match?.id ?? null;
  }

  // Sens inverse : le titre cite le projet. Un seul candidat, sinon on
  // laisse la réunion sans projet.
  const mentioned = await conn
    .select({ id: projects.id })
    .from(projects)
    .where(
      sql`length(${projects.name}) >= ${MIN_PROJECT_NAME_IN_TITLE} and ${needle} ilike '%' || ${projects.name} || '%'`,
    )
    .limit(2);
  return mentioned.length === 1 ? (mentioned[0]?.id ?? null) : null;
}

/**
 * Enregistre les participants déclarés avant l'extraction : le prompt
 * les lit (cf. `extract-and-save.ts`), ce qui lève l'ambiguïté des
 * prénoms seuls au lieu de la laisser au modèle.
 *
 * `source: "manual"` — ces personnes ne sont pas déduites du transcript,
 * elles sont écrites par un humain (dans l'objet du mail, dans le nom du
 * fichier que Meet a composé à partir des comptes présents). La fiche
 * réunion le distingue à l'affichage.
 */
export async function saveDeclaredParticipants(
  meetingId: string,
  participants: Array<{ name: string; email: string | null }>,
): Promise<void> {
  if (participants.length === 0) return;
  await syncParticipantsFromAttendees(
    meetingId,
    participants.map((p) => ({ name: p.name, email: p.email, role: null })),
    "manual",
  );
}
