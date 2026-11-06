import { createRequire } from 'node:module';
import { URL } from 'node:url';

const require = createRequire(new URL('./frontend/package.json', import.meta.url));
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['frontend/src/**/*.{ts,tsx}', 'src/**/*.ts'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
  },
);
