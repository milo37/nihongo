import { spawnSync } from 'node:child_process'
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
  readonly readProcessGroupMemberPids?: (processGroupId: number) => number[]
}

export const shouldDetachOwnedProcess = process.platform !== 'win32'

const readProcessErrorCode = (error: unknown): string | undefined =>
  error instanceof Error && 'code' in error
    ? (error as NodeJS.ErrnoException).code
    : undefined

const isMissingProcessError = (error: unknown): boolean =>
  readProcessErrorCode(error) === 'ESRCH'

const isPermissionProcessError = (error: unknown): boolean =>
  readProcessErrorCode(error) === 'EPERM'

const readOwnedProcessGroupMemberPids = (processGroupId: number): number[] => {
  if (typeof process.getuid !== 'function') {
    throw new Error('Cannot verify an inaccessible POSIX process group.')
  }
  const result = spawnSync('ps', ['-axo', 'pid=,pgid=,uid=,state='], {
    encoding: 'utf8'
  })
  if (result.error || result.status !== 0) {
    throw new Error('Cannot inspect an inaccessible POSIX process group.', {
      cause: result.error
    })
  }
  const ownerUserId = process.getuid()
  return result.stdout
    .split('\n')
    .map((line) => line.trim().split(/\s+/u))
    .flatMap(([pidText, groupText, userText, state = '']) => {
      const pid = Number(pidText)
      const groupId = Number(groupText)
      const userId = Number(userText)
      return Number.isSafeInteger(pid) &&
        groupId === processGroupId &&
        userId === ownerUserId &&
        !state.startsWith('Z')
        ? [pid]
        : []
    })
}

const signalOwnedProcess = (
  ownedProcess: OwnedProcess,
  signal: NodeJS.Signals,
  readProcessGroupMemberPids: (processGroupId: number) => number[]
): void => {
  const { child } = ownedProcess
  if (shouldDetachOwnedProcess && child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal)
    } catch (error: unknown) {
      if (isMissingProcessError(error)) {
        return
      }
      if (!isPermissionProcessError(error)) throw error
      readProcessGroupMemberPids(child.pid).forEach((pid) => {
        try {
          process.kill(pid, signal)
        } catch (memberError: unknown) {
          if (!isMissingProcessError(memberError)) throw memberError
        }
      })
    }
    return
  }
  try {
    child.kill(signal)
  } catch (error: unknown) {
    if (!isMissingProcessError(error)) {
      throw error
    }
  }
}

const isOwnedProcessRunning = (
  ownedProcess: OwnedProcess,
  readProcessGroupMemberPids: (processGroupId: number) => number[]
): boolean => {
  const { child } = ownedProcess
  if (shouldDetachOwnedProcess && child.pid !== undefined) {
    try {
      process.kill(-child.pid, 0)
      return true
    } catch (error: unknown) {
      if (isMissingProcessError(error)) {
        return false
      }
      if (!isPermissionProcessError(error)) throw error
      return readProcessGroupMemberPids(child.pid).length > 0
    }
  }
  return child.exitCode === null && child.signalCode === null
}

const waitForOwnedProcesses = async (
  ownedProcesses: readonly OwnedProcess[],
  timeoutMs: number,
  readProcessGroupMemberPids: (processGroupId: number) => number[]
): Promise<OwnedProcess[]> => {
  const deadline = Date.now() + timeoutMs
  let running = ownedProcesses.filter((ownedProcess) =>
    isOwnedProcessRunning(ownedProcess, readProcessGroupMemberPids)
  )

  while (running.length > 0 && Date.now() < deadline) {
    await delay(Math.min(50, Math.max(1, deadline - Date.now())))
    running = running.filter((ownedProcess) =>
      isOwnedProcessRunning(ownedProcess, readProcessGroupMemberPids)
    )
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
  const readProcessGroupMemberPids =
    options.readProcessGroupMemberPids ?? readOwnedProcessGroupMemberPids
  const initiallyRunning = uniqueProcesses.filter((ownedProcess) =>
    isOwnedProcessRunning(ownedProcess, readProcessGroupMemberPids)
  )

  initiallyRunning.forEach((ownedProcess) => {
    signalOwnedProcess(ownedProcess, 'SIGTERM', readProcessGroupMemberPids)
  })
  const survivors = await waitForOwnedProcesses(
    initiallyRunning,
    gracefulTimeoutMs,
    readProcessGroupMemberPids
  )
  survivors.forEach((ownedProcess) => {
    options.onForceKill?.(ownedProcess)
    signalOwnedProcess(ownedProcess, 'SIGKILL', readProcessGroupMemberPids)
  })
  const remaining = await waitForOwnedProcesses(
    survivors,
    forceKillTimeoutMs,
    readProcessGroupMemberPids
  )

  if (remaining.length > 0) {
    throw new Error(
      `Owned process groups did not stop: ${remaining
        .map(({ label }) => label)
        .join(', ')}`
    )
  }
}

export const retireOwnedProcess = async (
  ownedProcesses: OwnedProcess[],
  ownedProcess: OwnedProcess,
  stopProcesses: (
    processes: readonly OwnedProcess[]
  ) => Promise<void> = stopOwnedProcesses
): Promise<void> => {
  await stopProcesses([ownedProcess])
  const processIndex = ownedProcesses.indexOf(ownedProcess)
  if (processIndex >= 0) {
    ownedProcesses.splice(processIndex, 1)
  }
}
