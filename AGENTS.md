# Nihongo repository instructions

## Product guardrails

- Build JLPT Drill Note, a Korean-first JLPT N5-N1 practice and wrong-note service.
- The MVP covers vocabulary, grammar, and reading only. Do not add listening.
- Use only original dummy questions and explanations; never copy real JLPT or commercial materials.
- Keep the MVP focused: no payments, community, AI generation, OAuth, or real backend.

## Technical baseline

- Use Vite, React, strict TypeScript, React Router, Tailwind CSS, TanStack Query, Zustand, Axios, Zod, MSW, React Hook Form, and Vitest.
- Do not introduce Next.js, Prisma, SQLite, Server Components, Server Actions, SWR, or real server code.
- Use pnpm and Node LTS.
- Server state flows through MSW -> API endpoint -> Query Factory -> domain hook -> component.
- Zustand is only for client workflow, demo auth, and UI state.

## Required project guidance

- Read every .cursor/rules/\*.mdc file before changes.
- Discover repo-local skills under .cursor/skills/\*/SKILL.md and apply matching skills.
- Use matching `.agents/skills/*/SKILL.md` guidance for Codex work.
- Direct system, developer, and user instructions override repository guidance.

## Always-on code rules

- Use configured aliases for all src imports; do not use relative imports inside src.
- Use import type for type-only imports and never introduce explicit any.
- Define component props with type and domain data contracts with interface where appropriate.
- Write application components as named arrow functions.
- Keep route modules lazy, avoid broad barrels, and do not mirror Query data in Zustand.
- Include loading, error, empty, keyboard, focus, responsive, and non-color status states.
- Run format, lint:fix, typecheck, test, and build before handoff.
