import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    // test/stack needs the running docker stack (API, anvil): `vitest run --config vitest.stack.config.ts`.
    exclude: ["node_modules", ".next", "test/stack/**"],
    testTimeout: 120_000,
  },
});
