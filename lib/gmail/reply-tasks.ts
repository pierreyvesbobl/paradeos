import { words } from "./word-match";

/**
 * Tâches dont tout l'objet est de répondre à quelqu'un : « Répondre à
 * Frédéric », « Relancer Marco », « Confirmer à Bénédicte ». Dès que
 * l'utilisateur a envoyé un message dans le fil après celui qui les a
 * fait naître, elles sont faites par construction. Les autres tâches du
 * même mail (« faire la demande d'agrément ») ne le sont pas.
 */
const REPLY_TASK = words(
  "répondre|repondre|réponse|reply|respond|relancer|recontacter|revenir vers|rappeler|accuser réception|confirmer (?:à|a|auprès)|indiquer (?:à|a)|dire (?:à|a)|informer|tenir au courant|faire (?:un )?retour|donner (?:son|une|notre|un) (?:avis|réponse|retour)",
);

export function isReplyTask(title: string | null | undefined): boolean {
  const t = title?.trim() ?? "";
  // Le verbe doit ouvrir la tâche : « Répondre à Frédéric sur X », pas
  // « Préparer le dossier pour pouvoir répondre à l'appel d'offres ».
  return t !== "" && REPLY_TASK.test(t.slice(0, 40));
}
