import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  {
    // These React 19 advisory rules are valuable migration targets, but the
    // existing application intentionally uses these patterns today. Keep the
    // same lint policy the project had before moving from `next lint`.
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  globalIgnores([
    ".next/**",
    ".next-dev/**",
    "out/**",
    "build/**",
    "**/dist/**",
    "next-env.d.ts",
  ]),
]);
