import {
  classifyCollectionDiagnostic,
  classifyCollectionReport,
  type CollectionDiagnostic
} from './phase7CollectionDiagnostics.js'
import { randomUUID } from 'node:crypto'
import { readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { phase10ApiIntegrationManifest } from './phase10ApiIntegrationManifest.js'

export const phase7DbFoundationTestFile =
  'src/db/phase7AdminCmsFoundation.integration.test.ts' as const

export const phase7SsoTestFile = 'src/db/phase7Sso.integration.test.ts' as const

// Public deterministic fixtures for this TEST runner, never provider credentials.
const phase7SsoTestProfile = {
  NODE_ENV: 'test',
  DEPLOYMENT_ENVIRONMENT: 'TEST',
  RELEASE_ID: '0'.repeat(40),
  ADMIN_CMS_MODE: 'technical',
  HOST: '127.0.0.1',
  PORT: '3001',
  LOG_LEVEL: 'silent',
  BETTER_AUTH_SECRET: 'phase7-sso-db-auth-test-only-secret-v1',
  GUEST_COOKIE_SECRET: 'phase7-sso-db-guest-test-only-secret-v1',
  BETTER_AUTH_URL: 'http://127.0.0.1:3001',
  TRUSTED_ORIGINS: 'http://127.0.0.1:5173',
  AUTH_TRUSTED_PROXY_CIDRS: '127.0.0.1/32,::1/128',
  AUTH_EMAIL_FROM: 'sso-db@example.test',
  AUTH_EMAIL_DELIVERY_MODE: 'test-sink'
} as const
const phase7SsoExcludedParentKeys = new Set([
  ...Object.keys(phase7SsoTestProfile),
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'APPLE_CLIENT_ID',
  'APPLE_CLIENT_SECRET',
  'AUTH_EMAIL_WEBHOOK_URL',
  'AUTH_EMAIL_WEBHOOK_SECRET'
])

export const createPhase7SsoTestEnvironment = (
  base: NodeJS.ProcessEnv
): NodeJS.ProcessEnv => {
  const environment: NodeJS.ProcessEnv = { ...phase7SsoTestProfile }
  // Do not read even shadowed parent credential/accessor values.
  for (const key of Object.keys(base)) {
    if (!phase7SsoExcludedParentKeys.has(key)) environment[key] = base[key]
  }
  return environment
}

const phase7SingleTestFiles: readonly string[] = [
  phase7DbFoundationTestFile,
  phase7SsoTestFile
]

export const selectPhase7DbIntegrationFiles = (
  defaultFiles: readonly string[],
  environment: NodeJS.ProcessEnv
): readonly string[] => {
  const selected = environment.PHASE7_DB_SINGLE_TEST
  if (selected === undefined) return defaultFiles
  if (
    !phase7SingleTestFiles.includes(selected) ||
    !defaultFiles.includes(selected)
  ) {
    throw new Error('Phase 7 single test is outside the fixed allowlist.')
  }
  return [selected]
}

const sanitizeCollectionError = (value: string) => {
  const text = value.slice(0, 8_192)
  if (classifyCollectionDiagnostic(text).code === 'ENVIRONMENT_INVALID') {
    return { diagnosticId: 'CONFIG_ENVIRONMENT_INVALID', location: 'setup' }
  }
  const rules: readonly [RegExp, string, 'module' | 'config' | 'setup'][] = [
    [
      /Cannot find (?:module|package)|ERR_MODULE_NOT_FOUND/u,
      'MODULE_DEPENDENCY_MISSING',
      'module'
    ],
    [
      /does not provide an export|No matching export/u,
      'MODULE_EXPORT_MISMATCH',
      'module'
    ],
    [
      /Phase 7 (?:admin integration|legacy compatibility|development app wrapper) database URL is required/u,
      'CONFIG_WRAPPER_MISSING',
      'config'
    ],
    [/schemas must match exactly/u, 'CONFIG_SCHEMA_MISMATCH', 'config'],
    [
      /Refusing to use|requires a loopback|does not match NODE_ENV/u,
      'CONFIG_TARGET_REJECTED',
      'config'
    ],
    [
      /Phase 7 DB endpoint identity is unavailable/u,
      'SETUP_ENDPOINT_UNAVAILABLE',
      'setup'
    ],
    [
      /Phase 7 operation was not created/u,
      'SETUP_OPERATION_UNAVAILABLE',
      'setup'
    ]
  ]
  const rule = rules.find(([pattern]) => pattern.test(text))
  return {
    diagnosticId: rule?.[1] ?? 'UNKNOWN_REDACTED',
    location: rule?.[2] ?? 'unknown'
  }
}

export const sanitizePhase7VitestReport = (
  result: VitestJsonResult,
  testFile: string,
  environment: NodeJS.ProcessEnv = {}
) => {
  const safeCount = (value: number | undefined) =>
    Number.isSafeInteger(value) && (value ?? -1) >= 0 ? value : null
  const errorClasses = ['AssertionError', 'TypeError', 'Error'] as const
  const sqlstates = ['23503', '23514', '42501'] as const
  const learningConstraintCheckpointMessage =
    'SSO learning constraint checkpoint failed.'
  let firstFailedAssertion:
    | {
        caseOrdinal: number
        errorClass?: (typeof errorClasses)[number]
        recognizedSqlstates?: (typeof sqlstates)[number][]
      }
    | undefined
  const fileResult = result.testResults?.[0]
  const assertions = fileResult?.assertionResults
  if (
    testFile === phase7SsoTestFile &&
    result.numTotalTests === 36 &&
    result.numFailedTests === 1 &&
    Array.isArray(result.testResults) &&
    result.testResults.length === 1 &&
    fileResult &&
    typeof fileResult.name === 'string' &&
    normalizeResultPath(fileResult.name) === phase7SsoTestFile &&
    fileResult.status === 'failed' &&
    !fileResult.failureMessage &&
    !fileResult.message &&
    Array.isArray(fileResult.assertionResults) &&
    assertions?.length === 36 &&
    assertions.every(
      (assertion) =>
        assertion &&
        typeof assertion === 'object' &&
        ['passed', 'failed', 'skipped', 'pending', 'todo', 'disabled'].includes(
          assertion.status ?? ''
        )
    )
  ) {
    const failed = assertions.flatMap((assertion, index) =>
      assertion.status === 'failed' ? [{ assertion, index }] : []
    )
    if (failed.length === 1) {
      const { assertion, index } = failed[0]!
      const messages = (
        Array.isArray(assertion.failureMessages)
          ? assertion.failureMessages.slice(0, 3)
          : []
      )
        .filter(
          (message: unknown): message is string => typeof message === 'string'
        )
        .map((message) => ({
          text: message.slice(0, 8192),
          truncated: message.length > 8192
        }))
      const errorClass =
        messages.flatMap(({ text }) =>
          errorClasses.filter((name) => text.startsWith(`${name}:`))
        )[0] ??
        (messages.some(
          ({ text }) =>
            text === learningConstraintCheckpointMessage ||
            text.startsWith(`${learningConstraintCheckpointMessage}\n`) ||
            text.startsWith(`${learningConstraintCheckpointMessage}\r\n`)
        )
          ? 'TypeError'
          : undefined)
      // Text tokens only, never a claim about a structured PostgreSQL error code.
      const recognizedSqlstates = sqlstates.filter((code) =>
        messages.some(({ text, truncated }) => {
          const pattern = new RegExp(
            `(?:^|[^A-Za-z0-9_])${code}(?=$|[^A-Za-z0-9_])`,
            'gu'
          )
          return [...text.matchAll(pattern)].some(
            (match) => !truncated || match.index + match[0].length < text.length
          )
        })
      )
      firstFailedAssertion = {
        caseOrdinal: index + 1,
        ...(errorClass ? { errorClass } : {}),
        ...(recognizedSqlstates.length > 0 ? { recognizedSqlstates } : {})
      }
    }
  }
  return {
    schemaVersion: 1,
    testFile: phase7SingleTestFiles.includes(testFile)
      ? testFile
      : 'not-allowlisted',
    total: safeCount(result.numTotalTests),
    passed: safeCount(result.numPassedTests),
    failed: safeCount(result.numFailedTests),
    pending: safeCount(result.numPendingTests),
    todo: safeCount(result.numTodoTests),
    dependenciesPresent: {
      adminWrapper: Boolean(environment.PHASE7_ADMIN_DATABASE_URL?.trim()),
      legacyWrapper: Boolean(environment.PHASE7_LEGACY_DATABASE_URL?.trim()),
      developmentWrapper: Boolean(
        environment.PHASE7_DEVELOPMENT_APP_DATABASE_URL?.trim()
      )
    },
    ...(firstFailedAssertion ? { firstFailedAssertion } : {}),
    errors: (result.testResults ?? [])
      .flatMap(({ failureMessage, message }) => [failureMessage, message])
      .filter(
        (message): message is string =>
          typeof message === 'string' && message.length > 0
      )
      .slice(0, 3)
      .map(sanitizeCollectionError)
  }
}

interface VitestJsonResult {
  readonly numFailedTests?: number
  readonly numPassedTests?: number
  readonly numPendingTests?: number
  readonly numTodoTests?: number
  readonly numTotalTests?: number
  readonly testResults?: ReadonlyArray<{
    readonly failureMessage?: string
    readonly message?: string
    readonly name?: string
    readonly status?: string
    readonly assertionResults?: ReadonlyArray<{
      readonly fullName?: string
      readonly failureMessages?: readonly string[] | null
      readonly status?: string
    }>
  }>
}

type RunCommand = (
  command: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv
) => Promise<unknown>

const normalizeResultPath = (value: string): string => {
  const normalized = value.replaceAll(path.sep, '/')
  const marker = '/apps/api/'
  const markerIndex = normalized.lastIndexOf(marker)
  if (markerIndex !== -1) return normalized.slice(markerIndex + marker.length)
  return normalized.startsWith('src/') ? normalized : path.basename(normalized)
}

export const assertPhase10RequiredEnvironment = ({
  environment,
  testFile
}: {
  readonly environment: NodeJS.ProcessEnv
  readonly testFile: string
}): void => {
  const entry = phase10ApiIntegrationManifest.find(
    ({ path: manifestPath }) => manifestPath === testFile
  )
  if (!entry) {
    throw new Error(
      `Phase 10 integration manifest entry is missing: ${testFile}.`
    )
  }
  const missingNames = entry.requiredEnvironment.filter(
    (name) => !environment[name]?.trim()
  )
  if (missingNames.length > 0) {
    throw new Error(
      `Phase 10 integration environment is incomplete: ${testFile}; ` +
        `missing=${missingNames.join(',')}.`
    )
  }
}

export const assertPhase10VitestFileResult = ({
  result,
  expectedPath
}: {
  readonly result: VitestJsonResult
  readonly expectedPath: string
}): void => {
  if (
    result.numFailedTests !== 0 ||
    result.numPendingTests !== 0 ||
    (result.numTodoTests ?? 0) !== 0 ||
    !Number.isSafeInteger(result.numTotalTests) ||
    (result.numTotalTests ?? 0) < 1 ||
    result.numPassedTests !== result.numTotalTests
  ) {
    throw new Error(
      `Phase 10 integration result is incomplete: ${expectedPath}.`
    )
  }
  const resultPaths = (result.testResults ?? [])
    .map(({ name }) => (name ? normalizeResultPath(name) : ''))
    .filter(Boolean)
    .toSorted()
  if (JSON.stringify(resultPaths) !== JSON.stringify([expectedPath])) {
    throw new Error(
      `Phase 10 integration result path mismatch: ${expectedPath}.`
    )
  }
}

export const runPhase10ManifestVitestFile = async ({
  runCommand,
  testFile,
  environment,
  preserveSanitizedReport = false,
  onCollectionDiagnostic
}: {
  readonly runCommand: RunCommand
  readonly testFile: string
  readonly environment: NodeJS.ProcessEnv
  readonly preserveSanitizedReport?: boolean
  readonly onCollectionDiagnostic?: (diagnostic: CollectionDiagnostic) => void
}): Promise<number> => {
  if (preserveSanitizedReport && !phase7SingleTestFiles.includes(testFile)) {
    throw new Error(
      'Phase 7 report preservation requires a fixed allowlisted file.'
    )
  }
  if (preserveSanitizedReport) {
    for (const name of [
      'PHASE7_LEGACY_DATABASE_URL',
      'PHASE7_DEVELOPMENT_APP_DATABASE_URL'
    ]) {
      if (!environment[name]?.trim())
        throw new Error(`Phase 7 wrapper environment missing: ${name}.`)
    }
  }
  assertPhase10RequiredEnvironment({ environment, testFile })
  const outputFile = path.join(
    os.tmpdir(),
    `nihongo-phase10-vitest-${randomUUID()}.json`
  )
  try {
    try {
      await runCommand(
        'pnpm',
        [
          '--filter',
          '@nihongo/api',
          'exec',
          'vitest',
          'run',
          '--config',
          'vitest.integration.config.ts',
          testFile,
          ...(testFile === phase7SsoTestFile
            ? [
                '--maxWorkers=1',
                '--no-file-parallelism',
                '--bail=1',
                '--retry=0'
              ]
            : []),
          '--reporter=json',
          `--outputFile=${outputFile}`
        ],
        environment
      )
    } catch (primaryError: unknown) {
      const emit = (diagnostic: CollectionDiagnostic) => {
        try {
          onCollectionDiagnostic?.(diagnostic)
        } catch {
          /* Diagnostics never replace the primary failure. */
        }
      }
      emit(classifyCollectionDiagnostic(primaryError))
      let result: VitestJsonResult | undefined
      try {
        result = JSON.parse(
          await readFile(outputFile, 'utf8')
        ) as VitestJsonResult
      } catch {
        throw new Error(`Phase 10 integration process failed: ${testFile}.`)
      }
      for (const diagnostic of classifyCollectionReport(result))
        emit(diagnostic)
      const failedTests = (result.testResults ?? []).flatMap(
        ({ assertionResults = [] }) =>
          assertionResults
            .filter(({ status }) => status === 'failed')
            .map(({ fullName }) => fullName ?? 'unnamed test')
      )
      throw new Error(
        `Phase 10 integration process failed: ${testFile}; ` +
          `failed=${result.numFailedTests ?? 'unknown'}; ` +
          `tests=${preserveSanitizedReport ? 'redacted' : failedTests.join(' | ') || 'unavailable'}.`
      )
    }
    const result = JSON.parse(
      await readFile(outputFile, 'utf8')
    ) as VitestJsonResult
    assertPhase10VitestFileResult({ result, expectedPath: testFile })
    return result.numTotalTests ?? 0
  } finally {
    try {
      if (preserveSanitizedReport) {
        let result: VitestJsonResult = {}
        try {
          result = JSON.parse(
            await readFile(outputFile, 'utf8')
          ) as VitestJsonResult
        } catch {
          // Missing or invalid reporter data is preserved as unknown counts.
        }
        const reportFile = path.join(
          os.tmpdir(),
          `nihongo-phase7-sanitized-${randomUUID()}.json`
        )
        await writeFile(
          reportFile,
          JSON.stringify(
            sanitizePhase7VitestReport(result, testFile, environment)
          ),
          { mode: 0o600, flag: 'wx' }
        )
        process.stdout.write(
          `${JSON.stringify({ event: 'phase7.db.sanitized_report', reportFile })}\n`
        )
      }
    } finally {
      await rm(outputFile, { force: true })
    }
  }
}
