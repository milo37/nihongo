import { readFile, rm, stat, writeFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import {
  EnvironmentValidationError,
  parseApiEnvironment
} from '../config/env.js'
import {
  createPhase7SsoTestEnvironment,
  phase7DbFoundationTestFile,
  phase7SsoTestFile,
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
