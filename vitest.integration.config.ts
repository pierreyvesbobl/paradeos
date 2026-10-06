import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Tests d'intégration : Server Actions et requêtes contre une base PGlite
 * (cf. tests/integration/db.ts). Séparés des tests unitaires pour garder
 * `pnpm test` instantané.
 */
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      "server-only": fileURLToPath(new URL("./tests/integration/empty.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    globals: false,
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["tests/integration/setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
