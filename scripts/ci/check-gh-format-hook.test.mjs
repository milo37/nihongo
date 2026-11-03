import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const hook = path.resolve(
  import.meta.dirname,
  '../../.claude/hooks/check-gh-format.mjs'
)
const runHook = (command) =>
  spawnSync(process.execPath, [hook], {
    input: JSON.stringify({ tool_input: { command } }),
    encoding: 'utf8'
  }).status

const body = 'Refs #67\n\n## 변경\n- a\n\n## 검증\n- b\n\n## 남은 일\n- 없음\n'
const title = "--title '[CI] 훅 오탐 수정 (#67)'"

test('PR format hook keeps blocking malformed creates', () => {
  assert.equal(runHook(`gh pr create --title '[CI] x' --body 'Refs #67'`), 2)
  assert.equal(runHook(`cd repo && gh pr create ${title} --body 'x'`), 2)
  assert.equal(runHook(`gh pr create ${title} --body '${body}Closes #67'`), 2)
  assert.equal(runHook(`gh issue create --title '[P0] x' --body 'x'`), 2)
  assert.equal(runHook(`gh pr create ${title} --body '${body}'`), 0)
})

test('PR format hook ignores commands that only mention gh create', () => {
  for (const command of [
    "grep -rn 'gh pr create' team/",
    'rg "gh issue create" .claude',
    'echo gh pr create',
    'gh pr view 487'
  ])
    assert.equal(runHook(command), 0, command)
  assert.equal(runHook(`git status; gh pr create ${title} --body 'x'`), 2)
  assert.equal(runHook(`GH_PAGER= gh pr create ${title} --body 'x'`), 2)
})

test('PR format hook reads stdin bodies, -B main and escaped title quotes', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'gh-format-hook-'))
  try {
    const file = path.join(directory, 'body.md')
    writeFileSync(file, body)
    assert.equal(
      runHook(`gh pr create ${title} --body-file - <<'EOF'\n${body}EOF`),
      0
    )
    assert.equal(runHook(`gh pr create ${title} --body-file - < ${file}`), 0)
    assert.equal(
      runHook(`cat ${file} | gh pr create ${title} --body-file -`),
      0
    )
    assert.equal(runHook(`gh pr create ${title} --body-file "${file}"`), 0)
    assert.equal(runHook(`gh pr create ${title} --body-file -`), 2)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
  const closes = `--body '${body}Closes #67'`
  assert.equal(runHook(`gh pr create -B main ${title} ${closes}`), 0)
  assert.equal(runHook(`gh pr create --base=main ${title} ${closes}`), 0)
  assert.equal(runHook(`gh pr create -B dev ${title} ${closes}`), 2)
  assert.equal(
    runHook(
      `gh pr create --title "[CI] \\"따옴표\\" 제목 (#67)" --body '${body}'`
    ),
    0
  )
})
