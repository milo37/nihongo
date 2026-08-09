---
name: code-formatting
description: Apply and verify the Nihongo project's ESLint, Prettier, TypeScript, and import-formatting conventions. Use when adding or changing lint or format configuration, cleaning code style, resolving lint failures, reviewing formatting consistency, or completing implementation that changes TypeScript, React, or configuration files.
---

# Code formatting

## Apply existing configuration first

1. Inspect `package.json`, the lockfile, ESLint configuration, Prettier
   configuration, editor settings, and ignore files.
2. Do not replace an established working configuration with the reference
   baseline.
3. Read [lint and format baseline](references/lint-format.md) only when creating
   configuration or resolving an ambiguity.

## Code conventions

- Use two-space indentation and let the configured formatter decide wrapping.
- Prefer single quotes in TypeScript and JavaScript, while JSX attributes use
  double quotes.
- Use `import type` for type-only imports and remove unused imports.
- Do not introduce explicit `any`; narrow `unknown` or validate the value.
- Prefix intentionally unused parameters with `_` only when the linter allows
  that convention.
- Prefer named arrow components for application code when it does not conflict
  with a framework-required export or an established local convention.
- Keep formatting changes scoped. Do not mix repository-wide churn into a
  feature patch unless the user requests it.

## Verify

- Use scripts defined by the repository. Prefer `format`, `lint`, `typecheck`,
  `test`, and `build`; use fix scripts only when they are present.
- Run the formatter before the final lint/type/build pass.
- Fix actual warnings and errors rather than disabling rules locally without a
  documented reason.
- Report commands that could not run and the concrete blocker.

