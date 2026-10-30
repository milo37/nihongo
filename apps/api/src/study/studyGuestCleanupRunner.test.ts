import { describe, expect, it, vi } from 'vitest'
import { runStudyGuestCleanup } from './studyGuestCleanupRunner.js'

const input = {
  batchSize: 100,
  dryRun: false,
  maxBatches: 2,
  maxDurationMs: 1_000
}

describe('bounded guest cleanup', () => {
  it('limits batches and reports that work remains', async () => {
    const executeBatch = vi.fn().mockResolvedValue({
      deletedCount: 100,
      remainingCount: 1,
      hasMore: true
    })
    const preview = vi.fn()
    const result = await runStudyGuestCleanup(input, {
      now: () => 0,
      preview,
      executeBatch
    })
    expect(result).toEqual({
      batches: 2,
      deletedCount: 200,
      eligibleCount: null,
      remainingCount: 1,
      hasMore: true,
      timeLimitReached: false
    })
    expect(executeBatch).toHaveBeenCalledTimes(2)
    expect(preview).not.toHaveBeenCalled()
  })

  it('does not start a further batch after the deadline', async () => {
    let now = 0
    const executeBatch = vi.fn(async () => {
      now = 1_000
      return { deletedCount: 4, remainingCount: 1, hasMore: true }
    })
    const result = await runStudyGuestCleanup(input, {
      now: () => now,
      preview: vi.fn(),
      executeBatch
    })
    expect(executeBatch).toHaveBeenCalledOnce()
    expect(executeBatch).toHaveBeenCalledWith({
      batchSize: 100,
      timeoutMs: 1_000
    })
    expect(result).toEqual({
      batches: 1,
      deletedCount: 4,
      eligibleCount: null,
      remainingCount: 1,
      hasMore: true,
      timeLimitReached: true
    })
  })

  it('passes the remaining time budget to each batch', async () => {
    let now = 0
    const executeBatch = vi.fn(async () => {
      now += 400
      return { deletedCount: 1, remainingCount: 1, hasMore: true }
    })
    await runStudyGuestCleanup(input, {
      now: () => now,
      preview: vi.fn(),
      executeBatch
    })
    expect(executeBatch).toHaveBeenNthCalledWith(1, {
      batchSize: 100,
      timeoutMs: 1_000
    })
    expect(executeBatch).toHaveBeenNthCalledWith(2, {
      batchSize: 100,
      timeoutMs: 600
    })
  })

  it('uses preview only for a dry run', async () => {
    const preview = vi
      .fn()
      .mockResolvedValue({ eligibleCount: 7, hasMore: true })
    const executeBatch = vi.fn()
    const result = await runStudyGuestCleanup(
      { ...input, dryRun: true },
      {
        now: () => 0,
        preview,
        executeBatch
      }
    )
    expect(preview).toHaveBeenCalledWith(1_000)
    expect(executeBatch).not.toHaveBeenCalled()
    expect(result).toEqual({
      batches: 0,
      deletedCount: 0,
      eligibleCount: 7,
      remainingCount: 7,
      hasMore: true,
      timeLimitReached: false
    })
  })

  it('rejects an invalid bound before running a query', async () => {
    const preview = vi.fn()
    const executeBatch = vi.fn()
    await expect(
      runStudyGuestCleanup(
        { ...input, batchSize: 501 },
        {
          now: () => 0,
          preview,
          executeBatch
        }
      )
    ).rejects.toThrow('Invalid guest cleanup limits.')
    expect(preview).not.toHaveBeenCalled()
    expect(executeBatch).not.toHaveBeenCalled()
  })
})
