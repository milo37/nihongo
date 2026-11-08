import eslint from '@eslint/js'
import tanstackQuery from '@tanstack/eslint-plugin-query'
import eslintConfigPrettier from 'eslint-config-prettier'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import unusedImports from 'eslint-plugin-unused-imports'
import globals from 'globals'
import tseslint from 'typescript-eslint'

const UNSAFE_HTML_MESSAGE =
  'Unsafe HTML or dynamic code in browser runtime source.'
const UNSAFE_HTML_SYNTAX = [
  'JSXAttribute[name.name="srcDoc"]',
  'Property[key.name=/^(?:dangerouslySetInnerHTML|srcDoc)$/]',
  'Property[key.value=/^(?:dangerouslySetInnerHTML|srcDoc)$/]',
  'MemberExpression[property.name=/^(?:innerHTML|outerHTML|srcDoc)$/]',
  'MemberExpression[property.value=/^(?:innerHTML|outerHTML|srcDoc)$/]',
  'CallExpression[callee.property.name=/^(?:insertAdjacentHTML|createContextualFragment)$/]',
  'CallExpression[callee.object.name="document"][callee.property.name=/^(?:write|writeln)$/]',
  'CallExpression[callee.property.name="setAttribute"][arguments.0.value=/^on/i]',
  'NewExpression[callee.name="DOMParser"]'
].map((selector) => ({ selector, message: UNSAFE_HTML_MESSAGE }))

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      'apps/web/public/mockServiceWorker.js'
    ]
  },
  {
    settings: { react: { version: '19.2' } }
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  react.configs.flat.recommended,
  react.configs.flat['jsx-runtime'],
  reactHooks.configs.flat['recommended-latest'],
  ...tanstackQuery.configs['flat/recommended'],
  eslintConfigPrettier,
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } }
    },
    plugins: { 'unused-imports': unusedImports },
    settings: { react: { version: '19.2' } },
    rules: {
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react/display-name': 'off',
      'react/function-component-definition': [
        'error',
        {
          namedComponents: 'arrow-function',
          unnamedComponents: 'arrow-function'
        }
      ],
      'prefer-arrow-callback': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_'
        }
      ]
    }
  },
  {
    // Unsafe HTML and dynamic code in browser runtime source (moved here from
    // the removed scripts/security/tracked-source-security.mjs, #603 O4-A).
    files: ['apps/{web,admin}/src/**/*.{ts,tsx}'],
    ignores: ['**/*.{test,spec}.{ts,tsx}', '**/test/**', '**/__tests__/**'],
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'react/no-danger': 'error',
      'no-restricted-syntax': ['error', ...UNSAFE_HTML_SYNTAX]
    }
  },
  {
    // U12 R12: no window.alert/confirm/prompt; use a dialog or a toast.
    files: [
      'apps/{web,admin}/src/**/*.{ts,tsx}',
      'packages/browser/src/**/*.{ts,tsx}'
    ],
    rules: { 'no-alert': 'error' }
  }
)
