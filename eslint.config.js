import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // The engine must stay deterministic: no wall-clock time or Math.random.
    files: ['engine/src/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded Rng in engine/src/rng.ts.' },
        {
          object: 'Date',
          property: 'now',
          message: 'The engine has no wall clock; use game ticks.',
        },
        {
          object: 'performance',
          property: 'now',
          message: 'The engine has no wall clock; use game ticks.',
        },
      ],
    },
  },
);
