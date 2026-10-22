# Nihongo repository instructions

## Product guardrails

- Build 하루마루, a Korean-first JLPT N5-N1 practice and wrong-note service. This confirms only the Korean product name.
- The MVP covers vocabulary, grammar, and reading only. Do not add listening.
- Use original questions and explanations; never copy real JLPT or commercial materials.
- Keep the approved product scope focused: no payments, community, AI generation or OAuth without an applicable user request.
- The user has authorized the existing Vite/React web, Hono/Prisma/PostgreSQL API, shared contracts and domain architecture. Scope and ownership still come from god's current task; a roadmap is not execution authority.

## Workspace layout

- The repository root owns pnpm workspace orchestration, shared lint/format
  configuration, CI, and repository guidance.
- The active Vite application lives in `apps/web`. Paths written as `src/`,
  `public/`, or Vite config files in project guidance are relative to
  `apps/web` unless they are explicitly described as repository-root files.
- Do not create placeholder `apps/api` or `packages/*` projects. Existing authorized API/domain/contracts foundations are migrated as scoped reviewed dependencies; this document task adds no application code.

## Technical baseline

- Use Vite, React, strict TypeScript, React Router, Tailwind CSS, TanStack Query, Zustand, Axios, Zod, MSW, React Hook Form, and Vitest.
- Do not introduce Next.js, SQLite, Server Components, Server Actions or SWR. The authorized Hono/Prisma/PostgreSQL backend remains owned by BE.
- Preserve the approved Node22.23.0/pnpm10.2.1 execution baseline. Runtime upgrades are separate compatibility tasks; older main files' broad Node ranges are not changed by this document task.
- Server state flows through the real API or dev/test MSW -> API endpoint -> Query Factory -> domain hook -> component. Preserve mock/real modes and production real/fail-closed worker exclusion.
- Zustand owns client workflow/UI and the minimal authenticated-user projection. Server authentication/authorization is authoritative; do not mirror Query collections into Zustand or import server-only code/secrets into browser code.

## Required project guidance

- Read every .cursor/rules/\*.mdc file before changes.
- Discover repo-local skills under .cursor/skills/\*/SKILL.md and apply matching skills.
- Use matching `.agents/skills/*/SKILL.md` guidance for Codex work.
- Use `.agents/skills/graph/SKILL.md` only when the user explicitly invokes
  `$graph` or explicitly requests a multi-agent graph workflow.
- The Graph workflow must preserve the Vite, React Router, MSW, TanStack Query,
  Zustand, accessibility, and formatting rules in this repository.
- Keep one writer per assigned isolated worktree and one god-designated common Git metadata operator. The original dirty checkout preserves its single-writer rule and source/index. Explorer, reviewer and tester agents remain read-only for application source.
- Direct system, developer, and user instructions override repository guidance.

## Always-on code rules

- Use configured aliases for all `apps/web/src` imports; do not use relative imports inside the application source.
- Use import type for type-only imports and never introduce explicit any.
- Define component props with type and domain data contracts with interface where appropriate.
- Write application components as named arrow functions.
- Keep route modules lazy, avoid broad barrels, and do not mirror Query data in Zustand.
- Include loading, error, empty, keyboard, focus, responsive, and non-color status states.
- Run existing format/lint/typecheck/test/build checks appropriate to the changed scope. Only the sole writer runs scoped autofixes; document-only changes do not require unrelated DB/browser regression. Record failures and unavailable verification honestly.

## Approved Git and team workflow

- Read team/README.md, team/git-workflow.md and only this worktree's Current writer block. Munder owns current task/assignee/next action/evidence; Notion is its existing god-operated one-way mirror. Read TEAM_STATE/team verification when present.
- Standing main/frontend/backend and temporary role/topic feature/fix/release branches follow the canonical Git document. FE owns apps/web; BE owns apps/api/domain and agreed contracts; DevOps owns named CI/operations. Root runtime/deps/version/content and provisioning require explicit ownership/agreement.
- God assigns actual cwd/branch/base/files/dependencies. Reuse existing seven office roles; at most3contributors+god, no new employees/temps/nested workers. During JLP-496 DevOps alone executes Git. Original writer-state remains preserved; Munder/evidence lease and isolated acquired/released records coordinate the turn.
- Scoped JLP commit, normal task push and Draft PR may precede final QA/UI/real API/all CI/protection verification. They are WIP, not product completion. G1/G2 exact H/T/E/S require god·independent QA·relevant design; G3/G4 bind real integration, actual-success CI and final main/artifact compatibility.
- God owns final integration. Same-account role evidence is not native independent APPROVE; missing legal reviewer keeps main HOLD. Preserve actual protection; no direct main push/self-merge/force/bulk stage/stash/reset/clean/unauthorized deletion/credential or approval bypass.
- Preserve original303/index/phase11/PR1/user5173, existing DB/volumes/.env and archived/cancelled tasks. No accumulated110 bulk main merge. Record actual cwd/base/head/commit/PR/checks/failures/omissions and writer release; baseline SHA is not implementation commit.
- Root package version is the product single source under a named release owner; no bump in this task. Real Staging/Production still needs actual provider/account/domain/TLS/DB/secrets/mail/monitoring/owner and authorization; successful Git/CI is not deployment.
