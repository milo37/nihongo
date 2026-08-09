---
name: frontend-guidelines
description: Apply this repository's Next.js App Router frontend architecture and React conventions. Use when creating or changing routes, layouts, pages, components, hooks, providers, client boundaries, accessibility, responsive behavior, TanStack Query providers, or Zustand stores in the Nihongo project.
---

# Frontend guidelines

## Prepare

1. Read the closest `AGENTS.md` and inspect `package.json`, `tsconfig.json`, and
   the existing `src` tree.
2. Read [architecture](references/architecture.md) before adding or moving
   routes, feature folders, providers, hooks, or stores.
3. Preserve a sound existing structure instead of mechanically scaffolding the
   reference tree.

## Implement

- Use App Router filesystem routing, layouts, route groups, dynamic segments,
  loading states, error boundaries, and not-found boundaries.
- Keep route files thin. Put reusable domain logic and UI under
  `src/features/<feature>` and cross-feature primitives in shared directories.
- Default to Server Components. Use Client Components only for browser APIs,
  event handlers, client context, or client state.
- Compose client-only global providers in one `AppProvider` mounted by the root
  layout. Order providers by actual dependency.
- Use TanStack Query for cached client server state and Zustand for shared
  client workflow state. Do not mirror the same source of truth in both.
- Use selectors when reading Zustand state and version persisted state.
- Prefer absolute `@/` imports and type-only imports. Keep dependency ownership
  visible and avoid barrels that create cycles.
- Keep components focused, give props explicit types, prefix custom hooks with
  `use`, and colocate feature hooks with their feature.
- Implement semantic headings, keyboard navigation, visible focus, accessible
  names, and non-color status indicators.
- Design mobile-first. Verify reading content, tables, forms, and quiz controls
  at narrow and desktop widths.

## Verify

- Confirm no Vite or React Router architecture was introduced.
- Confirm client boundaries and global state are no broader than necessary.
- Run the repository's relevant typecheck, tests, lint, format, and build.
- Report any intentional deviation from the project conventions.

