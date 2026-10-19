import { readFile, rm, stat, writeFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import {
  EnvironmentValidationError,
  parseApiEnvironment
} from '../config/env.js'
import {
  assertPhase10VitestFileResult,
  createPhase7SsoTestEnvironment,
  phase7DbFoundationTestFile,
  phase7SsoTestFile,
  phase7SsoOrdinal6Title,
  phase7SsoOrdinal6Pattern,
  phase7SsoIdentityTitle,
  phase7SsoIdentityPattern,
  runPhase10ManifestVitestFile,
  sanitizePhase7VitestReport,
  selectPhase7DbIntegrationFiles
} from './phase10ApiIntegrationExecution.js'

describe('Phase 7 SSO deterministic TEST environment', () => {
  const schema = 'phase7_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_test'
  const database = (role: string) =>
    `postgresql://${role}:synthetic@127.0.0.1:5432/nihongo_test?schema=${schema}`
  const wrappers = {
    DATABASE_URL: database('nihongo_test_app_login'),
    AUTH_GATEWAY_DATABASE_URL: database('nihongo_test_auth_gateway_login'),
    PHASE7_ADMIN_DATABASE_URL: database('nihongo_test_phase7_migration_login'),
    PHASE7_MIGRATION_DATABASE_URL: database(
      'nihongo_test_phase7_migration_login'
    ),
    PHASE7_LEGACY_DATABASE_URL: database('nihongo_test_legacy_app_login'),
    PHASE7_DEVELOPMENT_APP_DATABASE_URL: 'synthetic-development-wrapper',
    PRISMA_TEST_DATABASE_URL: database('nihongo_test_app_login'),
    PATH: '/synthetic/toolchain'
  }

  it('completes the real environment parser before any connection without inherited secrets', () => {
    let invalidFields: readonly string[] | undefined
    try {
      parseApiEnvironment({ ...wrappers, NODE_ENV: 'test' })
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(EnvironmentValidationError)
      if (error instanceof EnvironmentValidationError)
        invalidFields = error.invalidFields
    }
    expect(invalidFields).toEqual(['BETTER_AUTH_SECRET', 'GUEST_COOKIE_SECRET'])
    const environment = createPhase7SsoTestEnvironment(wrappers)
    const parsed = parseApiEnvironment(environment)
    expect(parsed).toMatchObject({
      NODE_ENV: 'test',
      DEPLOYMENT_ENVIRONMENT: 'TEST',
      ADMIN_CMS_MODE: 'technical',
      HOST: '127.0.0.1',
      PORT: 3001,
      BETTER_AUTH_URL: 'http://127.0.0.1:3001',
      TRUSTED_ORIGINS: ['http://127.0.0.1:5173'],
      AUTH_TRUSTED_PROXY_CIDRS: ['127.0.0.1/32', '::1/128'],
      AUTH_EMAIL_FROM: 'sso-db@example.test',
      AUTH_EMAIL_DELIVERY_MODE: 'test-sink'
    })
    expect(parsed.BETTER_AUTH_SECRET.length).toBeGreaterThanOrEqual(32)
    expect(parsed.GUEST_COOKIE_SECRET.length).toBeGreaterThanOrEqual(32)
    expect(parsed.BETTER_AUTH_SECRET).not.toBe(parsed.GUEST_COOKIE_SECRET)
    for (const [key, value] of Object.entries(wrappers)) {
      expect(environment[key]).toBe(value)
    }
    expect(environment).toEqual(createPhase7SsoTestEnvironment(wrappers))
    expect(environment).not.toBe(wrappers)
  })

  it('preserves invalid database wrappers so the real authority guard still rejects them', () => {
    const base = { ...wrappers, DATABASE_URL: database('nihongo_phase7_owner') }
    const environment = createPhase7SsoTestEnvironment(base)
    expect(environment.DATABASE_URL).toBe(base.DATABASE_URL)
    expect(() => parseApiEnvironment(environment)).toThrow(
      EnvironmentValidationError
    )
  })

  it('replaces real-like parent auth/provider/webhook values and leaves the base unchanged', () => {
    const parent = Object.freeze({
      ...wrappers,
      NODE_ENV: 'production',
      DEPLOYMENT_ENVIRONMENT: 'PRODUCTION',
      RELEASE_ID: 'real-parent-release',
      HOST: 'real-parent-host',
      PORT: '8443',
      LOG_LEVEL: 'debug',
      BETTER_AUTH_SECRET: 'real-parent-auth-secret',
      GUEST_COOKIE_SECRET: 'real-parent-guest-secret',
      BETTER_AUTH_URL: 'https://real-parent.example.test',
      TRUSTED_ORIGINS: 'https://real-parent.example.test',
      AUTH_TRUSTED_PROXY_CIDRS: '192.0.2.0/24',
      AUTH_EMAIL_FROM: 'real-parent@example.test',
      AUTH_EMAIL_DELIVERY_MODE: 'webhook',
      GOOGLE_CLIENT_ID: 'real-parent-google-id',
      GOOGLE_CLIENT_SECRET: 'real-parent-google-secret',
      APPLE_CLIENT_ID: 'real-parent-apple-id',
      APPLE_CLIENT_SECRET: 'real-parent-apple-secret',
      AUTH_EMAIL_WEBHOOK_URL: 'https://real-parent.example.test/webhook',
      AUTH_EMAIL_WEBHOOK_SECRET: 'real-parent-webhook-secret'
    })
    const snapshot = { ...parent }
    const environment = createPhase7SsoTestEnvironment(parent)
    expect(parent).toEqual(snapshot)
    expect(JSON.stringify(environment)).not.toContain('real-parent')
    expect(parseApiEnvironment(environment).NODE_ENV).toBe('test')
    for (const key of [
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'APPLE_CLIENT_ID',
      'APPLE_CLIENT_SECRET',
      'AUTH_EMAIL_WEBHOOK_URL',
      'AUTH_EMAIL_WEBHOOK_SECRET'
    ])
      expect(Object.hasOwn(environment, key)).toBe(false)
  })

  it('does not evaluate shadowed parent credential or webhook getters', () => {
    let reads = 0
    const base: NodeJS.ProcessEnv = { ...wrappers }
    const keys = [
      'BETTER_AUTH_SECRET',
      'GUEST_COOKIE_SECRET',
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'APPLE_CLIENT_ID',
      'APPLE_CLIENT_SECRET',
      'AUTH_EMAIL_WEBHOOK_URL',
      'AUTH_EMAIL_WEBHOOK_SECRET'
    ]
    for (const key of keys) {
      Object.defineProperty(base, key, {
        enumerable: true,
        get: () => {
          reads += 1
          throw new Error('parent value accessed')
        }
      })
    }
    expect(
      parseApiEnvironment(createPhase7SsoTestEnvironment(base)).NODE_ENV
    ).toBe('test')
    expect(reads).toBe(0)
    for (const key of keys)
      expect(Object.getOwnPropertyDescriptor(base, key)?.get).toBeTypeOf(
        'function'
      )
  })

  it('passes the completed profile and unchanged wrappers to the SSO manifest child', async () => {
    const environment = createPhase7SsoTestEnvironment(wrappers)
    let rawPath = ''
    const count = await runPhase10ManifestVitestFile({
      testFile: phase7SsoTestFile,
      environment,
      runCommand: async (_command, args, childEnvironment) => {
        expect(childEnvironment).toBe(environment)
        expect(parseApiEnvironment(childEnvironment).NODE_ENV).toBe('test')
        expect(childEnvironment.DATABASE_URL).toBe(wrappers.DATABASE_URL)
        expect(childEnvironment.AUTH_GATEWAY_DATABASE_URL).toBe(
          wrappers.AUTH_GATEWAY_DATABASE_URL
        )
        rawPath = args
          .find((arg) => arg.startsWith('--outputFile='))!
          .slice('--outputFile='.length)
        await writeFile(
          rawPath,
          JSON.stringify({
            numFailedTests: 0,
            numPassedTests: 1,
            numPendingTests: 0,
            numTodoTests: 0,
            numTotalTests: 1,
            testResults: [{ name: phase7SsoTestFile }]
          })
        )
      }
    })
    expect(count).toBe(1)
    await expect(stat(rawPath)).rejects.toThrow()
  })
})

describe('Phase 7 opt-in foundation execution', () => {
  it('preserves the default list and refuses arbitrary paths', () => {
    const files = [phase7DbFoundationTestFile, 'other.ts']
    expect(selectPhase7DbIntegrationFiles(files, {})).toBe(files)
    expect(
      selectPhase7DbIntegrationFiles(files, {
        PHASE7_DB_SINGLE_TEST: phase7DbFoundationTestFile
      })
    ).toEqual([phase7DbFoundationTestFile])
    expect(() =>
      selectPhase7DbIntegrationFiles(files, {
        PHASE7_DB_SINGLE_TEST: '../secret'
      })
    ).toThrow('allowlist')
  })

  it('selects only the registered SSO file and rejects absent or expanded selectors', () => {
    const files = [phase7DbFoundationTestFile, phase7SsoTestFile]
    expect(
      selectPhase7DbIntegrationFiles(files, {
        PHASE7_DB_SINGLE_TEST: phase7SsoTestFile
      })
    ).toEqual([phase7SsoTestFile])
    for (const selector of [
      phase7SsoTestFile + ' other.ts',
      'src/db/*.integration.test.ts',
      '../' + phase7SsoTestFile
    ]) {
      expect(() =>
        selectPhase7DbIntegrationFiles(files, {
          PHASE7_DB_SINGLE_TEST: selector
        })
      ).toThrow('allowlist')
    }
    expect(() =>
      selectPhase7DbIntegrationFiles([phase7DbFoundationTestFile], {
        PHASE7_DB_SINGLE_TEST: phase7SsoTestFile
      })
    ).toThrow('allowlist')
  })

  it('labels both fixed selectors accurately and redacts arbitrary report paths', () => {
    for (const file of [phase7DbFoundationTestFile, phase7SsoTestFile])
      expect(sanitizePhase7VitestReport({}, file).testFile).toBe(file)
    expect(sanitizePhase7VitestReport({}, '../private-password').testFile).toBe(
      'not-allowlisted'
    )
  })

  it.each([
    'EnvironmentValidationError: API environment validation failed: BETTER_AUTH_SECRET, GUEST_COOKIE_SECRET',
    'API environment validation failed: AUTH_EMAIL_FROM invalid-value postgres://private:password@private/db\n private-stack'
  ])(
    'classifies environment setup failures without retaining invalid fields or values: %s',
    (message) => {
      const report = sanitizePhase7VitestReport(
        { testResults: [{ message }] },
        phase7SsoTestFile
      )
      expect(report.errors).toEqual([
        { diagnosticId: 'CONFIG_ENVIRONMENT_INVALID', location: 'setup' }
      ])
      expect(JSON.stringify(report)).not.toMatch(
        /BETTER_AUTH_SECRET|GUEST_COOKIE_SECRET|AUTH_EMAIL_FROM|invalid-value|postgres:|password|private-stack/
      )
    }
  )

  it('excludes failure messages, names, URLs, and unknown fields', () => {
    const report = sanitizePhase7VitestReport(
      {
        numFailedTests: 1,
        numTotalTests: 1,
        testResults: [
          {
            name: 'postgres://secret',
            failureMessage: 'password',
            assertionResults: [
              { fullName: 'token', failureMessages: ['secret'] }
            ]
          }
        ]
      },
      phase7DbFoundationTestFile
    )
    expect(JSON.stringify(report)).not.toMatch(/postgres|password|token|secret/)
    expect(report.failed).toBe(1)
  })

  it('preserves bounded collection diagnostics without raw messages or stacks', () => {
    const report = sanitizePhase7VitestReport(
      {
        numTotalTests: 0,
        numFailedTests: 0,
        testResults: [
          {
            status: 'failed',
            message:
              'TypeError: Cannot find module postgres://user:password@localhost/db?token=secret\n at private-stack'
          },
          {
            failureMessage:
              'SyntaxError: does not provide an export password=hidden'
          },
          { message: 'unexpected secret-value' },
          { message: 'extra' }
        ]
      },
      phase7DbFoundationTestFile
    )
    expect(report.total).toBe(0)
    expect(report.errors).toEqual([
      { diagnosticId: 'MODULE_DEPENDENCY_MISSING', location: 'module' },
      { diagnosticId: 'MODULE_EXPORT_MISMATCH', location: 'module' },
      { diagnosticId: 'UNKNOWN_REDACTED', location: 'unknown' }
    ])
    expect(JSON.stringify(report)).not.toMatch(
      /postgres:|password|token|secret-value|private-stack|hidden/
    )
  })

  it.each([
    ['Cannot find module private', 'MODULE_DEPENDENCY_MISSING', 'module'],
    [
      'Phase 7 admin integration database URL is required.',
      'CONFIG_WRAPPER_MISSING',
      'config'
    ],
    [
      'Phase 7 DB endpoint identity is unavailable.',
      'SETUP_ENDPOINT_UNAVAILABLE',
      'setup'
    ],
    ['password=private token=private', 'UNKNOWN_REDACTED', 'unknown']
  ])(
    'classifies fixed diagnostics and only records wrapper presence: %s',
    (message, diagnosticId, location) => {
      const report = sanitizePhase7VitestReport(
        { testResults: [{ message }] },
        phase7DbFoundationTestFile,
        {
          PHASE7_ADMIN_DATABASE_URL: 'private-url',
          PHASE7_LEGACY_DATABASE_URL: '  ',
          PHASE7_DEVELOPMENT_APP_DATABASE_URL: 'secret-token'
        }
      )
      expect(report.errors).toEqual([{ diagnosticId, location }])
      expect(report.dependenciesPresent).toEqual({
        adminWrapper: true,
        legacyWrapper: false,
        developmentWrapper: true
      })
      expect(JSON.stringify(report)).not.toMatch(
        /private|secret|password|token/
      )
    }
  )

  it.each([
    [phase7DbFoundationTestFile, false],
    [phase7DbFoundationTestFile, true],
    [phase7SsoTestFile, false],
    [phase7SsoTestFile, true]
  ] as const)(
    'deletes raw JSON and preserves only opt-in sanitized failure evidence: %s / %s',
    async (testFile, preserve) => {
      let rawPath = ''
      const output = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true)
      const environment = {
        AUTH_GATEWAY_DATABASE_URL: 'private-gateway',
        PHASE7_ADMIN_DATABASE_URL: 'private-admin',
        PHASE7_MIGRATION_DATABASE_URL: 'private-migration',
        PHASE7_LEGACY_DATABASE_URL: 'private-legacy',
        PHASE7_DEVELOPMENT_APP_DATABASE_URL: 'private-development'
      }
      try {
        await expect(
          runPhase10ManifestVitestFile({
            testFile,
            environment,
            preserveSanitizedReport: preserve,
            runCommand: async (_command, args, actualEnvironment) => {
              expect(actualEnvironment).toBe(environment)
              if (testFile === phase7SsoTestFile)
                expect(args).toEqual(
                  expect.arrayContaining([
                    '--maxWorkers=1',
                    '--no-file-parallelism',
                    '--bail=1',
                    '--retry=0'
                  ])
                )
              rawPath = args
                .find((arg) => arg.startsWith('--outputFile='))!
                .slice('--outputFile='.length)
              await writeFile(
                rawPath,
                JSON.stringify({
                  numFailedTests: 1,
                  numTotalTests: 1,
                  testResults: [
                    {
                      assertionResults: [
                        { status: 'failed', fullName: 'private-token' }
                      ]
                    }
                  ]
                })
              )
              throw new Error('private-db-url')
            }
          })
        ).rejects.toThrow('process failed')
        await expect(stat(rawPath)).rejects.toThrow()
        if (preserve) {
          const notice = JSON.parse(String(output.mock.calls[0]?.[0])) as {
            reportFile: string
          }
          try {
            expect((await stat(notice.reportFile)).mode & 0o777).toBe(0o600)
            expect(await readFile(notice.reportFile, 'utf8')).not.toMatch(
              /private/
            )
            expect(
              JSON.parse(await readFile(notice.reportFile, 'utf8')).testFile
            ).toBe(testFile)
          } finally {
            await rm(notice.reportFile, { force: true })
          }
        } else {
          expect(output).not.toHaveBeenCalled()
        }
      } finally {
        output.mockRestore()
      }
    }
  )
})

describe('Phase 7 bounded SSO first failed assertion', () => {
  type Mutable<T> = T extends readonly (infer U)[]
    ? Mutable<U>[]
    : T extends object
      ? { -readonly [P in keyof T]: Mutable<T[P]> }
      : T
  type Report = Mutable<Parameters<typeof sanitizePhase7VitestReport>[0]>
  const canonical = (): Report => ({
    numTotalTests: 36,
    numPassedTests: 5,
    numFailedTests: 1,
    numPendingTests: 0,
    numTodoTests: 0,
    testResults: [
      {
        name: '/synthetic/apps/api/' + phase7SsoTestFile,
        status: 'failed',
        message: '',
        assertionResults: Array.from({ length: 36 }, (_, index) => ({
          status: index === 5 ? 'failed' : index < 5 ? 'passed' : 'pending',
          fullName: 'private-name',
          failureMessages:
            index === 5
              ? ['AssertionError: private-message code 23514 private-stack']
              : null
        }))
      }
    ]
  })
  const file = (report: Report) => report.testResults![0]!
  const assertion = (report: Report) => file(report).assertionResults![5]!

  it('adds only ordinal6, fixed prefix class and canonical allowlisted text tokens', () => {
    const input = canonical()
    const target = assertion(input)
    Object.assign(target, {
      title: 'private-title',
      ancestorTitles: ['private-ancestor'],
      name: 'arbitrary-class',
      stack: 'private-stack',
      failureMessages: [
        'AssertionError: private-message 42501 23514 23503 23514 42P01',
        'postgres://private:private-password@private/db?token=private-secret'
      ]
    })
    const report = sanitizePhase7VitestReport(input, phase7SsoTestFile)
    expect(report).toEqual({
      schemaVersion: 1,
      testFile: phase7SsoTestFile,
      total: 36,
      passed: 5,
      failed: 1,
      pending: 0,
      todo: 0,
      dependenciesPresent: {
        adminWrapper: false,
        legacyWrapper: false,
        developmentWrapper: false
      },
      errors: [],
      firstFailedAssertion: {
        caseOrdinal: 6,
        errorClass: 'AssertionError',
        recognizedSqlstates: ['23503', '23514', '42501']
      }
    })
    expect(JSON.stringify(report)).not.toMatch(
      /private|arbitrary|42P01|postgres:/
    )
  })

  it.each([
    [
      'wrong path',
      (r: Report) => {
        file(r).name = 'src/db/other.test.ts'
      }
    ],
    [
      'missing path',
      (r: Report) => {
        delete file(r).name
      }
    ],
    [
      'parent path',
      (r: Report) => {
        file(r).name = '../' + phase7SsoTestFile
      }
    ],
    [
      'wrong total',
      (r: Report) => {
        r.numTotalTests = 35
      }
    ],
    [
      'short assertions',
      (r: Report) => {
        file(r).assertionResults = file(r).assertionResults!.slice(1)
      }
    ],
    [
      'long assertions',
      (r: Report) => {
        file(r).assertionResults = [
          ...file(r).assertionResults!,
          { status: 'pending' }
        ]
      }
    ],
    [
      'missing assertions',
      (r: Report) => {
        delete file(r).assertionResults
      }
    ],
    [
      'multiple failures',
      (r: Report) => {
        Object.assign(file(r).assertionResults![7]!, { status: 'failed' })
      }
    ],
    [
      'zero failed count',
      (r: Report) => {
        r.numFailedTests = 0
      }
    ],
    [
      'multiple failed count',
      (r: Report) => {
        r.numFailedTests = 2
      }
    ],
    [
      'no failed assertion',
      (r: Report) => {
        Object.assign(assertion(r), { status: 'pending' })
      }
    ],
    [
      'multiple file results',
      (r: Report) => {
        r.testResults = [...r.testResults!, file(r)]
      }
    ],
    [
      'unknown assertion status',
      (r: Report) => {
        Object.assign(file(r).assertionResults![8]!, { status: 'arbitrary' })
      }
    ],
    [
      'success file',
      (r: Report) => {
        file(r).status = 'passed'
      }
    ],
    [
      'collection failure',
      (r: Report) => {
        file(r).message = 'Error: Cannot find module private-module'
      }
    ]
  ])('omits metadata for noncanonical %s', (_label, mutate) => {
    const input = canonical()
    mutate(input)
    const report = sanitizePhase7VitestReport(input, phase7SsoTestFile)
    expect(report).not.toHaveProperty('firstFailedAssertion')
    if (_label === 'collection failure') {
      expect(report.errors).toEqual([
        { diagnosticId: 'MODULE_DEPENDENCY_MISSING', location: 'module' }
      ])
    }
  })

  it('keeps success, foundation and arbitrary selector shapes unchanged', () => {
    const success = canonical()
    success.numFailedTests = 0
    success.numPassedTests = 36
    file(success).status = 'passed'
    file(success).assertionResults = Array.from({ length: 36 }, () => ({
      status: 'passed',
      failureMessages: null
    }))
    for (const [input, selected] of [
      [success, phase7SsoTestFile],
      [canonical(), phase7DbFoundationTestFile],
      [canonical(), '../private-file']
    ] as const) {
      expect(sanitizePhase7VitestReport(input, selected)).not.toHaveProperty(
        'firstFailedAssertion'
      )
    }
  })

  it.each([
    { failureMessages: null },
    { failureMessages: undefined },
    { failureMessages: ['arbitrary-class: private-secret 42P01'] },
    {
      failureMessages: [
        'private-prefix AssertionError: 123514 23514X X42501 _23503 42501_'
      ]
    },
    { failureMessages: ['private-message\nError: private-stack'] }
  ])(
    'omits unmatched class and tokens without copying raw fields: %j',
    ({ failureMessages }) => {
      const input = canonical()
      Object.assign(assertion(input), { failureMessages })
      expect(
        sanitizePhase7VitestReport(input, phase7SsoTestFile)
          .firstFailedAssertion
      ).toEqual({ caseOrdinal: 6 })
    }
  )

  it.each(['AssertionError', 'TypeError', 'Error'] as const)(
    'classifies only the fixed %s prefix',
    (name) => {
      const input = canonical()
      Object.assign(assertion(input), {
        failureMessages: [`${name}: private-secret`]
      })
      expect(
        sanitizePhase7VitestReport(input, phase7SsoTestFile)
          .firstFailedAssertion
      ).toEqual({ caseOrdinal: 6, errorClass: name })
    }
  )

  it('examines at most three messages and 8192 characters without a truncated token match', () => {
    const input = canonical()
    const messages = [
      'private-secret',
      ' '.repeat(8187) + '23514X',
      ' '.repeat(8192) + 'Error: 42501'
    ]
    Object.defineProperty(messages, 3, {
      get: () => {
        throw new Error('fourth message accessed')
      }
    })
    Object.assign(assertion(input), { failureMessages: messages })
    expect(
      sanitizePhase7VitestReport(input, phase7SsoTestFile).firstFailedAssertion
    ).toEqual({ caseOrdinal: 6 })
  })

  it('fails closed on null assertions and tolerates malformed failureMessages', () => {
    const input = canonical()
    const malformed = JSON.parse(JSON.stringify(input)) as Report
    Object.assign(file(malformed), {
      assertionResults: [null, ...file(input).assertionResults!.slice(1)]
    })
    expect(
      sanitizePhase7VitestReport(malformed, phase7SsoTestFile)
    ).not.toHaveProperty('firstFailedAssertion')
    for (const failureMessages of [42, {}, [null, 42, {}]]) {
      Object.assign(assertion(input), { failureMessages })
      expect(
        sanitizePhase7VitestReport(input, phase7SsoTestFile)
          .firstFailedAssertion
      ).toEqual({ caseOrdinal: 6 })
    }
  })

  it.each([1, 36])(
    'keeps the marked assertion ordinal within 1..36: %s',
    (ordinal) => {
      const input = canonical()
      Object.assign(assertion(input), { status: 'pending' })
      Object.assign(file(input).assertionResults![ordinal - 1]!, {
        status: 'failed',
        failureMessages: null
      })
      expect(
        sanitizePhase7VitestReport(input, phase7SsoTestFile)
          .firstFailedAssertion
      ).toEqual({ caseOrdinal: ordinal })
    }
  )

  it('recognizes allowlisted tokens without inventing an arbitrary error class', () => {
    const input = canonical()
    Object.assign(assertion(input), {
      failureMessages: ['PrivateDatabaseError: private-secret 23514']
    })
    expect(
      sanitizePhase7VitestReport(input, phase7SsoTestFile).firstFailedAssertion
    ).toEqual({ caseOrdinal: 6, recognizedSqlstates: ['23514'] })
  })

  it('preserves canonical bounded metadata and collection diagnostics while deleting the raw temp report', async () => {
    const output = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true)
    const onCollectionDiagnostic = vi.fn()
    let rawPath = ''
    let safePath = ''
    try {
      await expect(
        runPhase10ManifestVitestFile({
          testFile: phase7SsoTestFile,
          preserveSanitizedReport: true,
          onCollectionDiagnostic,
          environment: {
            AUTH_GATEWAY_DATABASE_URL: 'private-gateway',
            PHASE7_ADMIN_DATABASE_URL: 'private-admin',
            PHASE7_MIGRATION_DATABASE_URL: 'private-migration',
            PHASE7_LEGACY_DATABASE_URL: 'private-legacy',
            PHASE7_DEVELOPMENT_APP_DATABASE_URL: 'private-development'
          },
          runCommand: async (_command, args) => {
            rawPath = args
              .find((arg) => arg.startsWith('--outputFile='))!
              .slice('--outputFile='.length)
            await writeFile(rawPath, JSON.stringify(canonical()))
            throw new Error('private-failure')
          }
        })
      ).rejects.toThrow('process failed')
      await expect(stat(rawPath)).rejects.toThrow()
      safePath = (
        JSON.parse(String(output.mock.calls[0]?.[0])) as { reportFile: string }
      ).reportFile
      expect((await stat(safePath)).mode & 0o777).toBe(0o600)
      const safe = await readFile(safePath, 'utf8')
      expect(safe).not.toMatch(/private/)
      expect(JSON.parse(safe).firstFailedAssertion).toEqual({
        caseOrdinal: 6,
        errorClass: 'AssertionError',
        recognizedSqlstates: ['23514']
      })
      expect(onCollectionDiagnostic).toHaveBeenCalledWith({
        stage: 'unknown',
        name: 'UNKNOWN_REDACTED',
        code: 'UNKNOWN_REDACTED'
      })
    } finally {
      output.mockRestore()
      if (safePath) await rm(safePath, { force: true })
    }
  })
})

describe.each([
  {
    mode: 'sso-ordinal6',
    title: phase7SsoOrdinal6Title,
    pattern: phase7SsoOrdinal6Pattern,
    id: 'SSO_APPLE_ADMIN_FRESH_ORDINAL6',
    sourceOrdinal: 6
  },
  {
    mode: 'sso-identity',
    title: phase7SsoIdentityTitle,
    pattern: phase7SsoIdentityPattern,
    id: 'SSO_PROVIDER_SUB_IDENTITY_ORDINAL5',
    sourceOrdinal: 5
  }
] as const)('Phase 7 fixed SSO $mode diagnosis', (fixedCase) => {
  const environment = {
    PHASE7_DB_CASE: fixedCase.mode,
    PHASE7_DB_SINGLE_TEST: phase7SsoTestFile,
    PHASE7_DB_PRESERVE_REPORT: '1',
    PHASE7_ADMIN_DATABASE_URL: 'synthetic-admin',
    AUTH_GATEWAY_DATABASE_URL: 'synthetic-auth',
    PHASE7_LEGACY_DATABASE_URL: 'synthetic-legacy',
    PHASE7_DEVELOPMENT_APP_DATABASE_URL: 'synthetic-development',
    PRISMA_TEST_DATABASE_URL: 'synthetic-test'
  }
  const report = (status: 'passed' | 'failed') => ({
    numTotalTests: 36,
    numPassedTests: status === 'passed' ? 1 : 0,
    numFailedTests: status === 'failed' ? 1 : 0,
    numPendingTests: 35,
    numTodoTests: 0,
    testResults: [
      {
        name: phase7SsoTestFile as string,
        status,
        assertionResults: Array.from({ length: 36 }, (_, index) => ({
          fullName:
            index === fixedCase.sourceOrdinal - 1
              ? `JLP-508 SSO task-owned PostgreSQL contract ${fixedCase.title}`
              : 'private-other-title',
          status: index === fixedCase.sourceOrdinal - 1 ? status : 'pending',
          failureMessages:
            index === fixedCase.sourceOrdinal - 1 && status === 'failed'
              ? [
                  "PrismaClientKnownRequestError: private-value SQL secret code: 'P2010' SQLSTATE 23514\n    at privateFunction (/private/user/apps/api/src/auth/ssoAdminFreshRepository.ts:123:4)\n    at privateFunction (/private/user/apps/api/src/db/phase7SsoTestFixture.ts:99:1)"
                ]
              : []
        }))
      }
    ]
  })

  it('accepts only the fixed mode with SSO file and sanitized report preservation', () => {
    expect(
      selectPhase7DbIntegrationFiles([phase7SsoTestFile], environment)
    ).toEqual([phase7SsoTestFile])
    for (const invalid of [
      { PHASE7_DB_CASE: fixedCase.pattern },
      { PHASE7_DB_CASE: '' },
      { PHASE7_DB_CASE: 'sso-unknown' },
      { PHASE7_DB_SINGLE_TEST: undefined },
      { PHASE7_DB_SINGLE_TEST: phase7DbFoundationTestFile },
      { PHASE7_DB_PRESERVE_REPORT: undefined }
    ]) {
      expect(() =>
        selectPhase7DbIntegrationFiles([phase7SsoTestFile], {
          ...environment,
          ...invalid
        })
      ).toThrow('fixed SSO report mode')
    }
  })

  it('projects only finite error labels and source paths, never text SQLSTATE or private values', () => {
    const sanitized = sanitizePhase7VitestReport(
      report('failed'),
      phase7SsoTestFile,
      environment
    )
    expect(sanitized.selectedCase).toEqual({
      id: fixedCase.id,
      sourceOrdinal: fixedCase.sourceOrdinal,
      matched: 1,
      status: 'failed',
      failure: {
        errorClass: 'PrismaClientKnownRequestError',
        recognizedTextCodes: ['P2010'],
        recognizedSourcePaths: [
          'src/auth/ssoAdminFreshRepository.ts',
          'src/db/phase7SsoTestFixture.ts'
        ]
      }
    })
    expect(sanitized).not.toHaveProperty('firstFailedAssertion')
    const json = JSON.stringify(sanitized)
    for (const privateValue of [
      'private',
      'SQL',
      '23514',
      '123',
      '99',
      fixedCase.title
    ])
      expect(json).not.toContain(privateValue)
    expect(json).not.toContain('sqlstate')
  })

  it('bounds messages and ignores unrecognized codes/classes/paths and unrelated selected shapes', () => {
    const value = report('failed')
    value.testResults[0]!.assertionResults[
      fixedCase.sourceOrdinal - 1
    ]!.failureMessages = [
      "UnrecognizedError: private code: 'SECRET' SQLSTATE 42501",
      'x'.repeat(8192) +
        "code: 'P2028'\n    at /private/src/db/phase7SsoTestFixture.ts:1:2",
      'private path /private/src/auth/ssoAdminFreshRepository.ts:1:2',
      "TypeError: private code: 'P2034'"
    ]
    expect(
      sanitizePhase7VitestReport(value, phase7SsoTestFile, environment)
        .selectedCase?.failure
    ).toEqual({ recognizedTextCodes: [], recognizedSourcePaths: [] })
    for (const mutation of [
      (data: ReturnType<typeof report>) => {
        data.testResults[0]!.assertionResults[
          fixedCase.sourceOrdinal - 1
        ]!.fullName += ' altered'
      },
      (data: ReturnType<typeof report>) => {
        data.testResults[0]!.assertionResults[0]!.status = 'passed'
      },
      (data: ReturnType<typeof report>) => {
        data.numPendingTests = 34
      },
      (data: ReturnType<typeof report>) => {
        data.testResults[0]!.name = phase7DbFoundationTestFile
      },
      (data: ReturnType<typeof report>) => {
        data.testResults[0]!.assertionResults[0]!.fullName = `JLP-508 SSO task-owned PostgreSQL contract ${fixedCase.title}`
      },
      (data: ReturnType<typeof report>) => {
        data.testResults[0]!.assertionResults[
          fixedCase.sourceOrdinal - 1
        ]!.fullName =
          `JLP-508 SSO task-owned PostgreSQL contract ${fixedCase.mode === 'sso-identity' ? phase7SsoOrdinal6Title : phase7SsoIdentityTitle}`
      },
      (data: ReturnType<typeof report>) => {
        data.numPassedTests = 2
      },
      (data: ReturnType<typeof report>) => {
        data.numFailedTests = 1
      },
      (data: ReturnType<typeof report>) => {
        data.numTodoTests = 1
      },
      (data: ReturnType<typeof report>) => {
        data.numTotalTests = 35
      },
      (data: ReturnType<typeof report>) => {
        data.testResults[0]!.status = 'failed'
      },
      (data: ReturnType<typeof report>) => {
        data.testResults.push(data.testResults[0]!)
      }
    ]) {
      const changed = report('passed')
      mutation(changed)
      expect(
        sanitizePhase7VitestReport(changed, phase7SsoTestFile, environment)
      ).not.toHaveProperty('selectedCase')
      expect(() =>
        assertPhase10VitestFileResult({
          result: changed,
          expectedPath: phase7SsoTestFile,
          selectedSsoCase: fixedCase.mode
        })
      ).toThrow('incomplete')
    }
  })

  it.each(['passed', 'failed'] as const)(
    'uses the literal pattern, returns one selected success and deletes raw %s reporter data',
    async (status) => {
      let rawPath = ''
      let reportPath = ''
      const stdout = vi
        .spyOn(process.stdout, 'write')
        .mockImplementation((chunk) => {
          const event = JSON.parse(String(chunk)) as { reportFile: string }
          reportPath = event.reportFile
          return true
        })
      try {
        const run = runPhase10ManifestVitestFile({
          testFile: phase7SsoTestFile,
          environment,
          preserveSanitizedReport: true,
          runCommand: async (_command, args) => {
            expect(
              args.slice(
                args.indexOf('--testNamePattern'),
                args.indexOf('--testNamePattern') + 2
              )
            ).toEqual(['--testNamePattern', fixedCase.pattern])
            for (const flag of [
              '--maxWorkers=1',
              '--no-file-parallelism',
              '--bail=1',
              '--retry=0'
            ])
              expect(args).toContain(flag)
            rawPath = args
              .find((arg) => arg.startsWith('--outputFile='))!
              .slice('--outputFile='.length)
            await writeFile(rawPath, JSON.stringify(report(status)))
            if (status === 'failed') throw new Error('private child failure')
          }
        })
        if (status === 'passed') await expect(run).resolves.toBe(1)
        else await expect(run).rejects.toThrow('tests=redacted')
        await expect(stat(rawPath)).rejects.toThrow()
        expect((await stat(reportPath)).mode & 0o777).toBe(0o600)
        const safe = await readFile(reportPath, 'utf8')
        expect(JSON.parse(safe).selectedCase).toMatchObject({
          id: fixedCase.id,
          sourceOrdinal: fixedCase.sourceOrdinal,
          matched: 1,
          status
        })
        expect(safe).not.toContain('private')
      } finally {
        stdout.mockRestore()
        if (reportPath) await rm(reportPath, { force: true })
      }
    }
  )

  it('rejects arbitrary direct selectors before starting a child', async () => {
    for (const mode of ['sso-unknown', '', fixedCase.pattern]) {
      const runCommand = vi.fn()
      await expect(
        runPhase10ManifestVitestFile({
          testFile: phase7SsoTestFile,
          environment: { ...environment, PHASE7_DB_CASE: mode },
          preserveSanitizedReport: true,
          runCommand
        })
      ).rejects.toThrow('fixed SSO report mode')
      expect(runCommand).not.toHaveBeenCalled()
    }
  })

  it('rejects inconsistent direct helper options before starting a child', async () => {
    const runCommand = vi.fn()
    await expect(
      runPhase10ManifestVitestFile({
        testFile: phase7SsoTestFile,
        environment,
        runCommand
      })
    ).rejects.toThrow('requires sanitized reporting')
    expect(runCommand).not.toHaveBeenCalled()
  })
})
