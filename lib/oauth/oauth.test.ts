import { describe, expect, it } from "vitest";
import { parseAuthorizeParams } from "./authorize-params";
import { isAcceptableResource, normalizeScope, resourceUri, scopeGrants } from "./config";
import { challengeFor, verifyPkce } from "./pkce";

const APP = "https://paradeos.vercel.app";

describe("resourceUri / isAcceptableResource", () => {
  it("construit l'URI canonique sans slash final", () => {
    expect(resourceUri(APP)).toBe(`${APP}/api/mcp`);
    expect(resourceUri(`${APP}/`)).toBe(`${APP}/api/mcp`);
  });

  it("accepte l'URI complète et l'origine seule", () => {
    expect(isAcceptableResource(`${APP}/api/mcp`, APP)).toBe(true);
    expect(isAcceptableResource(`${APP}/api/mcp/`, APP)).toBe(true);
    expect(isAcceptableResource(APP, APP)).toBe(true);
  });

  it("refuse une audience étrangère", () => {
    expect(isAcceptableResource("https://evil.example.com/api/mcp", APP)).toBe(false);
    // Un préfixe qui ressemble ne suffit pas : c'est une comparaison exacte.
    expect(isAcceptableResource(`${APP}.evil.com/api/mcp`, APP)).toBe(false);
  });
});

describe("normalizeScope", () => {
  it("retombe sur le scope complet quand rien n'est demandé", () => {
    expect(normalizeScope(undefined)).toBe("mcp:read mcp:write");
    expect(normalizeScope("")).toBe("mcp:read mcp:write");
  });

  it("filtre les scopes inconnus", () => {
    expect(normalizeScope("mcp:read admin:everything")).toBe("mcp:read");
  });

  it("retombe sur le défaut si aucun scope connu n'est demandé", () => {
    expect(normalizeScope("admin:everything")).toBe("mcp:read mcp:write");
  });

  it("dédoublonne et ordonne", () => {
    expect(normalizeScope("mcp:write mcp:read mcp:write")).toBe("mcp:read mcp:write");
  });
});

describe("scopeGrants", () => {
  it("ne confond pas un scope avec un préfixe", () => {
    expect(scopeGrants("mcp:read", "mcp:write")).toBe(false);
    expect(scopeGrants("mcp:read mcp:write", "mcp:write")).toBe(true);
  });
});

describe("verifyPkce", () => {
  it("valide un couple verifier/challenge cohérent", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(verifyPkce(verifier, challengeFor(verifier))).toBe(true);
  });

  it("refuse un mauvais verifier", () => {
    expect(verifyPkce("autre-chose", challengeFor("le-bon"))).toBe(false);
  });

  it("refuse un challenge de longueur différente sans lever", () => {
    expect(verifyPkce("x", "trop-court")).toBe(false);
  });
});

describe("parseAuthorizeParams", () => {
  const base = {
    client_id: "paradeos_client_abc",
    redirect_uri: "http://localhost:9876/cb",
    response_type: "code",
    code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    code_challenge_method: "S256",
  };
  const params = (over: Record<string, string | undefined> = {}) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...base, ...over })) if (v !== undefined) sp.set(k, v);
    return sp;
  };

  it("accepte une requête conforme", () => {
    const res = parseAuthorizeParams(params({ state: "xyz", scope: "mcp:read" }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.params.state).toBe("xyz");
      expect(res.params.scope).toBe("mcp:read");
    }
  });

  it("exige PKCE", () => {
    const res = parseAuthorizeParams(params({ code_challenge: undefined }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("invalid_request");
  });

  it("refuse code_challenge_method=plain", () => {
    const res = parseAuthorizeParams(params({ code_challenge_method: "plain" }));
    expect(res.ok).toBe(false);
  });

  it("refuse un response_type autre que code", () => {
    const res = parseAuthorizeParams(params({ response_type: "token" }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("unsupported_response_type");
  });

  it("exige client_id et redirect_uri", () => {
    expect(parseAuthorizeParams(params({ client_id: undefined })).ok).toBe(false);
    expect(parseAuthorizeParams(params({ redirect_uri: undefined })).ok).toBe(false);
  });
});
