---
name: api-guidelines
description: Apply the Nihongo Axios, Zod, MSW, TanStack Query, error handling, and Mock Repository conventions. Use when changing endpoint schemas, API functions, mock handlers, query factories, domain data hooks, cache invalidation, or demo authentication.
---

# API guidelines

## Workspace scope

The replaceable client API boundary lives under `apps/web/src`. Paths written
as `src/` below are relative to `apps/web`; this skill does not authorize an
`apps/api` backend.

## Prepare

1. Inspect `src/api/config.ts`, `src/api/http.ts`, the relevant endpoint folder,
   Query Factory, domain hooks, MSW handler, and Mock Repository method.
2. Read [API patterns](references/api-patterns.md) before changing a transport
   boundary, response contract, cache key, or mutation.
3. Preserve the replaceable API boundary; never let UI depend on Mock data.

## Implement

- This MVP has no real backend, Prisma, database, route handler, Server Action,
  or server component. Use Axios against MSW through the existing API layer.
- Every endpoint has `index.ts` and `schema.ts`. Validate request data and every
  response payload with strict Zod schemas and export `z.infer` types.
- Keep `config.ts` and `http.ts` acyclic. `config.ts` owns Axios, interceptors,
  error flags, and generic `safeFactory`; `http.ts` owns raw and safe HTTP verbs.
- Validate `response.data`, never the AxiosResponse wrapper. Response schema
  failure throws status 422 with `isValidationError`.
- Interceptors classify errors but never navigate, render UI, toast, or alert.
  Query and Mutation errors flow through the global error provider.
- Components call domain hooks only. Domain hooks call Query Factories; Query
  Factories call endpoint functions. Hooks and components never import mocks.
- Query keys start with `allKey()`. Include entity, operation, ID, and normalized
  params. Invalidate related list and detail keys after mutations.
- Invalidate bookmark, wrong-note, dashboard, and admin caches together when a
  mutation affects those domains. Run independent invalidations in parallel.
- Use Mock Repository methods as the single mutation boundary. Keep Map indexes
  in memory, load persisted JSON once, and sync memory plus localStorage on
  mutation.
- Return ISO 8601 strings for dates and minimal payloads for each screen.

## Verify

- Exercise success, validation, auth, forbidden, not-found, empty, network, and
  offline behavior relevant to the change.
- Confirm public practice responses contain no answer or explanation fields.
- Confirm role changes clear user-scoped Query cache and guest sessions have a
  null user ID.
- Run tests, typecheck, lint, format, and build.

