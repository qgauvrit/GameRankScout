import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // `.wrangler/` is the Worker runtime's own scratch: `wrangler dev` bundles
    // the entrypoint and its dependencies into it, so linting it reports
    // hundreds of errors in other people's code — and only ever after someone
    // has run the dev server, which is exactly when they need lint to work.
    // Git ignores it for the same reason.
    ignores: ['dist/**', 'node_modules/**', 'data/**', 'coverage/**', 'dev-dist/**', '.wrangler/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
);
