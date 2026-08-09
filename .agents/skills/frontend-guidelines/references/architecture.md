# Frontend architecture reference

## Contents

1. Structure
2. Adding a feature
3. Providers
4. Zustand
5. Imports and types

## Structure

Create only directories that have a real consumer.

```text
src/
├── app/                          # App Router routes and layouts
│   ├── (public)/                 # Optional public route group
│   ├── (protected)/              # Optional authenticated route group
│   ├── api/                      # Route handlers when needed
│   ├── layout.tsx
│   └── page.tsx
├── features/
│   └── <feature>/
│       ├── api/                  # Feature client/server boundary helpers
│       │   ├── index.ts
│       │   └── schema.ts         # Zod schemas when runtime validation is needed
│       ├── components/
│       ├── hooks/
│       ├── queries/              # TanStack Query factories/options
│       └── types.ts
├── components/
│   ├── layout/
│   └── ui/
├── hooks/                        # Cross-feature hooks only
├── lib/                          # Shared clients and utilities
├── mocks/                        # MSW setup and handlers when used
├── providers/                    # Client provider composition
├── store/
│   ├── slices/                   # Add when a combined store needs slices
│   └── index.ts
└── types/                        # Cross-feature types only
```

Do not add `main.tsx`, `createBrowserRouter`, React Router providers, or route
object files. App Router owns application routing.

## Adding a feature

1. Add its route segment under `src/app`.
2. Put feature-owned UI and logic under `src/features/<feature>`.
3. Colocate components, hooks, queries, API functions, and runtime schemas.
4. Promote code to a shared directory only after it has a real cross-feature
   consumer.
5. Add `loading.tsx`, `error.tsx`, or `not-found.tsx` at the narrowest useful
   route boundary.

## Providers

- Implement `src/providers/app-provider.tsx` as the smallest client boundary
  that composes required providers.
- Mount it from `src/app/layout.tsx` around `children`.
- Keep QueryClient creation stable per browser session.
- Enforce authentication and authorization on the server even if client context
  improves the UI.
- Do not create provider files until the corresponding capability exists.

## Zustand

- Use a small dedicated store for a single workflow.
- When several domains intentionally share one store, place slice creators in
  `src/store/slices` and combine them in `src/store/index.ts`.
- Define each slice contract explicitly and import `StateCreator` as a type.
- Select the smallest state fragment in components rather than subscribing to
  the entire store.
- Keep server-fetched entities in TanStack Query or Server Components, not in a
  parallel Zustand cache.
- Persist only reload-sensitive workflow state, include a storage version, and
  define migration behavior when the persisted shape changes.

## Imports and types

```ts
import { QuestionCard } from '@/features/practice/components/question-card'
import type { Question } from '@/features/practice/types'
import { api, type ApiResponse } from '@/features/practice/api'
```

- Use the repository's configured alias rather than inventing `@common` or
  `@api` aliases without tsconfig and tooling support.
- Use `type` for component props.
- Use `interface` for extensible domain object contracts when appropriate.
- Reject `any`. Validate or narrow external values from `unknown`.
- Prefer clear direct imports over barrels that hide ownership or cause cycles.

