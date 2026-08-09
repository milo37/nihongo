# API and server-state patterns

## Contents

1. Boundary selection
2. Folder ownership
3. Validation and transport
4. Errors
5. TanStack Query
6. Prisma
7. MSW

## Boundary selection

- Use a Server Component for render-time reads that do not need client-side
  caching or interactive refetching.
- Use a Server Action for authenticated mutations initiated by the application
  UI when that keeps the boundary simple.
- Use a Route Handler for HTTP endpoints, third-party callbacks, or consumers
  outside the current React tree.
- Use TanStack Query in Client Components for polling, optimistic updates,
  background refetching, client pagination, or shared client cache behavior.

## Folder ownership

Prefer feature ownership:

```text
src/features/<feature>/
├── api/
│   ├── index.ts                  # Feature endpoint functions
│   └── schema.ts                 # Request/response Zod schemas
├── hooks/                        # Client query/mutation hooks
└── queries/                      # Query-key and queryOptions factories
```

Put shared transport code in `src/lib/api` and shared Prisma access in
`src/lib/prisma.ts`. Do not create an endpoint-per-folder hierarchy unless the
number or complexity of endpoints justifies it.

Use singular lowercase domain names and verb-led operations:

- Reads: `getQuestion`, `listQuestions`, `searchQuestions`
- Creates: `createQuestion`
- Updates: `updateQuestion`
- Deletes: `deleteQuestion`

## Validation and transport

- Parse request bodies, route parameters, search parameters, form data, and
  external service payloads at their trust boundary.
- Do not re-parse values already produced by trusted typed domain functions.
- Infer TypeScript types from Zod schemas when the schema is authoritative.
- Return parsed data, not the raw HTTP response object.
- Configure timeouts and cancellation for external requests where appropriate.
- Keep `NEXT_PUBLIC_*` variables limited to values safe for browsers.

Avoid circular imports. A transport module may own its configured client and
request helpers, or helpers may receive a client dependency. Never implement
both `config -> http` and `http -> config` imports.

## Errors

Use one structured application error shape at the boundary:

```ts
export interface AppError {
  code: string
  message: string
  status: number
  fieldErrors?: Record<string, string[]>
}
```

- Map 401, 403, 404, 409, 422, rate-limit, network, and 500-class failures at a
  central boundary.
- Keep user notification and navigation decisions in the UI/provider layer.
- Do not call `alert` or log-and-rethrow in every endpoint hook.
- Preserve the original error as `cause` where it helps diagnostics without
  exposing secrets to the client.

## TanStack Query

- Build stable query keys from serializable inputs.
- Keep one root key per domain and derive detail/list/search keys from it.
- Use `queryOptions` when options must be reused between prefetching and hooks.
- Wrap query and mutation usage in feature hooks when it encodes reusable
  behavior; a one-off direct `useQuery` is acceptable when no abstraction value
  exists.
- Set `enabled`, `staleTime`, retry behavior, and cancellation deliberately.
- After creation, invalidate affected lists. After updates, update or invalidate
  detail and list keys. After deletion, remove detail data and invalidate lists.
- Prefer callbacks or application toast utilities over browser `alert`.

## Prisma

- Instantiate one development-safe Prisma client in `src/lib/prisma.ts`.
- Keep database calls in server-only modules.
- Select only fields required by the caller and avoid leaking internal columns.
- Use transactions for operations whose invariants span multiple writes.
- Add indexes and unique constraints for actual query and business invariants.
- Keep SQLite-compatible scalar design portable; document PostgreSQL-specific
  migrations when arrays, JSON indexes, or database-native features are added.

## MSW

- Keep handlers and fixtures under `src/mocks` or the owning feature test area.
- Start the browser worker only in development and the server worker only in
  tests that need it.
- Route UI through the same API boundary used with the real backend; components
  must not import mock data directly.
- Include representative success, validation, authentication, server-error,
  empty, and latency cases when they are relevant.

