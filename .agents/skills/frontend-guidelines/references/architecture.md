# Vite frontend architecture

## Ownership

```text
src/
├── api/                  # transport endpoint functions and Zod contracts
├── app/<domain>/         # route page, router, queries, hooks, components
├── common/               # cross-domain UI, hooks, types
├── libs/                 # QueryClient, error bus, storage adapter
├── mocks/                # MSW, original seed data, Mock Repository
├── provider/             # application providers and route guards
├── store/slices/         # serializable client-only Zustand slices
├── util/                 # framework-independent pure logic
├── main.tsx
└── router.tsx
```

Keep domain behavior with its route domain. Move a module to `common`, `libs`,
or `util` only when multiple domains genuinely share it.

## Router

`src/router.tsx` owns `createBrowserRouter`. The root element composes
`ProtectedRouteProvider`, `AuthErrorHandlerProvider`, and `Layout` with an
`Outlet`. Domain `router.tsx` files export small `RouteObject[]` collections and
lazy-load their page modules. USER and ADMIN guards wrap route groups; public
home, login, practice, session, and result routes remain accessible to guests.

## Providers

`src/provider/index.tsx` owns application provider order:

```text
ReactQueryProvider
  ToastProvider
    ReactRouterProvider
```

Do not create a second QueryClient or RouterProvider in application code.
Tests may provide isolated router contexts while reusing the test-reset
QueryClient.

## Server and client state

```text
MSW → API endpoint → Query Factory → domain hook → component
```

Components never import Axios, `fetch`, Query primitives, or Mock data.
Zustand never stores question lists, results, wrong-note responses, bookmark
lists, dashboard responses, or admin responses.

## Imports and components

- Use `@api`, `@app`, `@common`, `@provider`, `@store`, `@libs`, `@mocks`,
  `@util`, `@assets`, or `@/` aliases inside `src`.
- Avoid broad barrel exports and unstable package internals.
- Component props are `type`; extensible domain records may be `interface`.
- Components are named arrow functions. Custom hooks start with `use`.
- Use native radio, progress, dialog, table, input, select, and textarea
  semantics before custom ARIA roles.

## Practice behavior

- Practice payloads must not include answers, `isCorrect`, explanations, or
  admin status before submit.
- A single global keyboard listener handles 1–4 and arrow keys. Disable it in
  editable controls and while a modal is open.
- Persist in-progress answers and timing through the Zustand storage adapter.
- Submitted sessions redirect to their result instead of allowing resubmit.

