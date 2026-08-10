---
name: frontend-guidelines
description: Apply the Nihongo Vite, React Router, TanStack Query, Zustand, accessibility, and responsive frontend conventions. Use when changing routes, pages, components, hooks, providers, client state, or UI behavior in JLPT Drill Note.
---

# Frontend guidelines

## Prepare

1. Read the closest `AGENTS.md`, every `.cursor/rules/*.mdc` file, and inspect
   `package.json`, `vite.config.ts`, `tsconfig.json`, and the existing `src` tree.
2. Read [architecture](references/architecture.md) before adding routes,
   providers, domain folders, hooks, or Zustand slices.
3. Preserve working project conventions instead of scaffolding a parallel app.

## Implement

- Use Vite, React, strict TypeScript, and React Router
  `createBrowserRouter`. Never introduce Next.js or server-only React patterns.
- Keep `src/router.tsx` as the root router and domain route modules under
  `src/app/<domain>/router.tsx`. Lazy-load route pages.
- Keep the provider dependency order `ReactQueryProvider → ToastProvider →
  ReactRouterProvider`. Authentication and global API errors run inside the
  root router layout.
- Use TanStack Query only through domain Query Factories and custom hooks. Do
  not mirror API data in Zustand.
- Use Zustand for demo auth, in-progress answers, current question, start time,
  optimistic bookmark state, and UI state. Persist only serializable client
  workflow state through the shared storage adapter.
- Use configured aliases for every `src` import, `import type` for type-only
  imports, arrow components, typed props, and no explicit `any`.
- Reuse common primitives before adding another button, form control, dialog,
  toast, loading, error, or empty-state implementation.
- Prefer semantic HTML and native controls. Maintain heading order, keyboard
  support, visible focus, labels, aria-live status, non-color state text,
  minimum touch targets, and reduced-motion support.
- Design mobile-first. Reading is vertical on mobile and two-column on desktop;
  tables may use a labelled horizontal scroll container.
- React Compiler is enabled. Do not add `memo`, `useMemo`, or `useCallback`
  without measured cost or a stable-reference requirement.

## Verify

- Confirm `src/App.tsx`, React Router bypasses, component-level API calls, and
  server data in Zustand were not introduced.
- Confirm loading, error, empty, keyboard, focus, responsive, and permission
  states relevant to the change.
- Run `pnpm run format`, `pnpm run lint:fix`, `pnpm run typecheck`,
  `pnpm run test`, and `pnpm run build` before handoff.

