import { config as loadEnv } from "dotenv";
import { defineConfig } from "drizzle-kit";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL est requis pour drizzle-kit.");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema/*.ts",
  out: "./db/migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  schemaFilter: ["public"],
  strict: true,
  verbose: true,
});
