import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import prettier from "eslint-config-prettier";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

const tsRecommendedRules = tsPlugin.configs.recommended.rules;

export default [
  {
    ignores: ["node_modules/**", "src/agent_pdf_workbench/web/**"],
  },
  {
    files: ["frontend/src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.browser,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      "react-hooks": reactHooks,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tsRecommendedRules,
      // App.tsx is hook- and ref-heavy; these catch the mistakes that class of
      // code actually makes.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      // TypeScript resolves identifiers itself, and its DOM lib types (e.g.
      // ScrollToOptions) are not in ESLint's browser globals — leaving this on
      // only produces false positives in .ts files.
      "no-undef": "off",
    },
  },
  {
    files: ["vite.config.ts", "vitest.config.ts"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tsRecommendedRules,
    },
  },
  prettier,
];
