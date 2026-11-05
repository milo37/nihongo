import {
  cleanupReauthentication,
  type AdminFreshClient
} from './adminFreshAuthority.js'

interface ReauthenticationCleanupRow {
  readonly pendingSessionsDeleted: number
  readonly intentsDeleted: number
  readonly evidenceDeleted: number
}

const CLEANUP_BATCH_SIZE = 100
const MAXIMUM_CLEANUP_BATCHES = 10
const DEFAULT_MAINTENANCE_INTERVAL_MS = 60_000

const isCount = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0

export const runReauthenticationStartupMaintenance = async (
  client: AdminFreshClient
): Promise<void> => {
  for (let batch = 0; batch < MAXIMUM_CLEANUP_BATCHES; batch += 1) {
    const row: ReauthenticationCleanupRow | undefined =
      await cleanupReauthentication(client, CLEANUP_BATCH_SIZE)
    if (
      !row ||
      !isCount(row.pendingSessionsDeleted) ||
      !isCount(row.intentsDeleted) ||
      !isCount(row.evidenceDeleted)
    ) {
      throw new Error('Reauthentication startup cleanup failed.')
    }
    if (
      row.intentsDeleted < CLEANUP_BATCH_SIZE &&
      row.evidenceDeleted < CLEANUP_BATCH_SIZE
    ) {
      return
    }
  }
  throw new Error('Reauthentication startup cleanup failed.')
}

export interface ReauthenticationMaintenance {
  stop: () => Promise<void>
}

export const startReauthenticationMaintenance = ({
  client,
  intervalMs = DEFAULT_MAINTENANCE_INTERVAL_MS,
  onFailure
}: {
  client: AdminFreshClient
  intervalMs?: number
  onFailure: (error: unknown) => void
}): ReauthenticationMaintenance => {
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
    throw new Error('Reauthentication maintenance interval is invalid.')
  }

  let stopped = false
  let inFlight: Promise<void> | undefined
  const run = (): void => {
    if (stopped || inFlight) return
    const task = runReauthenticationStartupMaintenance(client)
      .catch((error: unknown) => {
        try {
          onFailure(error)
        } catch {
          // Observability must not turn a recoverable maintenance failure into
          // an unhandled rejection. The next interval retries the bounded job.
        }
      })
      .finally(() => {
        if (inFlight === task) inFlight = undefined
      })
    inFlight = task
  }

  const timer = setInterval(run, intervalMs)
  timer.unref()

  return {
    stop: async () => {
      stopped = true
      clearInterval(timer)
      await inFlight
    }
  }
}
