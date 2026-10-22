---
name: graph
description: >
  Explicit-use multi-agent workflow for complex research, implementation,
  testing, and independent review. Use only when the user invokes $graph or
  explicitly requests a graph or multi-agent workflow. Do not use for small,
  straightforward, or single-file changes.
---

# Graph workflow

## Operating principles

- Always read and follow the closest applicable `AGENTS.md`.
- Load only the repository skills relevant to the current task.
- This skill never overrides repository product or technical rules.
- Do not use subagents merely because they are available.
- Do not spawn nested subagents.
- Do not allow unbounded delegation.
- Do not let multiple agents edit the same worktree concurrently.
- Keep one implementation writer per assigned worktree and one named operator for common Git metadata. Preserve the original dirty checkout/index/5173.
- Explorer and reviewer agents are read-only.
- Tester agents may execute commands but must not modify source or config files.
- Never claim that a command, test, or review ran unless it actually ran.
- Do not expose hidden chain-of-thought.
- Return concise evidence, decisions, and results only.

## Stage 0: Decide whether a graph is warranted

Assess these signals before routing work to existing roles:

1. **Different expertise:** The task needs distinct perspectives such as
   investigation, implementation, security, testing, or content review.
2. **Parallelizable scope:** Independent files, domains, documents,
   competitors, or logs can be investigated concurrently.
3. **Different tools or permissions:** Read-only exploration, code changes,
   test execution, or external documentation require different permissions or
   tools.
4. **Repeated review failures:** A single review repeatedly misses facts,
   logic, regressions, or omissions.

Apply these decision rules:

- If no signal applies, complete the assigned task directly with its matching role.
- Do not use a graph for a small edit, a clear single-file change, a simple type
  error, or one or two CSS lines.
- Add only one necessary role per signal.
- Assign one to three non-overlapping read-only investigation angles to existing roles when needed.
- Never force the workflow to contain three roles.

When a graph is unnecessary, finish the authorized role scope directly. A brief rationale may use this format:

> 이 작업은 Graph로 나눌 필요가 없습니다.
> 이유: (해당 신호가 없는 이유)
> 권장 완료 조건: (검증 기준)

## Stage 1: Define the task contract

When a graph is warranted, the main agent must write a task contract containing:

- Objective
- In scope
- Out of scope
- Acceptance criteria
- Repository constraints
- Files or domains likely involved
- Required verification
- Open questions that repository inspection can resolve

Resolve questions through repository inspection instead of asking the user when
possible. Give every subagent the same contract. Do not pass the full
conversation or the main agent's intermediate reasoning. Pass only the request,
constraints, acceptance criteria, and relevant file information needed for the
assigned role.

## Classify the workflow

Choose one workflow:

- **Coding workflow:** implementation, bug fixes, refactoring, architecture,
  APIs, databases, tests, monorepo changes, or performance work.
- **Research/document workflow:** external research, competitor comparisons,
  technology decisions, plans, reports, or analysis without code changes.

When both apply, use the coding workflow and limit external research to a
separate explorer.

## Coding workflow

Run these stages in order:

1. Explore
2. Merge evidence
3. Implement
4. Review and test
5. Correct
6. Final verification

### Explore

Define non-overlapping investigation angles, such as:

- Current execution paths and related files
- Type, API, or database contracts and impact
- Tests and regression risks
- Official documentation or version constraints

Route necessary read-only investigation angles to god-designated existing roles in parallel when available. The graph_explorer guidance can be reused without creating new staff. Assign one angle to each investigator.

Require this output:

```markdown
## Evidence

- `path/to/file.ts:line` — verified fact
- `path/to/file.ts:line` — related call or dependency

## Risks

- risk — supporting file or command

## Unknowns

- unverified item — reason
```

Explorer rules:

- Discard claims without a file and line reference or exact symbol evidence.
- Cite external documentation with official sources.
- Do not modify code or implement a solution.
- Limit each result to 15 bullets.
- Do not overlap another explorer's assigned scope.

### Merge evidence

The main agent must:

- Remove duplicate and unsupported claims.
- Mark conflicts between findings.
- Prefer actual code over stale notes.
- Confirm the smallest file set needed for implementation.
- Connect evidence to each acceptance criterion.
- Omit raw dumps and irrelevant link lists from the implementation handoff.

### Implement

Use the existing assigned FE, BE or DevOps owner; the lead coordinates rather than becoming a full-stack implementer. Keep one writer per designated worktree and separate role/file boundaries. No new worker/temp is required. Give the implementer:

- The original request
- The task contract
- Merged evidence
- Files most likely to change
- Applicable repository skills and rules
- Acceptance criteria
- Verification commands

The implementer must:

- Re-read relevant files and direct dependencies before editing.
- Prefer actual code when it differs from exploration notes.
- Reuse the current repository structure and components.
- Avoid unnecessary dependencies and abstractions.
- Avoid out-of-scope refactoring.
- Preserve existing user changes.
- Return changed files and checks actually run.

### Review and test

After implementation, freeze the exact source/config diff and route independent review/testing to existing god-designated QA/review roles in parallel when available. Do not edit their frozen target.

Use `graph_reviewer` for review. Give it only the original request, task
contract, final diff, and changed files. Do not pass implementation intent or
self-assessment. The reviewer is read-only and must return:

```markdown
판정: 통과 | 수정필요

## 지적

1. [severity] `file:line` — 문제 — 근거 — 필요한 확인 또는 수정
```

Reviewer rules:

- Do not praise or rewrite the implementation.
- Prioritize correctness, security, regressions, missing requirements, and
  missing tests.
- Ignore cosmetic issues handled by automated formatting.
- Return at most five evidence-backed findings.
- Return `통과` without inventing findings when no issue exists.

Use `graph_tester` for verification. It must read `AGENTS.md` and
`package.json`, start with the smallest relevant check, and run applicable lint, typecheck, test and build. Document/role/skill changes use scoped format, TOML/Skill validation and do not require unrelated DB/browser regression. It may create build caches
and test artifacts but must not edit source or configuration, and must not run
auto-fix commands. Require this output:

```markdown
판정: 통과 | 실패 | 실행불가

## Commands

- `<command>` — exit code N

## Failures

- failure — related file or concise output

## Not run

- command — reason
```

### Correct

If review requires changes or testing fails, give the single implementation
agent only:

- The findings
- Failed commands and concise output
- Original acceptance criteria
- Allowed correction scope

Correct the reported scope before considering broader work. Do not start a new
large refactor. Re-review and rerun checks affected by the correction, preserving unaffected valid evidence. Allow at
most two correction loops.

After two failed loops, stop and report:

- Changes completed so far
- Remaining review findings
- Failed tests
- Decisions requiring human judgment

Never hide a failure or relabel it as a pass.

## Research/document workflow

Run these stages:

1. Select one to three non-overlapping research angles.
2. Run explorers in parallel.
3. Merge evidence notes.
4. Have a separate writer or the main agent draft the result.
5. Have an existing independent reviewer inspect the frozen target.
6. Correct no more than twice.

Require each research explorer to return:

```markdown
## Facts

- fact — source

## Unverified

- unverified claim — reason
```

Research explorer rules:

- Attach one source to every fact.
- Remove unsourced facts.
- Preserve citations for numbers, dates, and proper names.
- Do not copy long source passages.
- Return at most 15 bullets.

Writer rules:

- Use only the original request and merged facts.
- Add no external claim absent from the notes.
- Do not present unverified information as fact.
- Put missing information under `확인 필요`.
- Return only the requested deliverable body.

The independent reviewer must not praise or directly rewrite the result. It may report
at most five findings and must check only:

1. Claims unsupported by evidence
2. Changed numbers, dates, or names
3. Logical conflicts
4. Missing parts of the original request

## Delegation limits and fallback

- Maximum explorers: 3
- Writers: 1 per assigned worktree; common Git metadata operator: 1
- Concurrent contributors: at most3 plus god; no new employees/temps
- Reviewers: 1
- Testers: 1
- Correction loops: 2
- Nested subagents: prohibited
- Duplicate investigation scopes: prohibited
- Formal role-filling for simple tasks: prohibited
- Claiming unavailable subagent usage: prohibited

If subagents are unavailable, state:

> Subagent 기능을 사용할 수 없어 단일 Agent 흐름으로 전환했습니다.

The assigned matching role may finish its own scope using the same task contract and review criteria. The lead routes unassigned FE/BE work instead of switching roles. Record independent review as unexecuted when unavailable; do not claim parallel execution.

## Final output

For a coding workflow, use:

```markdown
## 결과

(사용자에게 필요한 결과)

## 변경 파일

- `path` — 변경 내용

## 검증

- `<command>` — 통과/실패/실행하지 않음

## Graph 실행 기록

- 분할 신호: ...
- Explorer: N개
- 구현 Agent: ...
- Reviewer: 통과/수정필요
- Tester: 통과/실패/실행불가
- 수정 루프: N회
- 확인 필요: 없음 또는 남은 항목
```

For a research/document workflow, use:

```markdown
[결과물]

---

조사 각도: ...
Explorer: N개
검사: 통과 또는 수정필요
수정 루프: N회
확인 필요: 없음 또는 남은 항목
```

## Approved office and Git coordination

Reuse the existing seven office roles under god's task/cwd/branch/file dispatch. Do not create employees, temps or nested workers. Role configuration is guidance, not proof of native loading or an always-running chat.

Follow [the canonical Git workflow](../../../team/git-workflow.md) for main/FE/BE/task/release targets, common source mapping, admission freeze, G1–G4 exact-head god/independent QA/relevant design/current actual-success CI, version/hotfix/rollback and staged migration. Same-account QA is not native independent approval. WIP commits/Draft PRs may precede final gates; god alone integrates.

Munder owns start/handoff/block/verification/completion and evidence; its existing god-operated Notion mirror is separate. Only the authorized mirror operator writes Notion. Preserve original dirty/index/phase11/5173 and Node22.23.0/pnpm10.2.1; new costs/permissions/credentials/deployment/DB operations require their actual task authority.
