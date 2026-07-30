import tseslint from "typescript-eslint";

// ESLint 10 uses flat config only. The previous .eslintrc.js format was silently
// dead: eslint 10 could not read it, and CI hid the failure behind `|| true`.
export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      // Prisma output. Generated code is not ours to lint.
      "src/generated/**",
    ],
  },

  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // Only for loose JS config files. Anything already listed in
          // tsconfig.json's "include" must NOT appear here.
          allowDefaultProject: ["*.js", "*.mjs"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Unused args are allowed only when explicitly underscore-prefixed,
      // which keeps Express middleware signatures honest.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // A floating promise in a request handler is a dropped error.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/require-await": "error",
      "@typescript-eslint/await-thenable": "error",
      // Prevents `any` from leaking back in during the port.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },

  {
    // Seeds and one-off scripts are CLI tools. Printing progress is the point.
    files: ["prisma/**/*.ts"],
    rules: {
      "no-console": "off",
    },
  },

  {
    // Tests may lean on loose typing for fixtures and mocks.
    files: ["**/*.test.ts", "**/__tests__/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
    },
  },
);
