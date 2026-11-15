import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// The live-security tests: they run against the docker stack (API http://localhost:42069, anvil
// http://localhost:8546, chain 31337), so plain `pnpm test` stays hermetic. Each file sets the API URL before it
// imports the client, so files stay isolated from each other.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["test/stack/**/*.test.ts"],
    testTimeout: 120_000,
  },
});
