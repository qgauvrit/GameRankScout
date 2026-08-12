import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // `.wrangler/` is the Worker runtime's own scratch: `wrangler dev` bundles
    // the entrypoint and its dependencies into it, so linting it reports
    // hundreds of errors in other people's code — and only ever after someone
    // has run the dev server, which is exactly when they need lint to work.
    // Git ignores it for the same reason.
    // `src/app/theme.generated/` is emitted by `npm run build:theme` (the
    // Astryx CLI) and carries a "do not edit manually" header — it is the built
    // form of src/app/theme.ts, not authored source. Linting generated JS/d.ts
    // reports on code no one hand-writes.
    ignores: [
      'dist/**',
      'node_modules/**',
      'data/**',
      'coverage/**',
      'dev-dist/**',
      '.wrangler/**',
      'src/app/theme.generated/**',
    ],
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
