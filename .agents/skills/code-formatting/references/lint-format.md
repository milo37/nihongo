# Lint and format baseline

Use this only when the repository has no existing convention or when updating
configuration is explicitly in scope.

## ESLint baseline

- Use the framework's supported flat ESLint configuration.
- Enable Next.js core-web-vitals and TypeScript rules for a Next.js project.
- Enable React Hooks rules.
- Enable TanStack Query rules when TanStack Query is installed.
- Treat unused imports as errors.
- Ignore intentionally unused variables or parameters only when prefixed `_`.
- Disable React prop-types when TypeScript owns prop validation.
- Disable legacy React-in-JSX-scope rules for the modern JSX transform.
- Keep `no-explicit-any` enabled. This resolves the source rules' conflict in
  favor of the stricter project-wide type-safety requirement.
- Ignore generated output such as `.next`, `dist`, `build`, `coverage`, and
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

