interface RunWithPhase10TimeoutOptions<Result> {
  readonly abortSettleTimeoutMs?: number
  readonly cleanup: () => Promise<void>
  readonly cleanupTimeoutMs?: number
  readonly label: string
  readonly onTimeout: () => void
  readonly operation: () => Promise<Result>
  readonly timeoutMs: number
}

export class Phase10RunTimeoutError extends Error {
  readonly code = 'PHASE10_RUN_TIMEOUT'

  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${timeoutMs}ms.`)
    this.name = 'Phase10RunTimeoutError'
  }
}

export class Phase10CleanupTimeoutError extends Error {
  readonly code = 'PHASE10_CLEANUP_TIMEOUT'

  constructor(label: string, timeoutMs: number) {
    super(`${label} cleanup timed out after ${timeoutMs}ms.`)
    this.name = 'Phase10CleanupTimeoutError'
  }
}

interface RunPhase10CleanupWithTimeoutOptions {
  readonly cleanup: () => Promise<void>
  readonly label: string
  readonly timeoutMs: number
}

export const runPhase10CleanupWithTimeout = async ({
  cleanup,
  label,
  timeoutMs
}: RunPhase10CleanupWithTimeoutOptions): Promise<void> => {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Phase 10 cleanup timeout must be a positive integer.')
  }
  let timeoutHandle: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      cleanup(),
      new Promise<never>((_resolve, reject) => {
        timeoutHandle = globalThis.setTimeout(
          () => reject(new Phase10CleanupTimeoutError(label, timeoutMs)),
          timeoutMs
        )
      })
    ])
  } finally {
    if (timeoutHandle) globalThis.clearTimeout(timeoutHandle)
  }
}

export const runWithPhase10Timeout = async <Result>({
  abortSettleTimeoutMs = 5_000,
  cleanup,
  cleanupTimeoutMs = 10_000,
  label,
  onTimeout,
  operation,
  timeoutMs
}: RunWithPhase10TimeoutOptions<Result>): Promise<Result> => {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    !Number.isSafeInteger(abortSettleTimeoutMs) ||
    abortSettleTimeoutMs <= 0 ||
    !Number.isSafeInteger(cleanupTimeoutMs) ||
    cleanupTimeoutMs <= 0
  ) {
    throw new Error('Phase 10 runner timeout must be a positive integer.')
  }
  let timeoutHandle: NodeJS.Timeout | undefined
  let settleTimeoutHandle: NodeJS.Timeout | undefined
  const timeoutOutcome = new Promise<{ readonly timedOut: true }>((resolve) => {
    timeoutHandle = globalThis.setTimeout(
      () => resolve({ timedOut: true }),
      timeoutMs
    )
    timeoutHandle.unref()
  })
  const operationPromise = operation()
  try {
    const outcome = await Promise.race([
      operationPromise.then((value) => ({ timedOut: false as const, value })),
      timeoutOutcome
    ])
    if (!outcome.timedOut) return outcome.value
    const timeoutError = new Phase10RunTimeoutError(label, timeoutMs)
    onTimeout()
    await Promise.race([
      operationPromise.then(
        () => undefined,
        () => undefined
      ),
      new Promise<void>((resolve) => {
        settleTimeoutHandle = globalThis.setTimeout(
          resolve,
          abortSettleTimeoutMs
        )
        settleTimeoutHandle.unref()
      })
    ])
    try {
      await runPhase10CleanupWithTimeout({
        cleanup,
        label,
        timeoutMs: cleanupTimeoutMs
      })
    } catch (cleanupError: unknown) {
      throw new AggregateError(
        [timeoutError, cleanupError],
        `${label} timed out and cleanup failed.`
      )
    }
    throw timeoutError
  } finally {
    if (timeoutHandle) globalThis.clearTimeout(timeoutHandle)
    if (settleTimeoutHandle) globalThis.clearTimeout(settleTimeoutHandle)
  }
}
