export interface GuestCleanupBatchResult {
  deletedCount: number
  remainingCount: number
  hasMore: boolean
}

export interface GuestCleanupRunnerInput {
  batchSize: number
  dryRun: boolean
  maxBatches: number
  maxDurationMs: number
}

export interface GuestCleanupRunnerPorts {
  now: () => number
  preview: (timeoutMs: number) => Promise<{
    eligibleCount: number
    hasMore: boolean
  }>
  executeBatch: (input: {
    batchSize: number
    timeoutMs: number
  }) => Promise<GuestCleanupBatchResult>
}

export interface GuestCleanupRunResult {
  batches: number
  deletedCount: number
  eligibleCount: number | null
  remainingCount: number | null
  hasMore: boolean
  timeLimitReached: boolean
}

export const runStudyGuestCleanup = async (
  input: GuestCleanupRunnerInput,
  ports: GuestCleanupRunnerPorts
): Promise<GuestCleanupRunResult> => {
  if (
    !Number.isInteger(input.batchSize) ||
    input.batchSize < 1 ||
    input.batchSize > 500 ||
    !Number.isInteger(input.maxBatches) ||
    input.maxBatches < 1 ||
    input.maxBatches > 100 ||
    !Number.isInteger(input.maxDurationMs) ||
    input.maxDurationMs < 1 ||
    input.maxDurationMs > 300_000
  ) {
    throw new Error('Invalid guest cleanup limits.')
  }

  const deadline = ports.now() + input.maxDurationMs
  if (input.dryRun) {
    const result = await ports.preview(input.maxDurationMs)
    return {
      batches: 0,
      deletedCount: 0,
      eligibleCount: result.eligibleCount,
      remainingCount: result.eligibleCount,
      hasMore: result.hasMore,
      timeLimitReached: ports.now() >= deadline
    }
  }

  let batches = 0
  let deletedCount = 0
  let hasMore = true
  let remainingCount: number | null = null
  while (batches < input.maxBatches && hasMore) {
    const remainingMs = deadline - ports.now()
    if (remainingMs <= 0) break
    const result = await ports.executeBatch({
      batchSize: input.batchSize,
      timeoutMs: remainingMs
    })
    batches += 1
    deletedCount += result.deletedCount
    hasMore = result.hasMore
    remainingCount = result.remainingCount
  }
  return {
    batches,
    deletedCount,
    eligibleCount: null,
    remainingCount,
    hasMore,
    timeLimitReached: hasMore && ports.now() >= deadline
  }
}
