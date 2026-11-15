import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["abis/", "generated/", ".ponder/", "ponder-env.d.ts", "drizzle/"] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
  },
  { files: ["eslint.config.js"], ...tseslint.configs.disableTypeChecked },
);
