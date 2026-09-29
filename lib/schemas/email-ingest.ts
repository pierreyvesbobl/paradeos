import { z } from "zod";

/**
 * Nom du label Gmail qui sert de file d'attente aux transcripts reçus
 * par mail. Chaîne vide = désactiver l'ingestion.
 *
 * Gmail plafonne un nom de label à 225 caractères et utilise `/` comme
 * séparateur de hiérarchie — on l'autorise donc (`Paradeos/Réunions`)
 * mais on refuse un segment vide, qui ferait échouer `labels.create`.
 */
export const updateMeetingsEmailLabelSchema = z.object({
  label: z
    .string()
    .trim()
    .max(200)
    .refine(
      (v) =>
        v === "" ||
        (!v.startsWith("/") &&
          !v.endsWith("/") &&
          !v.includes("//") &&
          v.split("/").every((seg) => seg.trim().length > 0)),
      "Nom de label invalide (segment vide ou `/` en trop).",
    ),
});
