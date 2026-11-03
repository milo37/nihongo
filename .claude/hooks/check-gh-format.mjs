#!/usr/bin/env node
// PreToolUse(Bash) hook: block `gh issue create` / `gh pr create` that skip the repository templates.
// Exit 2 sends the message back to Claude so it can fix the title/body and retry.
import { readFileSync } from 'node:fs'

const input = JSON.parse(readFileSync(0, 'utf8'))
const command = input.tool_input?.command ?? ''
const isIssue = /\bgh\s+issue\s+create\b/.test(command)
const isPr = /\bgh\s+pr\s+create\b/.test(command)
if (!isIssue && !isPr) process.exit(0)

const bodyFile = command.match(/--body-file[=\s]+("([^"]+)"|'([^']+)'|(\S+))/)
let text = command
if (bodyFile) {
  const path = bodyFile[2] ?? bodyFile[3] ?? bodyFile[4]
  try {
    text += '\n' + readFileSync(path, 'utf8')
  } catch {
    // Unreadable body file: check the command text only.
  }
}
const title = command.match(/(?:--title|-t)[=\s]+("([^"]*)"|'([^']*)')/)
const titleText = title ? (title[2] ?? title[3] ?? '') : ''

const problems = []
if (isPr) {
  if (!/^\[(FE|BE|CI|계약|디자인|문서|통합)\] \S/.test(titleText))
    problems.push(
      'PR 제목은 `[영역] 변경 내용` 형태입니다. 영역: FE, BE, CI, 계약, 디자인, 문서, 통합'
    )
  if (!/Refs #\d+/.test(text))
    problems.push('PR 본문 첫 줄에 `Refs #이슈번호`가 필요합니다.')
  for (const h of ['## 변경', '## 검증', '## 남은 일'])
    if (!text.includes(h))
      problems.push(`PR 본문에 \`${h}\` 항목이 필요합니다.`)
  if (
    /\b(Closes|Fixes|Resolves) #\d+/i.test(text) &&
    !/--base[=\s]+main\b/.test(command)
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
  console.error(
    [
      'GitHub 템플릿 형식이 아닙니다 (.github/ISSUE_TEMPLATE, .github/pull_request_template.md):',
      ...problems.map((p) => `- ${p}`)
    ].join('\n')
  )
  process.exit(2)
}
