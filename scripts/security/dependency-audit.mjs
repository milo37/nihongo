import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// #1100: development-only exceptions to `pnpm audit --audit-level=high`. The
// production audit never reads this list. An exception stops applying on its
// expiry date (UTC), so the audit fails again without anyone editing the list.
export const DEV_AUDIT_EXCEPTIONS = [
  {
    ghsa: 'GHSA-fc5q-39xc-vjpf',
    module: 'picomatch',
    expires: '2026-12-18',
    reason:
      'No fixed picomatch exists yet; only build, test and lint tools (vite, vitest, tinyglobby, typescript-eslint) reach it.'
  }
]

const BLOCKING_SEVERITIES = new Set(['high', 'critical'])

const isActive = (exception, now) =>
  now.getTime() < Date.parse(`${exception.expires}T00:00:00Z`)

/**
 * Returns the blocking advisories in a `pnpm audit --json` report and the
 * exceptions that matched or have expired.
 */
export const evaluateAudit = (report, { now, exceptions }) => {
  if (!report || typeof report !== 'object' || !report.advisories) {
    throw new Error('DEPENDENCY_AUDIT_REPORT_UNREADABLE')
  }
  const blocking = []
  const excepted = []
  for (const advisory of Object.values(report.advisories)) {
    if (!BLOCKING_SEVERITIES.has(advisory.severity)) continue
    const exception = exceptions.find(
      (item) =>
        item.ghsa === advisory.github_advisory_id &&
        item.module === advisory.module_name
    )
    if (exception && isActive(exception, now)) {
      excepted.push(exception.ghsa)
      continue
    }
    blocking.push({
      ghsa: advisory.github_advisory_id,
      module: advisory.module_name,
      severity: advisory.severity,
      expiredException: exception ? exception.expires : null
    })
  }
  return { blocking, excepted }
}

const main = () => {
  const audit = spawnSync('pnpm', ['audit', '--dev', '--json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  })
  let report
  try {
    report = JSON.parse(audit.stdout)
  } catch {
    console.error('Dependency audit (dev): pnpm audit output is not JSON.')
    console.error(audit.stderr)
    process.exit(1)
  }
  const { blocking, excepted } = evaluateAudit(report, {
    now: new Date(),
    exceptions: DEV_AUDIT_EXCEPTIONS
  })
  for (const ghsa of excepted) {
    const { expires } = DEV_AUDIT_EXCEPTIONS.find((item) => item.ghsa === ghsa)
    console.log(`Dependency audit (dev): ${ghsa} allowed until ${expires}.`)
  }
  if (blocking.length > 0) {
    for (const item of blocking) {
      const note = item.expiredException
        ? ` (exception expired ${item.expiredException})`
        : ''
      console.error(
        `Dependency audit (dev): ${item.severity} ${item.ghsa} in ${item.module}${note}`
      )
    }
    process.exit(1)
  }
  console.log('Dependency audit (dev): no blocking advisories.')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
