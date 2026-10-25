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

- 정본은 team/git-workflow.md이며 요약은 team/README.md입니다. 이 worktree의 Current writer만 읽고 task별 cwd·branch·base·파일 소유권을 확인합니다. Munder가 task·담당·다음 행동·근거를 관리하고 Notion은 기존 god 담당의 단방향 mirror입니다.
- 상시 브랜치는 main과 dev입니다. 일반 작업은 최신 dev에서 단기 feature/fe-jlp-ID-topic, feature/be-jlp-ID-topic, feature/devops-jlp-ID-topic 또는 fix/<role>-jlp-ID-topic으로 시작합니다. 작업 PR→dev는 squash, dev PR→main은 merge commit입니다. main에서 hotfix 등 별도 실제 변경이 생긴 경우에만 dev로 merge 동기화합니다.
- FE는 apps/web, BE는 apps/api·domain과 FE와 합의한 contracts, DevOps는 배정된 CI·운영을 맡습니다. 공유 계약·여러 영역도 한 task·작업 브랜치·PR에서 범위·owner와 writer 차례를 합의합니다. root runtime·의존성·lockfile·버전·콘텐츠·provisioning 담당은 명시합니다.
- God가 단일 공통 Git 실행자를 지정하고 worktree마다 source writer 한 명을 유지합니다. Git 쓰기는 해당 턴에 명시된 지정 실행자만 수행하며 source 작성권한을 commit·push·PR·branch·protection 변경 허가로 확대하지 않습니다. 기존 역할과 동시 기여자 한도를 유지하고 배정 없이 직원·temps·하위 위임을 추가하지 않습니다.
- 승인된 작업 브랜치의 작은 checkpoint·normal push·Draft PR은 최종 QA·실화면·real API·전체 CI 완료 전에도 허용합니다. WIP의 실패·미실행·남은 문제를 명시하고 제품 완료로 표시하지 않습니다. QA와 팀장은 PR 생성·갱신 즉시 리뷰를 시작하고 완료 PR은 검수·CI 충족 후 지체 없이 처리합니다.
- 병합은 독립 QA·팀장 검토·해당 UI/계약 검수와 현재 required CI 성공 후 지정 Git 실행자가 수행합니다. 기존 세 required CI를 유지합니다. 같은 계정 AI팀 PR에 native 자기 PR APPROVE를 요구하지 않으며, 외부 계정 PR은 작성자와 다른 write/admin 계정의 실제 승인 1건을 추가합니다. 운영 정책과 실제 GitHub enforcement를 구분합니다.
- main·dev 직접 push와 force push는 금지합니다. 원본 dirty checkout·다른 담당의 source/index/worktree·사용 중 서비스·DB·볼륨·.env를 보존하고 광범위 staging·reset·clean·stash·무단 삭제·credential/approval 우회를 하지 않습니다. 수용·미병합 작업·의존·사용 여부를 확인한 단기 브랜치만 지정 실행자가 정리합니다.
- 긴급 수정은 최신 main 기준 fix에서 main PR로 수용한 뒤 즉시 dev로 merge 동기화합니다. root package.json.version이 단일 제품 SemVer이며 0.x 기능은 minor·버그는 patch, 1.x 호환성 파괴는 major입니다. 미배포 기능이 main에 있으면 포함 전체 변경으로 판단합니다. 실제 배포할 main 커밋에 tag를 연결하고 main 병합과 배포를 구분합니다. 이번 정책 정리에서 버전·tag·배포를 변경하지 않습니다.
- 실제 cwd/base/head·구현 commit·PR·검사·실패·미실행과 다음 담당을 기록하고 writer를 반납합니다. 기준 SHA를 구현 commit으로 표시하지 않습니다. 실제 Staging/Production 실행에는 승인된 환경·담당·입력이 별도로 필요합니다.
