import globals from 'globals';
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default tseslint.config(
    {
        ignores: ['eslint.config.js', 'node_modules', 'dist', 'dist-bundle', 'release', 'scripts', 'vite.bundle.config.ts'],
        languageOptions: {
            sourceType: 'module',
            parserOptions: {
                parser: '@typescript-eslint/parser',
                tsconfigRootDir: __dirname
            },
            globals: {
                ...globals.browser
            }
        },
    },
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
);
