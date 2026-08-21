import type { ChildProcess } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

export interface OwnedProcess {
  readonly child: ChildProcess
  readonly label: string
}

interface StopOwnedProcessesOptions {
  readonly forceKillTimeoutMs?: number
  readonly gracefulTimeoutMs?: number
  readonly onForceKill?: (process: OwnedProcess) => void
}

export const shouldDetachOwnedProcess = process.platform !== 'win32'

const isMissingProcessError = (error: unknown): boolean =>
  error instanceof Error &&
  'code' in error &&
  (error as NodeJS.ErrnoException).code === 'ESRCH'

const signalOwnedProcess = (
  ownedProcess: OwnedProcess,
  signal: NodeJS.Signals
): void => {
  const { child } = ownedProcess
  try {
    if (shouldDetachOwnedProcess && child.pid !== undefined) {
      process.kill(-child.pid, signal)
      return
    }
    child.kill(signal)
  } catch (error: unknown) {
    if (!isMissingProcessError(error)) {
      throw error
    }
  }
}

const isOwnedProcessRunning = (ownedProcess: OwnedProcess): boolean => {
  const { child } = ownedProcess
  if (shouldDetachOwnedProcess && child.pid !== undefined) {
    try {
      process.kill(-child.pid, 0)
      return true
    } catch (error: unknown) {
      if (isMissingProcessError(error)) {
        return false
      }
      throw error
    }
  }
  return child.exitCode === null && child.signalCode === null
}

const waitForOwnedProcesses = async (
  ownedProcesses: readonly OwnedProcess[],
  timeoutMs: number
): Promise<OwnedProcess[]> => {
  const deadline = Date.now() + timeoutMs
  let running = ownedProcesses.filter(isOwnedProcessRunning)

  while (running.length > 0 && Date.now() < deadline) {
    await delay(Math.min(50, Math.max(1, deadline - Date.now())))
    running = running.filter(isOwnedProcessRunning)
  }
  return running
}

export const stopOwnedProcesses = async (
  ownedProcesses: readonly OwnedProcess[],
  options: StopOwnedProcessesOptions = {}
): Promise<void> => {
  const uniqueProcesses = Array.from(
    new Map(
      ownedProcesses
        .filter(({ child }) => child.pid !== undefined)
        .map((ownedProcess) => [ownedProcess.child.pid, ownedProcess])
    ).values()
  )
  const gracefulTimeoutMs = options.gracefulTimeoutMs ?? 8_000
  const forceKillTimeoutMs = options.forceKillTimeoutMs ?? 2_000
  const initiallyRunning = uniqueProcesses.filter(isOwnedProcessRunning)

  initiallyRunning.forEach((ownedProcess) => {
    signalOwnedProcess(ownedProcess, 'SIGTERM')
  })
  const survivors = await waitForOwnedProcesses(
    initiallyRunning,
    gracefulTimeoutMs
  )
  survivors.forEach((ownedProcess) => {
    options.onForceKill?.(ownedProcess)
    signalOwnedProcess(ownedProcess, 'SIGKILL')
  })
  const remaining = await waitForOwnedProcesses(survivors, forceKillTimeoutMs)

  if (remaining.length > 0) {
    throw new Error(
      `Owned process groups did not stop: ${remaining
        .map(({ label }) => label)
        .join(', ')}`
    )
  }
}
