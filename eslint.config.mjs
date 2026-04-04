import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  {
    ignores: [
      ".next/**",
      "coverage/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
      "tests/**",
      "prisma/migrations/**",
      "thoughts/**",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
];

export default config;
