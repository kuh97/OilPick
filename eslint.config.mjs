import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "test-results/**",
    "next-env.d.ts",
    "scripts/**",
  ]),

  // ── 전역 any 금지 ────────────────────────────────────────────────────────
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },

  // ── domain/ 레이어 경계 (AGENTS.md §17.1) ────────────────────────────────
  // no-restricted-imports 는 개별 경로 패턴 배열 대신 paths/patterns 방식
  {
    files: ["src/domain/**/*.ts", "src/domain/**/*.tsx"],
    rules: {
      // Date.now() / new Date() 직접 호출 금지
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: "domain/ 에서 Date.now()를 쓰지 마십시오. 시각은 인자로 받으십시오 (AGENTS.md §7.1).",
        },
        {
          selector: "NewExpression[callee.name='Date']:not([arguments.length])",
          message: "domain/ 에서 new Date()를 쓰지 마십시오. 시각은 인자로 받으십시오 (AGENTS.md §7.1).",
        },
      ],
      // fetch / next 등 외부 의존 금지
      "no-restricted-globals": [
        "error",
        {
          name: "fetch",
          message: "domain/ 에서 fetch를 쓰지 마십시오 (AGENTS.md §7.1).",
        },
      ],
    },
  },

  // ── components/ — 직접 fetch 금지 ─────────────────────────────────────────
  {
    files: ["src/components/**/*.ts", "src/components/**/*.tsx"],
    rules: {
      "no-restricted-globals": [
        "error",
        {
          name: "fetch",
          message: "components/ 에서 fetch를 직접 호출하지 마십시오. lib/api/ 훅을 사용하십시오 (AGENTS.md §7.5).",
        },
      ],
    },
  },
]);

export default eslintConfig;
