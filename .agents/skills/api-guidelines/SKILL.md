---
name: api-guidelines
description: Apply type-safe API, Prisma, Zod, TanStack Query, error-handling, and MSW conventions for the Nihongo Next.js project. Use when creating or changing route handlers, server actions, database access, API clients, endpoint schemas, query factories, query or mutation hooks, cache invalidation, authentication errors, or mock API handlers.
---

# API guidelines

## Prepare

1. Inspect existing route handlers, server actions, Prisma helpers, API clients,
   schemas, and query conventions.
2. Read [API patterns](references/api-patterns.md) for the boundary being
   changed.
3. Preserve a working transport and folder structure unless the task includes a
   migration.

## Implement

- Keep Prisma and secrets server-only. Return serializable DTOs across the
  server/client boundary.
- Validate untrusted request input and external API responses with Zod.
- Prefer native `fetch` in Next.js. Keep Axios only when the project already
  uses it or interceptors provide a concrete benefit.
- Keep transport, parsing, and feature endpoint functions acyclic. Do not make
  client configuration and HTTP wrappers import each other.
- Model expected errors with stable status and code fields; do not rely on
  scattered boolean flags or UI alerts inside data hooks.
- Use Server Components for server-rendered reads. Use TanStack Query when
  client caching, polling, optimistic updates, or interactive refetching is
  needed.
- Centralize query-key factories and invalidate the narrowest affected keys
  after mutations.
- Keep feature API functions, schemas, query options, and hooks colocated with
  the feature unless they are genuinely shared.
- Use MSW only for intentional development/test mocks and never as the
  production source of truth.

## Verify

- Exercise validation failure, authentication failure, network failure, empty
  data, and successful mutation paths relevant to the change.
- Confirm no server-only dependency reached a Client Component bundle.
- Run relevant tests, typecheck, lint, format, and build.

