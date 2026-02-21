import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['**/dist/**', '**/node_modules/**', 'examples/**'],
  },
  {
    files: ['packages/agent/src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['@solana/kit', '@solana/*'], message: 'Agent package cannot import Solana SDK directly — use @autarch/core' },
          { group: ['@scure/*', 'micro-key-producer*'], message: 'Agent package cannot import crypto libraries — use @autarch/core' },
          { group: ['node:crypto', 'crypto', 'tweetnacl', 'tweetnacl-util', '@noble/*', 'elliptic', 'bn.js', 'ed2curve'], message: 'Agent package cannot import crypto libraries — use @autarch/core' },
        ],
      }],
    },
  },
  {
    files: ['packages/demo/src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['@solana/kit', '@solana/*'], message: 'Demo package cannot import Solana SDK directly' },
          { group: ['@scure/*', 'micro-key-producer*'], message: 'Demo package cannot import crypto libraries' },
          { group: ['node:crypto', 'crypto', 'tweetnacl', 'tweetnacl-util', '@noble/*', 'elliptic', 'bn.js', 'ed2curve'], message: 'Demo package cannot import crypto libraries' },
        ],
      }],
    },
  },
);
