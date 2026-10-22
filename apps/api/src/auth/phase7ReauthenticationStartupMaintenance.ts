import type { PrismaClient } from '../generated/prisma/client.js'

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

export const runPhase7ReauthenticationStartupMaintenance = async (
  client: Pick<PrismaClient, '$queryRawUnsafe'>
): Promise<void> => {
  for (let batch = 0; batch < MAXIMUM_CLEANUP_BATCHES; batch += 1) {
    const rows = await client.$queryRawUnsafe<ReauthenticationCleanupRow[]>(
      'SELECT * FROM "phase7_cleanup_reauthentication"($1)',
      CLEANUP_BATCH_SIZE
    )
    const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : undefined
    if (
      !row ||
      !isCount(row.pendingSessionsDeleted) ||
      !isCount(row.intentsDeleted) ||
      !isCount(row.evidenceDeleted)
    ) {
      throw new Error('Phase 7 reauthentication startup cleanup failed.')
    }
    if (
      row.intentsDeleted < CLEANUP_BATCH_SIZE &&
      row.evidenceDeleted < CLEANUP_BATCH_SIZE
    ) {
      return
    }
  }
  throw new Error('Phase 7 reauthentication startup cleanup failed.')
}

export interface Phase7ReauthenticationMaintenance {
  stop: () => Promise<void>
}

export const startPhase7ReauthenticationMaintenance = ({
  client,
  intervalMs = DEFAULT_MAINTENANCE_INTERVAL_MS,
  onFailure
}: {
  client: Pick<PrismaClient, '$queryRawUnsafe'>
  intervalMs?: number
  onFailure: (error: unknown) => void
}): Phase7ReauthenticationMaintenance => {
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
    throw new Error('Phase 7 reauthentication maintenance interval is invalid.')
  }

  let stopped = false
  let inFlight: Promise<void> | undefined
  const run = (): void => {
    if (stopped || inFlight) return
    const task = runPhase7ReauthenticationStartupMaintenance(client)
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
