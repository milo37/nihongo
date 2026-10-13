import { readFile, stat, writeFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  classifyCollectionDiagnostic,
  classifyCollectionReport
} from './phase7CollectionDiagnostics.js'
import { runPhase10ManifestVitestFile } from './phase10ApiIntegrationExecution.js'

describe('safe collection diagnostics', () => {
  it.each([
    ['Cannot find module postgres://secret', 'loader', 'ERR_MODULE_NOT_FOUND'],
    ['No matching export password=secret', 'import', 'EXPORT_MISMATCH'],
    [
      'API environment validation failed: SECRET',
      'setup',
      'ENVIRONMENT_INVALID'
    ],
    ['EnvironmentValidationError token=secret', 'setup', 'ENVIRONMENT_INVALID'],
    [
      'Phase 7 admin integration database URL is required.',
      'setup',
      'WRAPPER_MISSING'
    ],
    ['Phase 7 schemas must match exactly.', 'setup', 'SCHEMA_MISMATCH'],
    ['secret unknown', 'unknown', 'UNKNOWN_REDACTED']
  ])('classifies %s without retaining raw data', (message, stage, code) => {
    const output = classifyCollectionDiagnostic(message)
    expect(output).toMatchObject({ stage, code })
    expect(JSON.stringify(output)).not.toMatch(
      /secret|SECRET|postgres|password|token/
    )
  })
  it('reads allowlisted own data without executing getters', () => {
    expect(
      classifyCollectionDiagnostic({
        name: 'EnvironmentValidationError',
        message: 'secret'
      }).code
    ).toBe('ENVIRONMENT_INVALID')
    expect(
      classifyCollectionDiagnostic({ code: 'ERR_MODULE_NOT_FOUND' }).stage
    ).toBe('loader')
    expect(
      classifyCollectionDiagnostic({
        get message() {
          throw new Error('secret')
        }
      }).code
    ).toBe('UNKNOWN_REDACTED')
    expect(
      classifyCollectionReport({
        testResults: [{ message: 'No matching export secret', stack: 'secret' }]
      })
    ).toHaveLength(1)
  })
  it('keeps the existing runner failure and removes raw report even when observer throws', async () => {
    let output = ''
    await expect(
      runPhase10ManifestVitestFile({
        testFile: 'src/db/phase7AdminCmsFoundation.integration.test.ts',
        environment: {
          DATABASE_URL: 'fixture',
          PHASE7_ADMIN_DATABASE_URL: 'fixture',
          PHASE7_MIGRATION_DATABASE_URL: 'fixture',
          PRISMA_TEST_DATABASE_URL: 'fixture',
          NODE_ENV: 'test',
          ADMIN_CMS_MODE: 'technical'
        },
        onCollectionDiagnostic: () => {
          throw new Error('observer secret')
        },
        runCommand: async (_command, args) => {
          output = args
            .find((arg) => arg.startsWith('--outputFile='))!
            .slice('--outputFile='.length)
          await writeFile(
            output,
            JSON.stringify({
              numTotalTests: 0,
              numFailedTests: 0,
              testResults: [
                { message: 'API environment validation failed: secret' }
              ]
            })
          )
          throw new Error('primary secret')
        }
      })
    ).rejects.toThrow('Phase 10 integration process failed:')
    await expect(stat(output)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(output)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('emits safe setup classification before preserving the process failure', async () => {
    const diagnostics: unknown[] = []
    await expect(
      runPhase10ManifestVitestFile({
        testFile: 'src/db/phase7AdminCmsFoundation.integration.test.ts',
        environment: {
          DATABASE_URL: 'fixture',
          PHASE7_ADMIN_DATABASE_URL: 'fixture',
          PHASE7_MIGRATION_DATABASE_URL: 'fixture'
        },
        onCollectionDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
        runCommand: async (_command, args) => {
          const output = args
            .find((arg) => arg.startsWith('--outputFile='))!
            .slice('--outputFile='.length)
          await writeFile(
            output,
            JSON.stringify({
              numTotalTests: 0,
              numFailedTests: 0,
              testResults: [
                { message: 'API environment validation failed: token secret' }
              ]
            })
          )
          throw new Error('primary secret')
        }
      })
    ).rejects.toThrow('Phase 10 integration process failed:')
    expect(diagnostics).toContainEqual({
      stage: 'setup',
      name: 'EnvironmentValidationError',
      code: 'ENVIRONMENT_INVALID'
    })
    expect(JSON.stringify(diagnostics)).not.toMatch(/token|secret/)
  })
  it('keeps missing reporter failure and safe loader diagnostic', async () => {
    const diagnostics: unknown[] = []
    await expect(
      runPhase10ManifestVitestFile({
        testFile: 'src/db/phase7AdminCmsFoundation.integration.test.ts',
        environment: {
          DATABASE_URL: 'fixture',
          PHASE7_ADMIN_DATABASE_URL: 'fixture',
          PHASE7_MIGRATION_DATABASE_URL: 'fixture'
        },
        onCollectionDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
        runCommand: async () => {
          throw Object.assign(new Error('secret'), {
            code: 'ERR_MODULE_NOT_FOUND'
          })
        }
      })
    ).rejects.toThrow('Phase 10 integration process failed:')
    expect(diagnostics).toEqual([
      { stage: 'loader', name: 'Error', code: 'ERR_MODULE_NOT_FOUND' }
    ])
  })
})
