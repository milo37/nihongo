interface Phase10BrowserCleanupActions {
  readonly closeControlServer: () => Promise<void>
  readonly cleanupDatabase: () => Promise<void>
  readonly stopOwnedProcesses: () => Promise<void>
}

export const cleanupPhase10BrowserResources = async (
  actions: Phase10BrowserCleanupActions
): Promise<void> => {
  const errors: unknown[] = []
  let processesStopped = false

  try {
    await actions.stopOwnedProcesses()
    processesStopped = true
  } catch (error: unknown) {
    errors.push(error)
  }

  try {
    await actions.closeControlServer()
  } catch (error: unknown) {
    errors.push(error)
  }

  if (!processesStopped) {
    errors.push(
      new Error(
        'Phase 10 database cleanup was withheld because an owned process may still be running.'
      )
    )
  } else {
    try {
      await actions.cleanupDatabase()
    } catch (error: unknown) {
      errors.push(error)
    }
  }

  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) {
    throw new AggregateError(errors, 'Phase 10 browser cleanup failed.')
  }
}
