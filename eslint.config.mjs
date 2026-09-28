import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // The private app links through @/components/alpha/link (prefetch off by
  // default, vercel/next.js#98684; see that file). The public site keeps next/link.
  {
    files: [
      "src/app/(private)/**/*.{ts,tsx}",
      "src/components/{admin,alpha,app-shell,auth,push,research}/**/*.{ts,tsx}",
    ],
    ignores: ["src/components/alpha/link.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [{ name: "next/link", message: "Private screens import Link from @/components/alpha/link (prefetch off, vercel/next.js#98684)." }] },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Design handoff prototype runtime (reference only, not production code).
    "docs/**",
    // Playwright output.
    "test-results/**",
    "playwright-report/**",
    "blob-report/**",
  ]),
]);

export default eslintConfig;
