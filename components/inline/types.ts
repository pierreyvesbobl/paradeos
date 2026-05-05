/**
 * Contrat commun aux composants `Inline*` : la page passe un callback
 * `onSave(value)` qui résout vers un `{ ok, message? }`. La page est
 * responsable d'invoquer la bonne server action (patchTask, patchProject,
 * patchOpportunity…) avec le bon id + nom de champ.
 *
 * `null` est explicite : effacer la valeur (FK / date / texte vide).
 */
export type SaveResult = { ok: true } | { ok: false; message: string };
export type Saver<T> = (value: T) => Promise<SaveResult>;
