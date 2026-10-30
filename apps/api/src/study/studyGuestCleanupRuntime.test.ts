import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  runStudyGuestCleanupProcess,
  type RunGuestCleanupChild
} from './studyGuestCleanupRuntime.js'

const environment = {
  GUEST_CLEANUP_ENVIRONMENT: 'TEST',
  GUEST_CLEANUP_DATABASE_URL:
    'postgresql://nihongo_test_guest_cleanup_worker_login:synthetic@127.0.0.1:5432/nihongo_jlp534_test?schema=jlp534_runtime',
  GUEST_CLEANUP_MAX_DURATION_MS: '100'
}

afterEach(() => vi.restoreAllMocks())

describe('guest cleanup process deadline', () => {
  it('refuses missing configuration before spawning and prints no target', () => {
    const run = vi.fn<RunGuestCleanupChild>()
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    expect(runStudyGuestCleanupProcess({}, run)).toBe(1)
    expect(run).not.toHaveBeenCalled()
    expect(stderr).toHaveBeenCalledWith(
      '{"event":"study.guest_cleanup.failed"}\n'
    )
  })

  it('kills a child that never finishes disconnect and returns failure', () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const startedAt = performance.now()
    const run = vi.fn<RunGuestCleanupChild>((command, _args, options) =>
      spawnSync(
        command,
        [
          '--eval',
          'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'
        ],
        options
      )
    )
    expect(runStudyGuestCleanupProcess(environment, run)).toBe(1)
    expect(performance.now() - startedAt).toBeLessThan(5000)
    expect(run).toHaveBeenCalledWith(
      process.execPath,
      [expect.stringMatching(/studyGuestCleanupCommand\.js$/u)],
      expect.objectContaining({ timeout: 100, killSignal: 'SIGKILL' })
    )
    expect(run.mock.results[0]?.value.signal).toBe('SIGKILL')
  })

  it.each([0, 1])('preserves completed child exit %s', (code) => {
    const run: RunGuestCleanupChild = (command, _args, options) =>
      spawnSync(command, ['--eval', `process.exit(${code})`], {
        ...options,
        timeout: 5000
      })
    expect(runStudyGuestCleanupProcess(environment, run)).toBe(code)
  })
})
