import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const shaPattern = /^[a-f0-9]{40}$/u
const allowedRef =
  /^(?:refs\/heads\/(?:dev|main)|refs\/tags\/v[0-9]+\.[0-9]+\.[0-9]+)$/u

const fail = (code) => {
  throw new Error(code)
}

export const verifyCandidateSource = ({
  env,
  event,
  repositoryRoot,
  git = execFileSync
}) => {
  if (
    !['push', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME) ||
    !allowedRef.test(env.GITHUB_REF ?? '') ||
    (env.GITHUB_EVENT_NAME === 'push' &&
      !env.GITHUB_REF.startsWith('refs/tags/')) ||
    !shaPattern.test(env.GITHUB_SHA ?? '')
  ) {
    fail('CANDIDATE_SOURCE_EVENT_INVALID')
  }
  if (
    env.GITHUB_EVENT_NAME === 'push' &&
    (event?.ref !== env.GITHUB_REF || !shaPattern.test(event?.after ?? ''))
  ) {
    fail('CANDIDATE_SOURCE_EVENT_INVALID')
  }

  const resolveCommit = (revision) =>
    git('git', ['rev-parse', `${revision}^{commit}`], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      stdio: 'pipe'
    }).trim()
  let head
  let ref
  let source
  try {
    head = resolveCommit('HEAD')
    ref = resolveCommit(env.GITHUB_REF)
    source = resolveCommit(env.GITHUB_SHA)
  } catch {
    fail('CANDIDATE_SOURCE_RESOLUTION_FAILED')
  }
  if (
    !shaPattern.test(head) ||
    head !== ref ||
    head !== source ||
    head === '0'.repeat(40)
  ) {
    fail('CANDIDATE_SOURCE_MISMATCH')
  }

  if (env.GITHUB_EVENT_NAME === 'push') {
    let pushed
    try {
      pushed = resolveCommit(event?.after)
    } catch {
      fail('CANDIDATE_SOURCE_RESOLUTION_FAILED')
    }
    if (pushed !== head) fail('CANDIDATE_SOURCE_MISMATCH')
  }

  if (env.GITHUB_REF.startsWith('refs/tags/')) {
    const version = JSON.parse(
      readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8')
    ).version
    if (env.GITHUB_REF !== `refs/tags/v${version}`) {
      fail('CANDIDATE_TAG_VERSION_MISMATCH')
    }
  }

  const status = git(
    'git',
    ['status', '--porcelain', '--untracked-files=all'],
    { cwd: repositoryRoot, encoding: 'utf8', stdio: 'pipe' }
  ).trim()
  if (status) fail('CANDIDATE_SOURCE_DIRTY')
  return { releaseId: head, ref: env.GITHUB_REF }
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectExecution) {
  try {
    const repositoryRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../..'
    )
    const event = JSON.parse(
      readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')
    )
    const result = verifyCandidateSource({
      env: process.env,
      event,
      repositoryRoot
    })
    if (process.env.GITHUB_ENV) {
      appendFileSync(process.env.GITHUB_ENV, `RELEASE_ID=${result.releaseId}\n`)
    }
    process.stdout.write(
      `${JSON.stringify({ event: 'candidate.source.verified', ...result })}\n`
    )
  } catch (error) {
    const code =
      error instanceof Error && /^CANDIDATE_[A-Z0-9_]+$/u.test(error.message)
        ? error.message
        : 'CANDIDATE_SOURCE_FAILED'
    process.stderr.write(
      `${JSON.stringify({ event: 'candidate.source.failed', code })}\n`
    )
    process.exitCode = 1
  }
}
