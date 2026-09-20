import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "@typescript-eslint/no-explicit-any": "error",
      "prefer-const": "error",
      "no-var": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Service worker source. Targets the ServiceWorkerGlobalScope, not the
    // app: ES5 syntax on purpose (widest SW support, no transpile step) and
    // worker globals the app's config doesn't know about. Built into
    // public/sw.js by scripts/post-build.mjs.
    "src/sw/**",
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
