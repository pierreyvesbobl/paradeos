import { z } from "zod";

/**
 * Recherches sur les APIs publiques de l'État. Le minimum de 3 caractères
 * est aligné sur `searchCompanies` : en-dessous, l'INSEE renvoie du bruit.
 */
export const searchCompaniesSchema = z.object({
  query: z.string().trim().min(3, "Au moins 3 caractères.").max(200),
});

export const searchAddressesSchema = z.object({
  query: z.string().trim().min(4, "Au moins 4 caractères.").max(200),
});

export type SearchCompaniesInput = z.infer<typeof searchCompaniesSchema>;
export type SearchAddressesInput = z.infer<typeof searchAddressesSchema>;
