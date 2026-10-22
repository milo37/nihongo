import { describe, expect, it, vi } from 'vitest'
import { createShutdownCoordinator } from './shutdownCoordinator.js'

describe('shutdown coordinator', () => {
  it('여러 종료 신호가 와도 하나의 shutdown promise만 공유한다', async () => {
    let resolveShutdown: (() => void) | undefined
    const shutdown = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveShutdown = resolve
        })
    )
    const coordinator = createShutdownCoordinator(shutdown)
    const first = coordinator.begin('SIGINT')
    const second = coordinator.begin('SIGTERM')

    expect(first).toBe(second)
    expect(shutdown).toHaveBeenCalledOnce()
    expect(shutdown).toHaveBeenCalledWith('SIGINT')
    resolveShutdown?.()
    await first
  })
})
