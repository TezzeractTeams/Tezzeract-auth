import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

/**
 * Lint rules, focused on the mistakes that matter in a service that handles
 * passwords and signs tokens rather than on style, which Prettier owns.
 */
export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // A forgotten await on a credential check or a revocation is a security
      // bug, not a style issue.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      // `any` erases the contract types this service is built around.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      // Debug output is how secrets reach logs.
      "no-console": "error",
      eqeqeq: ["error", "always"],
      "no-eval": "error",
      "no-implied-eval": "error",
      "prefer-const": "error",
    },
  },
  {
    // React rules apply to the frontend only.
    files: ["web/src/**/*.{ts,tsx}", "ui/*.tsx"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Rendering a value as HTML on the origin that handles passwords is the
      // one XSS that matters most here.
      "react/no-danger": "off",
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message:
            "dangerouslySetInnerHTML is forbidden in the auth frontend; render text, not markup.",
        },
      ],
    },
  },
  {
    // Config and build files run in Node and are not part of a tsconfig.
    files: ["*.config.js", "**/*.config.js", "ui/tailwind-preset.js"],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // Tests assert on loosely typed fixtures and provider internals.
    files: ["**/test/**/*.ts", "**/test/**/*.tsx", "**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      // `vi.fn(async () => value)` is how an async interface is stubbed; the
      // mock has to return a promise whether or not it awaits anything.
      "@typescript-eslint/require-await": "off",
      // `expect(api.login).toHaveBeenCalled()` reads a method off its object
      // by design.
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "no-console": "off",
    },
  },
);
