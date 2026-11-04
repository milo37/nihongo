import { afterEach, describe, expect, it, vi } from 'vitest'
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
})
