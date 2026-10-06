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

  it("ignore une réponse sans résultats exploitables", () => {
    expect(normalizeSireneResults({})).toEqual([]);
    expect(normalizeSireneResults({ results: [{ nom_complet: "sans siren" }] })).toEqual([]);
  });
});
