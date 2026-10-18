import { readFile, rm, stat, writeFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import {
  phase7DbFoundationTestFile,
  phase7SsoTestFile,
  runPhase10ManifestVitestFile,
  sanitizePhase7VitestReport,
  selectPhase7DbIntegrationFiles
} from './phase10ApiIntegrationExecution.js'

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
