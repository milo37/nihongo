import { afterEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({
  environment: vi.fn(),
  create: vi.fn()
}))
vi.mock('../config/env.js', () => ({
  parseApiEnvironment: runtime.environment
}))
vi.mock('../db/database.js', () => ({
  createDatabaseRuntime: runtime.create
}))

import { runStudyCleanupCommand } from './studyCleanupCommandRunner.js'

const settings = {
  batchSizeVariable: 'TEST_CLEANUP_BATCH_SIZE',
  confirmationVariable: 'TEST_CLEANUP_CONFIRM',
  confirmation: 'DELETE_TEST_ROWS',
  defaultBatchSize: 10,
  maxBatchSize: 100,
  successEvent: 'test.cleaned',
  failureEvent: 'test.cleanup_failed',
  cleanup: vi.fn(async () => ({})),
  describe: () => ({})
}

const runAndWait = async (): Promise<string> => {
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
  runStudyCleanupCommand(settings)
  await vi.waitFor(() => expect(stderr).toHaveBeenCalled())
  return String(stderr.mock.calls[0]?.[0])
}

describe('study cleanup command runner', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    process.exitCode = undefined
  })

  it('fails without the exact confirmation before touching the database', async () => {
    vi.stubEnv('TEST_CLEANUP_CONFIRM', 'yes')
    expect(await runAndWait()).toBe('{"event":"test.cleanup_failed"}\n')
    expect(process.exitCode).toBe(1)
    expect(settings.cleanup).not.toHaveBeenCalled()
  })

  it('rejects a batch size above the command maximum', async () => {
    vi.stubEnv('TEST_CLEANUP_CONFIRM', 'DELETE_TEST_ROWS')
    vi.stubEnv('TEST_CLEANUP_BATCH_SIZE', '101')
    expect(await runAndWait()).toBe('{"event":"test.cleanup_failed"}\n')
    expect(settings.cleanup).not.toHaveBeenCalled()
  })

  it('rejects a dry-run value other than true or false', async () => {
    vi.stubEnv('TEST_CLEANUP_CONFIRM', 'DELETE_TEST_ROWS')
    vi.stubEnv('TEST_CLEANUP_DRY_RUN', 'yes')
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    runStudyCleanupCommand({
      ...settings,
      dryRunVariable: 'TEST_CLEANUP_DRY_RUN'
    })
    await vi.waitFor(() => expect(stderr).toHaveBeenCalled())
    expect(String(stderr.mock.calls[0]?.[0])).toBe(
      '{"event":"test.cleanup_failed"}\n'
    )
    expect(settings.cleanup).not.toHaveBeenCalled()
  })

  describe('#699 production', () => {
    const production =
      'postgresql://runtime:secret@db.internal:5432/nihongo?schema=app'
    const runInProduction = (databaseUrl: string, allowProduction?: true) => {
      vi.stubEnv('TEST_CLEANUP_CONFIRM', 'DELETE_TEST_ROWS')
      vi.stubEnv('PRODUCTION_DATABASE_URL', production)
      runtime.environment.mockReturnValue({
        NODE_ENV: 'production',
        DATABASE_URL: databaseUrl
      })
      runStudyCleanupCommand(
        allowProduction ? { ...settings, allowProduction } : settings
      )
    }

    it('refuses production unless the command allows it', async () => {
      const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
      runInProduction(production)
      await vi.waitFor(() => expect(stderr).toHaveBeenCalled())
      expect(runtime.create).not.toHaveBeenCalled()
    })

    it('refuses a database other than the exact production target', async () => {
      const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
      runInProduction(
        'postgresql://runtime:secret@other.internal:5432/nihongo?schema=app',
        true
      )
      await vi.waitFor(() => expect(stderr).toHaveBeenCalled())
      expect(runtime.create).not.toHaveBeenCalled()
    })

    it('runs against the exact production target when allowed', async () => {
      const disconnect = vi.fn(async () => {})
      runtime.create.mockReturnValue({
        client: {},
        checkReadiness: vi.fn(async () => {}),
        disconnect
      })
      const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
      runInProduction(production, true)
      await vi.waitFor(() => expect(stdout).toHaveBeenCalled())
      expect(runtime.create).toHaveBeenCalledWith(production, {
        migrationProfile: 'current',
        startupRole: 'nihongo_app'
      })
      expect(settings.cleanup).toHaveBeenCalledWith({}, 10, false)
      expect(disconnect).toHaveBeenCalledOnce()
      expect(String(stdout.mock.calls[0]?.[0])).toBe(
        '{"event":"test.cleaned","batchSize":10}\n'
      )
    })
  })
})
