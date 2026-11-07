import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import reactHooks from "eslint-plugin-react-hooks";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      // Rapid internal development: allow pragmatic typing & apostrophes
      "@typescript-eslint/no-explicit-any": "off",
      "react/no-unescaped-entities": "off",
      // Intentional patterns (debounced fetches, sidebar close on nav, theme init):
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
    },
  },
  {
    files: ["scripts/**/*.cjs", "deploy/**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    ".database-tools/**",
    "next-env.d.ts",
    "data/**",
    // Local assistant packages are tooling assets, not application source.
    ".agents/**",
    ".claude/**",
    ".claude-plugin/**",
    // اسکریپت‌های QA محلی (gitignore شده) بخشی از سورس برنامه نیستند
    ".freebuff/**",
  ]),
]);

export default eslintConfig;
