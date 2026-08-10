# API and server-state patterns

## Required flow

```text
component
  → domain custom hook
  → Query Factory
  → src/api/<singular-domain>/<verbNoun>/index.ts
  → safeGet / safePost / safePut / safeDel
  → Axios
  → MSW handler
  → MockDatabase
```

No component or domain hook may bypass this flow.

## Endpoint folder

```text
src/api/study/createStudySession/
├── index.ts
└── schema.ts
```

`schema.ts` owns strict request and response schemas plus inferred types.
`index.ts` parses input, composes a safe HTTP method with the response schema,
and returns the validated DTO.

## Acyclic HTTP core

`config.ts` owns:

- `apiClient`
- timeout and headers
- request and response interceptors
- `ApiErrorFlags` and `isApiError`
- generic `safeFactory(method)`

`config.ts` must not import `http.ts`.

`http.ts` imports `apiClient` and `safeFactory`, returns `response.data` from
raw verbs, and exports schema-bound safe verbs. `safeFactory` accepts an async
method generically; it never imports a concrete HTTP verb to infer its type.

## Error ownership

The normalized error flags are:

- `isAuthError`
- `isForbiddenError`
- `isNotFoundError`
- `isServerError`
- `isNetworkError`
- `isOffline`
- `isValidationError`
- `status`

Interceptors only classify. QueryClient publishes Query and Mutation failures;
`AuthErrorHandlerProvider` owns redirect and accessible user feedback. A 404 is
normally rendered by the affected domain page instead of forcing global
navigation.

## Query Factory

```ts
export const entityQueries = {
  allKey: () => ['entity'] as const,
  list: (params: ListParams) =>
    queryOptions({
      queryKey: [...entityQueries.allKey(), 'list-entities', params] as const,
      queryFn: () => listEntity(params)
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: [...entityQueries.allKey(), 'get-entity', id] as const,
      queryFn: () => getEntity(id),
      enabled: id.length > 0
    })
} as const
```

Components use `useListEntities` or `useGetEntity`, not Query primitives or the
factory directly.

## Mutation cache rules

- Create: invalidate the relevant list.
- Update: update/invalidate detail and invalidate lists.
- Delete: remove detail and invalidate lists.
- Study submit: set result and invalidate session, wrong-note, dashboard.
- Admin update/delete: invalidate admin plus affected bookmark, wrong-note, and
  dashboard caches.
- Auth role change/logout: remove user-scoped Query data before rendering the
  next role.

Use `Promise.all` for independent asynchronous invalidations when awaiting
their completion matters.

## Public practice DTO

Before submission, strip:

- correct option ID
- option `isCorrect`
- Korean and Japanese explanations
- admin publication fields

Submit validates session status, question IDs, option ownership, duplicate
answers, and elapsed values before returning a `StudyResult` with answers and
explanations.

