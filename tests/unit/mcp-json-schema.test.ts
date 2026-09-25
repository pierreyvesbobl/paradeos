import { toMcpInputSchema } from "@/lib/mcp/json-schema";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createMeetingSchema, setMeetingTranscriptSchema } from "../../mcp-server/tools";

/** Cherche récursivement une borne exclusive restée booléenne. */
function hasBooleanExclusiveBound(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(hasBooleanExclusiveBound);
  if (!node || typeof node !== "object") return false;
  const obj = node as Record<string, unknown>;
  if (typeof obj.exclusiveMinimum === "boolean" || typeof obj.exclusiveMaximum === "boolean") {
    return true;
  }
  return Object.values(obj).some(hasBooleanExclusiveBound);
}

describe("toMcpInputSchema", () => {
  it("rend les bornes exclusives numériques (draft 2020-12)", () => {
    const schema = toMcpInputSchema(z.object({ limit: z.number().int().positive().max(100) }));
    const props = schema.properties as Record<string, Record<string, unknown> | undefined>;
    const limit = props.limit ?? {};

    // OpenAPI 3.0 écrirait { minimum: 0, exclusiveMinimum: true } — rejeté
    // à l'ingestion par l'API Anthropic, qui attend un nombre.
    expect(limit.exclusiveMinimum).toBe(0);
    expect(limit.minimum).toBeUndefined();
    expect(limit.maximum).toBe(100);
  });

  it("nettoie les bornes exclusives imbriquées", () => {
    const schema = toMcpInputSchema(
      z.object({ lines: z.array(z.object({ quantity: z.number().positive() })) }),
    );
    expect(hasBooleanExclusiveBound(schema)).toBe(false);
  });

  it("garde une forme d'objet exploitable par les clients", () => {
    const schema = toMcpInputSchema(createMeetingSchema);
    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(["title", "transcript"]);
    expect(Object.keys(schema.properties as object)).toContain("participants");
    expect(schema.$schema).toBeUndefined();
  });
});

describe("schémas d'import de transcript", () => {
  it("exige un transcript d'au moins 20 caractères à la création", () => {
    expect(
      createMeetingSchema.safeParse({ title: "Réunion", transcript: "trop court" }).success,
    ).toBe(false);
    expect(
      createMeetingSchema.safeParse({ title: "Réunion", transcript: "a".repeat(20) }).success,
    ).toBe(true);
  });

  it("refuse un participant qui ne porte pas exactement une cible", () => {
    const base = { title: "Réunion", transcript: "a".repeat(20) };
    const uuid = "11111111-1111-4111-8111-111111111111";
    expect(
      createMeetingSchema.safeParse({ ...base, participants: [{ role: "CTO" }] }).success,
    ).toBe(false);
    expect(
      createMeetingSchema.safeParse({ ...base, participants: [{ userId: uuid, contactId: uuid }] })
        .success,
    ).toBe(false);
    expect(
      createMeetingSchema.safeParse({ ...base, participants: [{ displayName: "Jean" }] }).success,
    ).toBe(true);
  });

  it("n'accepte que replace / append comme mode", () => {
    const base = { id: "11111111-1111-4111-8111-111111111111", transcript: "texte" };
    expect(setMeetingTranscriptSchema.safeParse({ ...base, mode: "append" }).success).toBe(true);
    expect(setMeetingTranscriptSchema.safeParse({ ...base, mode: "prepend" }).success).toBe(false);
  });
});
