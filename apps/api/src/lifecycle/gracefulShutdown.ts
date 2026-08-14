const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000

export interface ClosableServer {
  close: (callback?: (error?: Error) => void) => unknown
  closeAllConnections?: () => void
}

interface GracefulShutdownDependencies {
  abortBackgroundTasks?: () => void
  drainBackgroundTasks?: () => Promise<void>
  disconnectDatabase: () => Promise<void>
  server: ClosableServer
  timeoutMs?: number
}

const closeServer = (server: ClosableServer): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })

const runWithTimeout = async (
  operation: () => Promise<void>,
  timeoutMs: number,
  timeoutMessage: string,
  onTimeout?: () => void
): Promise<void> => {
  let timeout: NodeJS.Timeout | undefined

  try {
    await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          onTimeout?.()
          reject(new Error(timeoutMessage))
        }, timeoutMs)
      })
    ])
  } finally {
    if (timeout) {
      clearTimeout(timeout)
    }
  }
}

export const stopServerGracefully = async ({
  abortBackgroundTasks,
  drainBackgroundTasks,
  disconnectDatabase,
  server,
  timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS
}: GracefulShutdownDependencies): Promise<void> => {
  let closeFailure: unknown

  try {
    await runWithTimeout(
      () => closeServer(server),
      timeoutMs,
      `Server shutdown exceeded ${timeoutMs}ms.`,
      () => server.closeAllConnections?.()
    )
  } catch (error: unknown) {
    closeFailure =
      error instanceof Error ? error : new Error('Server shutdown failed.')
  }

  let backgroundFailure: unknown

  if (drainBackgroundTasks) {
    try {
      await runWithTimeout(
        drainBackgroundTasks,
        timeoutMs,
        `Background task drain exceeded ${timeoutMs}ms.`,
        abortBackgroundTasks
      )
    } catch (error: unknown) {
      backgroundFailure =
        error instanceof Error
          ? error
          : new Error('Background task drain failed.')
    }
  }

  let databaseFailure: unknown

  try {
    await runWithTimeout(
      disconnectDatabase,
      timeoutMs,
      `Database disconnect exceeded ${timeoutMs}ms.`
    )
  } catch (error: unknown) {
    databaseFailure =
      error instanceof Error ? error : new Error('Database disconnect failed.')
  }

  const failures = [closeFailure, backgroundFailure, databaseFailure].filter(
    (failure): failure is Error => failure instanceof Error
  )

  if (failures.length > 1) {
    throw new AggregateError(failures, 'Multiple shutdown operations failed.')
  }
  if (failures[0]) {
    throw failures[0]
  }
}
