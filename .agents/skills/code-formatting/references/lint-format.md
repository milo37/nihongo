# Lint and format baseline

Use this only when the repository has no existing convention or when updating
configuration is explicitly in scope.

## ESLint baseline

- Use ESLint flat configuration with TypeScript and React JSX runtime rules.
- Enable React recommended and React Hooks recommended-latest rules.
- Enable React Hooks rules.
- Enable TanStack Query rules when TanStack Query is installed.
- Treat unused imports as errors.
- Ignore intentionally unused variables or parameters only when prefixed `_`.
- Disable React prop-types when TypeScript owns prop validation.
- Disable legacy React-in-JSX-scope rules for the modern JSX transform.
- Keep `no-explicit-any` enabled. This resolves the source rules' conflict in
  favor of the stricter project-wide type-safety requirement.
- Ignore generated output such as `dist`, `.next`, `build`, `coverage`, and
  generated declaration files.

Do not copy a generic plugin matrix blindly. Install only plugins used by the
final configuration and keep versions compatible with the installed ESLint and
framework versions.

## Prettier baseline

When there is no existing Prettier configuration, use:

```js
export default {
  printWidth: 80,
  tabWidth: 2,
  useTabs: false,
  semi: false,
  singleQuote: true,
  trailingComma: 'none',
  bracketSpacing: true,
  jsxSingleQuote: false,
  arrowParens: 'always',
  endOfLine: 'lf',
  quoteProps: 'as-needed',
  htmlWhitespaceSensitivity: 'css',
  proseWrap: 'preserve'
}
```

Keep format scripts non-interactive and make them cover the repository paths
that are actually maintained.
