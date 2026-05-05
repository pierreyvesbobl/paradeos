import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    globals: false,
    include: ["lib/**/*.test.ts", "tests/unit/**/*.test.ts"],
    exclude: ["node_modules", ".next", "tests/e2e/**"],
  },
});
