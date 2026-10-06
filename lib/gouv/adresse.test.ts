import { describe, expect, it } from "vitest";
import { normalizeAddressResults } from "./adresse";

/** Extrait réel de la réponse BAN, réduit aux champs lus. */
const payload = {
  features: [
    {
      properties: {
        id: "69085_0045_00017",
        label: "17 Impasse des cerisiers 69250 Fleurieu-sur-Saône",
        context: "69, Rhône, Auvergne-Rhône-Alpes",
        housenumber: "17",
        street: "Impasse des cerisiers",
        name: "17 Impasse des cerisiers",
        postcode: "69250",
        city: "Fleurieu-sur-Saône",
        type: "housenumber",
      },
    },
  ],
};

describe("normalizeAddressResults", () => {
  it("découpe la suggestion BAN en adresse structurée", () => {
    const [suggestion] = normalizeAddressResults(payload);
    expect(suggestion?.id).toBe("69085_0045_00017");
    expect(suggestion?.address).toEqual({
      street: "17 Impasse des cerisiers",
      postalCode: "69250",
      city: "Fleurieu-sur-Saône",
      country: "France",
    });
  });

  it("conserve la casse de la BAN, déjà correcte", () => {
    const [suggestion] = normalizeAddressResults(payload);
    expect(suggestion?.address.city).toBe("Fleurieu-sur-Saône");
  });

  it("reconstruit la voie quand `name` manque", () => {
    const [suggestion] = normalizeAddressResults({
      features: [
        {
          properties: {
            label: "12 Rue de la Paix 75002 Paris",
            housenumber: "12",
            street: "Rue de la Paix",
            postcode: "75002",
            city: "Paris",
          },
        },
      ],
    });
    expect(suggestion?.address.street).toBe("12 Rue de la Paix");
  });

  it("ne verse pas un nom de commune dans le champ Rue", () => {
    const [suggestion] = normalizeAddressResults({
      features: [
        {
          properties: {
            label: "Lyon 7e Arrondissement",
            name: "Lyon 7e Arrondissement",
            postcode: "69007",
            city: "Lyon 7e Arrondissement",
            type: "municipality",
          },
        },
      ],
    });
    expect(suggestion?.address).toEqual({
      postalCode: "69007",
      city: "Lyon 7e Arrondissement",
      country: "France",
    });
  });

  it("ignore une réponse vide ou sans libellé", () => {
    expect(normalizeAddressResults({})).toEqual([]);
    expect(normalizeAddressResults({ features: [{ properties: {} }] })).toEqual([]);
  });
});
