# Nihongo repository instructions

## Product guardrails

- Build a Korean-first JLPT learning service with Japanese question text where
  appropriate.
- Do not implement listening exercises in the MVP.
- Never copy real JLPT exams or commercial textbook questions. Use original
  dummy questions and explanations only.
- Keep the MVP focused. Do not add AI question generation, payments, community,
  or native-app features unless the user explicitly expands the scope.

## Technical baseline

- Use Next.js App Router, React, and strict TypeScript.
- Use Tailwind CSS and reusable UI primitives; use shadcn/ui when it fits the
  existing project.
- Use Zustand for shared client workflow state and TanStack Query for client
  server-state caching only when it is actually needed.
- Use Prisma with SQLite for local development and keep the schema portable to
  PostgreSQL.
- Use Zod at untrusted runtime boundaries. Use React Hook Form for non-trivial
  forms when it reduces duplicated state and validation code.
- Respect the existing package manager and lockfile. If the project has no
  package-manager convention yet, prefer pnpm.
- Preserve installed versions and established structure unless the requested
  change requires a migration.

## Required skill routing

- Use `.agents/skills/frontend-guidelines/SKILL.md` for routes, layouts,
  components, hooks, providers, accessibility, responsive UI, or Zustand state.
- Use `.agents/skills/api-guidelines/SKILL.md` for route handlers, server
  actions, API clients, Prisma boundaries, Zod schemas, TanStack Query, errors,
  or MSW mocks.
- Use `.agents/skills/code-formatting/SKILL.md` for lint, formatting, config, or
  final code-quality verification.
- Read only the references linked by the selected skill and relevant to the
  current task.

## Always-on code rules

- Inspect the current repository before introducing folders or dependencies.
- Prefer the configured `@/` alias. Avoid deep relative imports.
- Use `import type` for type-only imports.
- Do not introduce `any`; narrow `unknown` or validate input instead.
- Define component props with `type`. Use `interface` for extensible domain
  object contracts when that distinction is useful.
- Keep Server Components as the default and add `"use client"` only at the
  smallest necessary boundary.
- Do not introduce Vite entrypoints, React Router, `main.tsx`, or application
  `router.tsx` files into this Next.js project.
- Reuse existing components and modules before creating new abstractions.
- Include loading, error, empty, keyboard, and responsive states in the scope of
  user-facing work.
- Run the relevant format, lint, typecheck, test, and production build scripts
  exposed by `package.json` before handoff.

