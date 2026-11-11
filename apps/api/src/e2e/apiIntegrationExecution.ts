import {
  classifyCollectionDiagnostic,
  classifyCollectionReport,
  type CollectionDiagnostic
} from './collectionDiagnostics.js'
import { createHash, randomUUID } from 'node:crypto'
import { readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { apiIntegrationManifest } from './apiIntegrationManifest.js'
import { summarizeFailureMessage } from './failureSummary.js'

export const assertSsoBootstrapMigrationHistory = (
  expected: readonly { name: string; checksum: string }[],
  applied: readonly { migration_name: string; checksum: string }[]
): void => {
  const orderedDigest = createHash('sha256')
    .update(
      expected.map(({ name, checksum }) => `${name}\0${checksum}\n`).join('')
    )
    .digest('hex')
  if (
    expected.length !== 8 ||
    expected.at(-1)?.name !== '20261112090000_account_erasure_grace_restore' ||
    orderedDigest !==
      '06da389253b90d06b1a43f3fec749c733880a02ea1d9de50de73f915cad8126e' ||
    applied.length !== expected.length ||
    applied.some(
      (row, index) =>
        row.migration_name !== expected[index]?.name ||
        row.checksum !== expected[index]?.checksum
    )
  ) {
    throw new Error('First Google ADMIN bootstrap migration history mismatch.')
  }
}

export const adminDbFoundationTestFile =
  'src/db/adminCmsFoundation.integration.test.ts' as const

export const ssoDbTestFile = 'src/db/sso.integration.test.ts' as const
export const ssoAccountLifecycleDbTestFile =
  'src/db/ssoAccountLifecycle.integration.test.ts' as const
export const ssoOrdinal6CaseTitle =
  'apple ADMIN_FRESH atomically binds original session/user/gen/provider and preserves populated learning facts' as const
export const ssoOrdinal6CasePattern = `${ssoOrdinal6CaseTitle}$`
export const ssoIdentityCaseTitle =
  'provider/sub alone resolves stable IDs; contact conflicts never merge or promote; new identities are USER' as const
export const ssoIdentityCasePattern = `${ssoIdentityCaseTitle}$`

const ssoCases = {
  'sso-ordinal6': {
    title: ssoOrdinal6CaseTitle,
    pattern: ssoOrdinal6CasePattern,
    id: 'SSO_APPLE_ADMIN_FRESH_ORDINAL6',
    sourceOrdinal: 6
  },
  'sso-identity': {
    title: ssoIdentityCaseTitle,
    pattern: ssoIdentityCasePattern,
    id: 'SSO_PROVIDER_SUB_IDENTITY_ORDINAL5',
    sourceOrdinal: 5
  }
} as const

type SsoCase = keyof typeof ssoCases

// Public deterministic fixtures for this TEST runner, never provider credentials.
const ssoTestProfile = {
  NODE_ENV: 'test',
  DEPLOYMENT_ENVIRONMENT: 'TEST',
  RELEASE_ID: '0'.repeat(40),
  HOST: '127.0.0.1',
  PORT: '3001',
  LOG_LEVEL: 'silent',
  BETTER_AUTH_SECRET: 'a'.repeat(32),
  GUEST_COOKIE_SECRET: 'b'.repeat(32),
  BETTER_AUTH_URL: 'http://127.0.0.1:3001',
  TRUSTED_ORIGINS: 'http://127.0.0.1:5173',
  AUTH_TRUSTED_PROXY_CIDRS: '127.0.0.1/32,::1/128',
  AUTH_EMAIL_FROM: 'sso-db@example.test',
  AUTH_EMAIL_DELIVERY_MODE: 'test-sink'
} as const
const ssoExcludedParentKeys = new Set([
  ...Object.keys(ssoTestProfile),
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'APPLE_CLIENT_ID',
  'APPLE_CLIENT_SECRET',
  'AUTH_EMAIL_WEBHOOK_URL',
  'AUTH_EMAIL_WEBHOOK_SECRET'
])

export const createSsoDbTestEnvironment = (
  base: NodeJS.ProcessEnv
): NodeJS.ProcessEnv => {
  const environment: NodeJS.ProcessEnv = { ...ssoTestProfile }
  // Do not read even shadowed parent credential/accessor values.
  for (const key of Object.keys(base)) {
    if (!ssoExcludedParentKeys.has(key)) environment[key] = base[key]
  }
  return environment
}

export const createDbIntegrationFileEnvironment = (
  testFile: string,
  base: NodeJS.ProcessEnv
): NodeJS.ProcessEnv => {
  return testFile === ssoDbTestFile ||
    testFile === ssoAccountLifecycleDbTestFile
    ? createSsoDbTestEnvironment(base)
    : base
}

const singleTestFiles: readonly string[] = [
  adminDbFoundationTestFile,
  ssoDbTestFile,
  ssoAccountLifecycleDbTestFile
]

export const selectDbIntegrationTestFiles = (
  defaultFiles: readonly string[],
  environment: NodeJS.ProcessEnv
): readonly string[] => {
  const selected = environment.DB_INTEGRATION_SINGLE_TEST
  if (
    environment.DB_INTEGRATION_CASE !== undefined &&
    ((environment.DB_INTEGRATION_CASE !== 'sso-ordinal6' &&
      environment.DB_INTEGRATION_CASE !== 'sso-identity') ||
      selected !== ssoDbTestFile ||
      environment.DB_INTEGRATION_PRESERVE_REPORT !== '1')
  ) {
    throw new Error('Case selection requires the fixed SSO report mode.')
  }
  if (selected === undefined) return defaultFiles
  if (!singleTestFiles.includes(selected) || !defaultFiles.includes(selected)) {
    throw new Error('Single test is outside the fixed allowlist.')
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
      /(?:[Aa]dmin integration|[Ll]egacy compatibility|[Dd]evelopment app wrapper) database URL is required/u,
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
      /DB endpoint identity is unavailable/u,
      'SETUP_ENDPOINT_UNAVAILABLE',
      'setup'
    ],
    [/operation was not created/u, 'SETUP_OPERATION_UNAVAILABLE', 'setup']
  ]
  const rule = rules.find(([pattern]) => pattern.test(text))
  return {
    diagnosticId: rule?.[1] ?? 'UNKNOWN_REDACTED',
    location: rule?.[2] ?? 'unknown'
  }
}

export const sanitizeDbIntegrationVitestReport = (
  result: VitestJsonResult,
  testFile: string,
  environment: NodeJS.ProcessEnv = {}
) => {
  const safeCount = (value: number | undefined) =>
    Number.isSafeInteger(value) && (value ?? -1) >= 0 ? value : null
  const errorClasses = ['AssertionError', 'TypeError', 'Error'] as const
  const sqlstates = ['23503', '23514', '42501'] as const
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
    environment.DB_INTEGRATION_CASE === undefined &&
    testFile === ssoDbTestFile &&
    result.numTotalTests === 36 &&
    result.numFailedTests === 1 &&
    Array.isArray(result.testResults) &&
    result.testResults.length === 1 &&
    fileResult &&
    typeof fileResult.name === 'string' &&
    normalizeResultPath(fileResult.name) === ssoDbTestFile &&
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
      const errorClass = messages.flatMap(({ text }) =>
        errorClasses.filter((name) => text.startsWith(`${name}:`))
      )[0]
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
  const selectedSsoCaseName = environment.DB_INTEGRATION_CASE
  const selectedSsoCase =
    selectedSsoCaseName === 'sso-ordinal6' ||
    selectedSsoCaseName === 'sso-identity'
      ? ssoCases[selectedSsoCaseName]
      : undefined
  let selectedCase:
    | {
        id: (typeof ssoCases)[SsoCase]['id']
        sourceOrdinal: (typeof ssoCases)[SsoCase]['sourceOrdinal']
        matched: 1
        status: 'passed' | 'failed'
        failure?: {
          errorClass?: string
          recognizedTextCodes: string[]
          recognizedSourcePaths: string[]
        }
      }
    | undefined
  if (
    selectedSsoCase &&
    testFile === ssoDbTestFile &&
    result.testResults?.length === 1 &&
    fileResult &&
    typeof fileResult.name === 'string' &&
    normalizeResultPath(fileResult.name) === ssoDbTestFile &&
    !fileResult.failureMessage &&
    !fileResult.message &&
    result.numTotalTests === 36 &&
    result.numPendingTests === 35 &&
    (result.numTodoTests ?? 0) === 0 &&
    Array.isArray(assertions) &&
    assertions.length === 36
  ) {
    const matches = assertions.filter(
      (assertion) =>
        assertion?.fullName ===
        `JLP-508 SSO task-owned PostgreSQL contract ${selectedSsoCase.title}`
    )
    const selected = matches[0]
    if (
      matches.length === 1 &&
      selected &&
      (selected.status === 'passed' || selected.status === 'failed') &&
      fileResult.status === selected.status &&
      result.numPassedTests === (selected.status === 'passed' ? 1 : 0) &&
      result.numFailedTests === (selected.status === 'failed' ? 1 : 0) &&
      assertions.every(
        (assertion) =>
          assertion === selected ||
          ['pending', 'skipped'].includes(assertion?.status ?? '')
      )
    ) {
      // Vitest JSON exposes stack/message strings, not structured error codes.
      // Never promote SQLSTATE-like text to a structured PostgreSQL SQLSTATE.
      const messages = (
        Array.isArray(selected.failureMessages)
          ? (selected.failureMessages as readonly unknown[])
          : []
      )
        .slice(0, 3)
        .filter((message): message is string => typeof message === 'string')
        .map((message) => message.slice(0, 8192))
      const classes = [
        'AssertionError',
        'TypeError',
        'RangeError',
        'Error',
        'PrismaClientKnownRequestError',
        'PrismaClientUnknownRequestError',
        'PrismaClientInitializationError'
      ]
      const errorClass = classes.find((name) =>
        messages.some((message) => message.startsWith(`${name}:`))
      )
      const recognizedTextCodes = [
        'P2002',
        'P2010',
        'P2028',
        'P2034',
        'ERR_ASSERTION'
      ].filter((code) =>
        messages.some((message) =>
          new RegExp(`\\bcode\\s*[:=]\\s*['"]${code}['"]`, 'u').test(message)
        )
      )
      const recognizedSourcePaths = [
        'src/auth/ssoAdminFreshRepository.ts',
        'src/db/ssoDbTestFixture.ts',
        ssoDbTestFile
      ].filter((source) => {
        const sourcePaths =
          source === 'src/db/ssoDbTestFixture.ts'
            ? [source, 'src/db/ssoTestFixture.ts']
            : [source]
        return messages.some((message) =>
          message
            .split('\n')
            .some(
              (line) =>
                /^\s+at /u.test(line) &&
                sourcePaths.some((path) =>
                  new RegExp(
                    `(?:^|[ /])${path.replaceAll('.', '\\.')}:[0-9]+:[0-9]+[)]?$`,
                    'u'
                  ).test(line)
                )
            )
        )
      })
      selectedCase = {
        id: selectedSsoCase.id,
        sourceOrdinal: selectedSsoCase.sourceOrdinal,
        matched: 1,
        status: selected.status,
        ...(selected.status === 'failed'
          ? {
              failure: {
                ...(errorClass ? { errorClass } : {}),
                recognizedTextCodes,
                recognizedSourcePaths
              }
            }
          : {})
      }
    }
  }
  const lifecycleFailed =
    testFile === ssoAccountLifecycleDbTestFile
      ? assertions?.findIndex((assertion) => assertion.status === 'failed')
      : undefined
  const lifecycleMessage =
    lifecycleFailed !== undefined && lifecycleFailed >= 0
      ? assertions?.[lifecycleFailed]?.failureMessages?.[0]
          ?.split('\n')[0]
          ?.trim()
      : undefined
  // Retain original first lines only when their entire grammar is non-private.
  const lifecycleSafeMessage =
    lifecycleMessage &&
    [
      /^AssertionError: expected (?:null|undefined|true|false|[0-9]+) to (?:be|equal|deeply equal|be truthy|be falsy|have a length of)(?: (?:true|false|null|undefined|[0-9]+|'\/login'))?(?: \/\/ (?:Object.is|deep) equality)?$/u,
      /^(?:Error|error): permission denied for (?:table|function|schema) [A-Za-z_][A-Za-z0-9_]*$/u,
      /^(?:Error|error): column "[A-Za-z_][A-Za-z0-9_]*" does not exist$/u
    ].some((pattern) => pattern.test(lifecycleMessage))
      ? lifecycleMessage
      : undefined
  return {
    schemaVersion: 1,
    testFile: singleTestFiles.includes(testFile) ? testFile : 'not-allowlisted',
    total: safeCount(result.numTotalTests),
    passed: safeCount(result.numPassedTests),
    failed: safeCount(result.numFailedTests),
    pending: safeCount(result.numPendingTests),
    todo: safeCount(result.numTodoTests),
    dependenciesPresent: {
      adminWrapper: Boolean(environment.ADMIN_DATABASE_URL?.trim()),
      developmentWrapper: Boolean(
        environment.TEST_DEVELOPMENT_APP_DATABASE_URL?.trim()
      )
    },
    ...(firstFailedAssertion ? { firstFailedAssertion } : {}),
    ...(lifecycleFailed !== undefined && lifecycleFailed >= 0
      ? {
          lifecycleFailure: {
            caseOrdinal: lifecycleFailed + 1,
            originalFirstLineRetained: lifecycleSafeMessage !== undefined,
            ...(lifecycleSafeMessage
              ? { originalFirstLine: lifecycleSafeMessage }
              : {}),
            sourcePath: ssoAccountLifecycleDbTestFile
          }
        }
      : {}),
    ...(selectedCase ? { selectedCase } : {}),
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

const queryPlanTestFile =
  'src/review/reviewCenterFoundationQueryPlan.integration.test.ts'

export const sanitizeQueryPlanFailure = (
  result: VitestJsonResult,
  source: string | undefined
) => {
  const unknown = { diagnosticId: 'UNKNOWN_REDACTED' } as const
  const files = result?.testResults
  if (!Array.isArray(files) || files.length !== 1) return unknown
  const file = files[0]
  if (
    !file ||
    typeof file.name !== 'string' ||
    normalizeResultPath(file.name) !== queryPlanTestFile ||
    file.status !== 'failed'
  )
    return unknown
  const assertions = file.assertionResults
  if (
    result.numTotalTests !== 1 ||
    result.numFailedTests !== 1 ||
    !Array.isArray(assertions) ||
    assertions.length !== 1 ||
    assertions[0]?.status !== 'failed'
  ) {
    const error = [file.failureMessage, file.message].find(
      (value): value is string => typeof value === 'string'
    )
    return error ? sanitizeCollectionError(error) : unknown
  }
  const messages = assertions[0].failureMessages
  if (!Array.isArray(messages) || typeof messages[0] !== 'string')
    return unknown
  const lines = messages[0].slice(0, 8_192).split('\n')
  const first = lines[0] ?? ''
  const sourceLineCount = source
    ? source.split('\n').length - Number(source.endsWith('\n'))
    : 0
  const diagnosticId = /^AssertionError(?::|$)/u.test(first)
    ? 'ASSERTION_FAILED'
    : /^Error: Test timed out in \d+ms\./u.test(first)
      ? 'TEST_TIMEOUT'
      : 'UNKNOWN_REDACTED'
  const locations = lines
    .slice(1)
    .flatMap((line) => {
      const match = line.match(
        /^\s*(?:❯|at)\s+(?:\S+\s+\()?([^\s()]+):([1-9]\d{0,3}):[1-9]\d{0,3}\)?\s*$/u
      )
      if (!match || normalizeResultPath(match[1]!) !== queryPlanTestFile)
        return []
      const lineNumber = Number(match[2])
      return lineNumber <= sourceLineCount ? [lineNumber] : []
    })
    .slice(0, 3)
  return { diagnosticId, locations }
}

export const assertApiIntegrationRequiredEnvironment = ({
  environment,
  testFile
}: {
  readonly environment: NodeJS.ProcessEnv
  readonly testFile: string
}): void => {
  const entry = apiIntegrationManifest.find(
    ({ path: manifestPath }) => manifestPath === testFile
  )
  if (!entry) {
    throw new Error(`Integration manifest entry is missing: ${testFile}.`)
  }
  const missingNames = entry.requiredEnvironment.filter(
    (name) => !environment[name]?.trim()
  )
  if (missingNames.length > 0) {
    throw new Error(
      `Integration environment is incomplete: ${testFile}; ` +
        `missing=${missingNames.join(',')}.`
    )
  }
}

export const assertApiIntegrationVitestFileResult = ({
  result,
  expectedPath,
  selectedSsoCase
}: {
  readonly result: VitestJsonResult
  readonly expectedPath: string
  readonly selectedSsoCase?: SsoCase
}): void => {
  if (selectedSsoCase !== undefined) {
    const report = sanitizeDbIntegrationVitestReport(result, expectedPath, {
      DB_INTEGRATION_CASE: selectedSsoCase
    })
    if (report.selectedCase?.status !== 'passed') {
      throw new Error('Fixed SSO case result is incomplete.')
    }
    return
  }
  if (
    result.numFailedTests !== 0 ||
    result.numPendingTests !== 0 ||
    (result.numTodoTests ?? 0) !== 0 ||
    !Number.isSafeInteger(result.numTotalTests) ||
    (result.numTotalTests ?? 0) < 1 ||
    result.numPassedTests !== result.numTotalTests
  ) {
    throw new Error(`Integration result is incomplete: ${expectedPath}.`)
  }
  if (
    expectedPath === ssoAccountLifecycleDbTestFile &&
    result.numTotalTests !== 11
  ) {
    // #504 P7 PR5a adds the API link and unlink trigger case; #57 the
    // erasure role refusal case; #670 the tokenless end-to-end erasure;
    // JLP-845 the grace-period restore and its refusal.
    throw new Error(
      'SSO account lifecycle requires exactly eleven passing tests.'
    )
  }
  const resultPaths = (result.testResults ?? [])
    .map(({ name }) => (name ? normalizeResultPath(name) : ''))
    .filter(Boolean)
    .toSorted()
  if (JSON.stringify(resultPaths) !== JSON.stringify([expectedPath])) {
    throw new Error(`Integration result path mismatch: ${expectedPath}.`)
  }
}

export const runApiIntegrationManifestVitestFile = async ({
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
  const selectedSsoCaseName = environment.DB_INTEGRATION_CASE
  const selectedSsoCase =
    selectedSsoCaseName === 'sso-ordinal6' ||
    selectedSsoCaseName === 'sso-identity'
      ? selectedSsoCaseName
      : undefined
  if (selectedSsoCaseName !== undefined) {
    selectDbIntegrationTestFiles([testFile], environment)
    if (!preserveSanitizedReport) {
      throw new Error('Fixed SSO case requires sanitized reporting.')
    }
  }
  if (preserveSanitizedReport && !singleTestFiles.includes(testFile)) {
    throw new Error('Report preservation requires a fixed allowlisted file.')
  }
  if (preserveSanitizedReport && testFile !== ssoAccountLifecycleDbTestFile) {
    if (!environment.TEST_DEVELOPMENT_APP_DATABASE_URL?.trim())
      throw new Error(
        'Wrapper environment missing: TEST_DEVELOPMENT_APP_DATABASE_URL.'
      )
  }
  assertApiIntegrationRequiredEnvironment({ environment, testFile })
  const outputFile = path.join(
    os.tmpdir(),
    `nihongo-test-vitest-${randomUUID()}.json`
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
          ...(testFile === ssoDbTestFile ||
          testFile === ssoAccountLifecycleDbTestFile
            ? [
                '--maxWorkers=1',
                '--no-file-parallelism',
                '--bail=1',
                '--retry=0'
              ]
            : []),
          ...(selectedSsoCase
            ? ['--testNamePattern', ssoCases[selectedSsoCase].pattern]
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
        throw new Error(`Integration process failed: ${testFile}.`)
      }
      for (const diagnostic of classifyCollectionReport(result))
        emit(diagnostic)
      if (testFile === queryPlanTestFile) {
        let source: string | undefined
        try {
          source = await readFile(
            new URL(
              '../review/reviewCenterFoundationQueryPlan.integration.test.ts',
              import.meta.url
            ),
            'utf8'
          )
        } catch {
          // Without the source, omit locations and retain the failure.
        }
        throw new Error(
          `Integration process failed: ${queryPlanTestFile}; ` +
            `diagnostic=${JSON.stringify(sanitizeQueryPlanFailure(result, source))}.`
        )
      }
      const failedTests = (result.testResults ?? []).flatMap(
        ({ assertionResults = [] }) =>
          assertionResults
            .filter(({ status }) => status === 'failed')
            .map(({ fullName }) => fullName ?? 'unnamed test')
      )
      // CCD-664: the masked first failure line of each test, so a flaky
      // failure can be diagnosed from the CI log alone.
      const failureSummaries = (result.testResults ?? []).flatMap(
        ({ assertionResults = [] }) =>
          assertionResults
            .filter(({ status }) => status === 'failed')
            .map(
              ({ fullName, failureMessages }) =>
                `${fullName ?? 'unnamed test'}: ${summarizeFailureMessage(
                  failureMessages?.[0],
                  { ...process.env, ...environment }
                )}`
            )
      )
      throw Object.assign(
        new Error(
          `Integration process failed: ${testFile}; ` +
            `failed=${result.numFailedTests ?? 'unknown'}; ` +
            `tests=${preserveSanitizedReport ? 'redacted' : failedTests.join(' | ') || 'unavailable'}` +
            (preserveSanitizedReport || failureSummaries.length === 0
              ? '.'
              : `; failures=${failureSummaries.join(' | ')}.`)
        ),
        // Test names come from the test source, never from a failure, so the
        // database runner can print them (JLP-833).
        preserveSanitizedReport ? {} : { failedTests }
      )
    }
    const result = JSON.parse(
      await readFile(outputFile, 'utf8')
    ) as VitestJsonResult
    assertApiIntegrationVitestFileResult({
      result,
      expectedPath: testFile,
      ...(selectedSsoCase === undefined ? {} : { selectedSsoCase })
    })
    return selectedSsoCase ? 1 : (result.numTotalTests ?? 0)
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
          `nihongo-sanitized-${randomUUID()}.json`
        )
        await writeFile(
          reportFile,
          JSON.stringify(
            sanitizeDbIntegrationVitestReport(result, testFile, environment)
          ),
          { mode: 0o600, flag: 'wx' }
        )
        process.stdout.write(
          `${JSON.stringify({ event: 'db.sanitized_report', reportFile })}\n`
        )
      }
    } finally {
      await rm(outputFile, { force: true })
    }
  }
}

export {
  createSsoDbTestEnvironment as createSsoTestEnvironment,
  createDbIntegrationFileEnvironment as createDbFileEnvironment,
  selectDbIntegrationTestFiles as selectDbIntegrationFiles,
  sanitizeDbIntegrationVitestReport as sanitizeVitestReport,
  adminDbFoundationTestFile as dbFoundationTestFile,
  ssoDbTestFile as ssoTestFile,
  ssoAccountLifecycleDbTestFile as ssoAccountLifecycleTestFile,
  ssoOrdinal6CaseTitle as ssoOrdinal6Title,
  ssoOrdinal6CasePattern as ssoOrdinal6Pattern,
  ssoIdentityCaseTitle as ssoIdentityTitle,
  ssoIdentityCasePattern as ssoIdentityPattern
}
