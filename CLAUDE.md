@AGENTS.md

# Claude Code operation (migrated from Codex, 2026-11-02)

`AGENTS.md` above stays the canonical repository guide for every engine. This file only adds what differs in Claude Code.

## Where the Codex setup lives in Claude Code

- Repository skills: `.claude/skills/*` are symlinks to `.agents/skills/*` (canonical) and `.cursor/skills/*`. Edit the canonical folder, never the link.
- Role definitions: `.claude/agents/*.md` are generated from `.codex/agents/*.toml`. Keep both in sync when a role changes. Read-only roles (`graph-explorer`, `graph-reviewer`, `product-designer`) have no edit tools.
- Role sessions: each role (00 lead, 01 planning, 02 design, 03 frontend, 04 backend, 05 QA, 06 DevOps) runs as its own Claude Code session. Do not merge roles into one session. Give each session its role, Munder card, GitHub issue, allowed files, base SHA, checks, and next owner.

## Work tracking (latest user decision, overrides older Notion text)

- Use only GitHub issues (`milo37/nihongo`) and Munder (`/Users/doji/Desktop/docs/ai/jlpt-office/JLPT/hive/tasks.json`). Do not edit Notion or add it as a board, even where older documents or role prompts mention a Notion mirror.
- One GitHub issue ↔ one Munder card. Record owner, status, next action, and issue/PR links in Munder; record the Munder key, PR links, and a short status on the issue. Link instead of copying.
- PR bodies use `Refs #N`; never `Closes`/`Fixes`. One packet per branch per PR. Packets that pass independent QA and current-head CI go to `dev` right away.
- The designated owner closes an issue only after implementation, required regression, independent QA, and the required branch merge, with an evidence comment.

## Issue and PR format

- Issues follow `.github/ISSUE_TEMPLATE/` (task: `### 왜` `### 할 일` `### 완료 조건`; bug: `### 증상` `### 재현 방법` `### 기대 동작`). Titles are one short Korean line with no `[JLP-…]`/`[P0]` prefix.
- PRs follow `.github/pull_request_template.md`: title `[영역] 변경 내용 (#N)` (FE, BE, CI, 계약, 디자인, 문서, 통합), body starts with `Refs #N`, then `## 변경`, `## 검증`, `## 남은 일`.
- `.claude/hooks/check-gh-format.mjs` blocks `gh issue create`/`gh pr create` that skip this format.

## Guardrails

- Shared checkout: one writer, recorded in the top `Current` block of `team/writer-state.md`. Use separate worktrees for parallel, non-overlapping work.
- Never push directly to `main`, force push, bypass protection, merge unreviewed work, or delete unmerged branches/worktrees without the user.
- Do not modify applied migrations. Renaming or changing permissions of DB objects in use needs an impact and recovery plan and user confirmation first.
- Existing routine approvals (scoped implementation, checks, local isolated services, scoped commits, work-branch push, PRs) do not need re-asking. They do not extend to `bypassPermissions`, deployment, new cost, expanded access, or destructive actions.
- Keep Node `22.23.0` and pnpm `10.2.1`.
