import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['build/', 'dist/', 'server/dist/', '.cache/', 'node_modules/'],
  },
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      "semi": "error",
      "eqeqeq": "error",
      "prefer-const": "warn",
      "no-console": "warn",
      "@typescript-eslint/explicit-function-return-type": ["warn", { "allowExpressions": true }],
      "@typescript-eslint/explicit-member-accessibility": "off",
      "@typescript-eslint/no-use-before-define": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { "args": "none" }],
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-namespace": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-function": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-inferrable-types": "off",
    },
  },
);
