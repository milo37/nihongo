#!/usr/bin/env node
// PreToolUse(Bash) hook: block `gh issue create` / `gh pr create` that skip the repository templates.
// Exit 2 sends the message back to Claude so it can fix the title/body and retry.
import { readFileSync } from 'node:fs'
import process from 'node:process'

const input = JSON.parse(readFileSync(0, 'utf8'))
const command = input.tool_input?.command ?? ''
// Only a `gh` invocation in command position counts (start, after `&&` `||` `;` `|` `(` or a
// newline, optionally after `VAR=value` prefixes), so `grep 'gh pr create' …` passes through.
const ghCreate = (kind) =>
  new RegExp(
    `(?:^|&&|\\|\\||[;|(\\n])\\s*(?:[A-Za-z_][A-Za-z0-9_]*=\\S*\\s+)*gh\\s+${kind}\\s+create\\b`
  ).test(command)
const isIssue = ghCreate('issue')
const isPr = ghCreate('pr')
if (!isIssue && !isPr) process.exit(0)

const quotedPath = `("([^"]+)"|'([^']+)'|([^\\s;&|)]+))`
const pathOf = (match) => match && (match[2] ?? match[3] ?? match[4])
const bodyFile = command.match(new RegExp(`--body-file[=\\s]+${quotedPath}`))
let text = command
if (bodyFile) {
  let path = pathOf(bodyFile)
  // `--body-file -` reads stdin: a heredoc is already in the command text; otherwise follow
  // `< file` or `cat file |`.
  if (path === '-')
    path =
      pathOf(command.match(new RegExp(`(?:^|\\s)<(?!<)\\s*${quotedPath}`))) ??
      pathOf(command.match(new RegExp(`\\bcat\\s+${quotedPath}\\s*\\|`)))
  if (path) {
    try {
      text += '\n' + readFileSync(path, 'utf8')
    } catch {
      // Unreadable body file: check the command text only.
    }
  }
}
const title = command.match(
  /(?:^|\s)(?:--title|-t)[=\s]+("((?:[^"\\]|\\.)*)"|'([^']*)')/
)
const titleText = title
  ? (title[2]?.replace(/\\(.)/g, '$1') ?? title[3] ?? '')
  : ''

const problems = []
if (isPr) {
  if (!/^\[(FE|BE|CI|계약|디자인|문서|통합)\] \S.* \(#\d+\)$/.test(titleText))
    problems.push(
      'PR 제목은 `[영역] 변경 내용 (#이슈번호)` 형태입니다. 영역: FE, BE, CI, 계약, 디자인, 문서, 통합'
    )
  if (!/Refs #\d+/.test(text))
    problems.push('PR 본문 첫 줄에 `Refs #이슈번호`가 필요합니다.')
  for (const h of ['## 변경', '## 검증', '## 남은 일'])
    if (!text.includes(h))
      problems.push(`PR 본문에 \`${h}\` 항목이 필요합니다.`)
  if (
    /\b(Closes|Fixes|Resolves) #\d+/i.test(text) &&
    !/(?:--base|-B)[=\s]+main\b/.test(command)
  )
    problems.push(
      'dev 대상 PR에는 Closes/Fixes를 쓰지 않습니다. `Refs #번호`를 씁니다.'
    )
}
if (isIssue) {
  if (/^\s*\[/.test(titleText))
    problems.push(
      '이슈 제목에 `[JLP-…]`, `[P0]` 같은 접두어를 붙이지 않습니다.'
    )
  const task = ['### 왜', '### 할 일', '### 완료 조건'].every((h) =>
    text.includes(h)
  )
  const bug = ['### 증상', '### 재현 방법', '### 기대 동작'].every((h) =>
    text.includes(h)
  )
  if (!task && !bug)
    problems.push(
      '이슈 본문은 템플릿 항목을 씁니다. 작업: `### 왜` `### 할 일` `### 완료 조건` / 버그: `### 증상` `### 재현 방법` `### 기대 동작`'
    )
}

if (problems.length) {
  process.stderr.write(
    [
      'GitHub 템플릿 형식이 아닙니다 (.github/ISSUE_TEMPLATE, .github/pull_request_template.md):',
      ...problems.map((p) => `- ${p}`)
    ].join('\n') + '\n'
  )
  process.exit(2)
}
