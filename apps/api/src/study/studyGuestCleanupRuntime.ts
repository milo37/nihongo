import dotenv from 'dotenv'
import {
  spawnSync,
  type SpawnSyncOptions,
  type SpawnSyncReturns
} from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseStudyGuestCleanupCommandInput } from './studyGuestCleanupCommandInput.js'

export type RunGuestCleanupChild = (
  command: string,
  args: readonly string[],
  options: SpawnSyncOptions
) => SpawnSyncReturns<Buffer | string>

export const runStudyGuestCleanupProcess = (
  source: NodeJS.ProcessEnv,
  run: RunGuestCleanupChild = (command, args, options) =>
    spawnSync(command, args, options)
): 0 | 1 => {
  try {
    const input = parseStudyGuestCleanupCommandInput(source)
    // The supervisor deadline includes child startup, database work and disconnect.
    const result = run(
      process.execPath,
      [
        fileURLToPath(new URL('./studyGuestCleanupCommand.js', import.meta.url))
      ],
      {
        env: source,
        stdio: 'inherit',
        timeout: input.maxDurationMs,
        killSignal: 'SIGKILL'
      }
    )
    if (result.error || result.signal) {
      throw new Error('Guest cleanup process did not finish.')
    }
    return result.status === 0 ? 0 : 1
  } catch {
    process.stderr.write('{"event":"study.guest_cleanup.failed"}\n')
    return 1
  }
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  dotenv.config({ quiet: true })
  process.exitCode = runStudyGuestCleanupProcess(process.env)
}
