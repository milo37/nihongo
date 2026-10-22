export interface ShutdownCoordinator {
  begin: (signal: NodeJS.Signals) => Promise<void>
}

export const createShutdownCoordinator = (
  shutdown: (signal: NodeJS.Signals) => Promise<void>
): ShutdownCoordinator => {
  let shutdownPromise: Promise<void> | undefined

  return {
    begin: (signal) => {
      shutdownPromise ??= shutdown(signal)
      return shutdownPromise
    }
  }
}
