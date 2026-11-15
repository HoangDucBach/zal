import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/app-db/schema.ts",
  out: "./drizzle",
  schemaFilter: ["zal_app"],
  migrations: { schema: "zal_app" },
});
