import { describe, expect, it } from "vitest";
import { normalizeSireneResults } from "./sirene";

/** Extrait réel de la réponse de l'API, réduit aux champs lus. */
const payload = {
  results: [
    {
      siren: "911556421",
      nom_complet: "BOBL (BOBL)",
      nom_raison_sociale: "BOBL",
      tva: ["FR73911556421"],
      siege: {
        siret: "91155642100020",
        etat_administratif: "A",
        statut_diffusion_etablissement: "O",
        numero_voie: "17",
        indice_repetition: null,
        type_voie: "RUE",
        libelle_voie: "DES CERISIERS",
        complement_adresse: null,
        code_postal: "69250",
        libelle_commune: "FLEURIEU-SUR-SAONE",
      },
    },
  ],
};

describe("normalizeSireneResults", () => {
  it("compose une adresse recapitalisée depuis les champs INSEE", () => {
    const [company] = normalizeSireneResults(payload);
    expect(company?.address).toEqual({
      street: "17 Rue des Cerisiers",
      postalCode: "69250",
      city: "Fleurieu-sur-Saone",
      country: "France",
    });
    expect(company?.addressLabel).toBe("17 Rue des Cerisiers, 69250 Fleurieu-sur-Saone");
  });

  it("retient le SIRET du siège, la TVA et la dénomination sociale", () => {
    const [company] = normalizeSireneResults(payload);
    expect(company?.siren).toBe("911556421");
    expect(company?.siret).toBe("91155642100020");
    expect(company?.vatNumber).toBe("FR73911556421");
    expect(company?.legalName).toBe("BOBL");
    expect(company?.active).toBe(true);
    expect(company?.undisclosed).toBe(false);
  });

  it("affiche la dénomination sociale plutôt que le nom_complet dédoublé", () => {
    const [company] = normalizeSireneResults(payload);
    expect(company?.name).toBe("Bobl");
  });

  it("se replie sur nom_complet pour une entreprise individuelle", () => {
    const [company] = normalizeSireneResults({
      results: [{ siren: "444444444", nom_complet: "JEAN DUPONT", nom_raison_sociale: null }],
    });
    expect(company?.name).toBe("Jean Dupont");
    expect(company?.legalName).toBeNull();
  });

  it("place le complément d'adresse avant la voie", () => {
    const [company] = normalizeSireneResults({
      results: [
        {
          siren: "111111111",
          nom_complet: "X",
          siege: {
            complement_adresse: "BATIMENT C",
            numero_voie: "4",
            type_voie: "BOULEVARD",
            libelle_voie: "DE MONS",
            code_postal: "59650",
            libelle_commune: "VILLENEUVE-D'ASCQ",
          },
        },
      ],
    });
    expect(company?.address?.street).toBe("Batiment C, 4 Boulevard de Mons");
    expect(company?.address?.city).toBe("Villeneuve-d'Ascq");
  });

  it("signale un établissement cessé et une entreprise non diffusible", () => {
    const [company] = normalizeSireneResults({
      results: [
        {
          siren: "222222222",
          nom_complet: "Y",
          siege: { etat_administratif: "C", statut_diffusion_etablissement: "P" },
        },
      ],
    });
    expect(company?.active).toBe(false);
    expect(company?.undisclosed).toBe(true);
    // Sans voie ni commune diffusées, pas d'adresse fabriquée.
    expect(company?.address).toBeNull();
  });

  it("renseigne le pays quand l'établissement est à l'étranger", () => {
    const [company] = normalizeSireneResults({
      results: [
        {
          siren: "333333333",
          nom_complet: "Z",
          siege: { libelle_commune: "GENEVE", libelle_pays_etranger: "SUISSE" },
        },
      ],
    });
    expect(company?.address?.country).toBe("Suisse");
  });

  it("liste le siège puis les établissements correspondants", () => {
    const [company] = normalizeSireneResults({
      results: [
        {
          siren: "500569405",
          nom_raison_sociale: "DECATHLON FRANCE",
          siege: {
            siret: "50056940503239",
            numero_voie: "4",
            type_voie: "BOULEVARD",
            libelle_voie: "DE MONS",
            code_postal: "59650",
            libelle_commune: "VILLENEUVE-D'ASCQ",
          },
          matching_etablissements: [
            {
              siret: "50056940501647",
              adresse: "17 RUE DOCTEUR BOUCHUT 69003 LYON",
              code_postal: "69003",
              libelle_commune: "LYON",
              est_siege: false,
              etat_administratif: "A",
              liste_enseignes: ["DECATHLON"],
            },
          ],
        },
      ],
    });
    expect(company?.establishments).toHaveLength(2);
    expect(company?.establishments[0]).toMatchObject({
      siret: "50056940503239",
      isHeadOffice: true,
    });
    // L'adresse à plat est recoupée : le suffixe "<CP> <commune>" retiré.
    expect(company?.establishments[1]).toMatchObject({
      siret: "50056940501647",
      isHeadOffice: false,
      label: "DECATHLON",
      addressLabel: "17 Rue Docteur Bouchut, 69003 Lyon",
    });
    expect(company?.establishments[1]?.address).toEqual({
      street: "17 Rue Docteur Bouchut",
      postalCode: "69003",
      city: "Lyon",
      country: "France",
    });
  });

  it("ne duplique pas le siège quand il figure aussi dans les correspondances", () => {
    const [company] = normalizeSireneResults({
      results: [
        {
          siren: "911556421",
          nom_raison_sociale: "BOBL",
          siege: { siret: "91155642100020", code_postal: "69250", libelle_commune: "FLEURIEU" },
          matching_etablissements: [
            {
              siret: "91155642100020",
              adresse: "17 RUE DES CERISIERS 69250 FLEURIEU",
              est_siege: true,
            },
          ],
        },
      ],
    });
    expect(company?.establishments).toHaveLength(1);
  });

  it("garde l'adresse entière quand le suffixe commune ne s'y trouve pas", () => {
    const [company] = normalizeSireneResults({
      results: [
        {
          siren: "222222222",
          nom_raison_sociale: "X",
          matching_etablissements: [
            {
              siret: "22222222200011",
              adresse: "LIEU-DIT LES GRANDS CHAMPS",
              libelle_commune: "AUTRE",
            },
          ],
        },
      ],
    });
    // Chaque mot séparé par un tiret est capitalisé, comme "Saint-Clement".
    expect(company?.establishments[0]?.address?.street).toBe("Lieu-Dit les Grands Champs");
  });

  it("ne recopie pas le littéral [NON-DIFFUSIBLE] de l'INSEE", () => {
    const [company] = normalizeSireneResults({
      results: [
        {
          siren: "902705052",
          nom_complet: "[NON-DIFFUSIBLE]",
          nom_raison_sociale: "[NON-DIFFUSIBLE]",
          siege: {
            siret: "90270505200015",
            statut_diffusion_etablissement: "P",
            numero_voie: "[NON-DIFFUSIBLE]",
            type_voie: "[NON-DIFFUSIBLE]",
            libelle_voie: "[NON-DIFFUSIBLE]",
            complement_adresse: "[NON-DIFFUSIBLE]",
            code_postal: "[NON-DIFFUSIBLE]",
            libelle_commune: "SAINT-CYR-SUR-MER",
          },
        },
      ],
    });
    expect(company?.legalName).toBeNull();
    expect(company?.undisclosed).toBe(true);
    // Seule la commune est réellement diffusée.
    expect(company?.address).toEqual({ city: "Saint-Cyr-sur-Mer", country: "France" });
    // Le SIRET, lui, reste exploitable.
    expect(company?.siret).toBe("90270505200015");
    expect(company?.name).toBe("902705052");
  });

  it("ignore une réponse sans résultats exploitables", () => {
    expect(normalizeSireneResults({})).toEqual([]);
    expect(normalizeSireneResults({ results: [{ nom_complet: "sans siren" }] })).toEqual([]);
  });
});
