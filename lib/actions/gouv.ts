"use server";

import { action } from "@/lib/actions/action";
import { type AddressSuggestion, searchAddresses } from "@/lib/gouv/adresse";
import { type SireneCompany, searchCompanies } from "@/lib/gouv/sirene";
import { searchAddressesSchema, searchCompaniesSchema } from "@/lib/schemas/gouv";

/**
 * Les deux APIs (recherche-entreprises, Base Adresse Nationale) sont
 * publiques et sans clé, mais on passe quand même par une Server Action :
 * ça évite d'exposer l'IP du visiteur aux serveurs de l'État, ça garde le
 * débit sous notre contrôle, et le navigateur n'a pas à connaître la forme
 * brute des réponses.
 *
 * `allowViewer` : ce sont des lectures, un compte en lecture seule peut
 * consulter sans pouvoir enregistrer.
 */
export const lookupCompanies = action(
  searchCompaniesSchema,
  async ({ input }): Promise<SireneCompany[]> => searchCompanies(input.query),
  { allowViewer: true },
);

export const lookupAddresses = action(
  searchAddressesSchema,
  async ({ input }): Promise<AddressSuggestion[]> => searchAddresses(input.query),
  { allowViewer: true },
);
