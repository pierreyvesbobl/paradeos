import { describe, expect, it } from "vitest";
import {
  claudeModState,
  installCommand,
  installCommandsLegacy,
  isPluginGrant,
  PLUGIN_ID,
  PLUGIN_NAME,
  PLUGIN_VERSION,
  uninstallCommand,
  updateCommand,
} from "./install";

describe("commandes d'installation du mod", () => {
  it("lit le nom et la version dans le manifeste du mod", () => {
    expect(PLUGIN_NAME).toBe("paradeos-temps");
    expect(PLUGIN_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(PLUGIN_ID).toBe("paradeos-temps@paradeos");
  });

  it("installe en une commande depuis le dépôt public", () => {
    expect(installCommand()).toBe(
      "claude plugin install paradeos-temps --marketplace pierreyvesbobl/paradeos",
    );
    expect(updateCommand()).toBe("claude plugin update paradeos-temps@paradeos");
    expect(uninstallCommand()).toBe("claude plugin uninstall paradeos-temps@paradeos");
    expect(installCommandsLegacy().split("\n")).toHaveLength(2);
  });
});

describe("état du mod pour un utilisateur", () => {
  const now = new Date("2026-11-17T10:00:00Z");

  it("rien d'installé sans autorisation ni signal", () => {
    expect(claudeModState({ lastSegmentAt: null, authorized: false, now })).toBe("not_installed");
  });

  it("en attente de signal quand le serveur est autorisé", () => {
    expect(claudeModState({ lastSegmentAt: null, authorized: true, now })).toBe("awaiting_signal");
  });

  it("actif sur un signal récent, même sans grant visible", () => {
    const lastSegmentAt = new Date("2026-11-16T09:00:00Z");
    expect(claudeModState({ lastSegmentAt, authorized: false, now })).toBe("active");
  });

  it("ancien au-delà de sept jours", () => {
    const lastSegmentAt = new Date("2026-11-01T09:00:00Z");
    expect(claudeModState({ lastSegmentAt, authorized: true, now })).toBe("stale");
  });
});

describe("reconnaissance du grant OAuth du mod", () => {
  it("reconnaît le client enregistré par Claude Code pour le plugin", () => {
    expect(isPluginGrant("Claude Code (plugin:paradeos-temps:paradeos)")).toBe(true);
    expect(isPluginGrant("Claude Code (plugin:paradeos-temps:inline)")).toBe(true);
  });

  it("ignore les autres clients", () => {
    expect(isPluginGrant("Claude")).toBe(false);
    expect(isPluginGrant(null)).toBe(false);
  });
});
