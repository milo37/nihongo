import { describe, expect, it, vi } from 'vitest'
import {
  stopServerGracefully,
  type ClosableServer
} from './gracefulShutdown.js'

const createServerStub = (
  close: ClosableServer['close'],
  closeAllConnections = vi.fn()
): ClosableServer => ({ close, closeAllConnections })

describe('stopServerGracefully', () => {
  it('server close 후 DB를 정리한다', async () => {
    const events: string[] = []
    const server = createServerStub((callback) => {
      events.push('server')
      callback?.()
    })

    await stopServerGracefully({
      server,
      drainBackgroundTasks: async () => {
        events.push('background')
      },
      disconnectDatabase: async () => {
        events.push('database')
      }
    })

    expect(events).toEqual(['server', 'background', 'database'])
  })

  it('server close가 실패해도 DB를 정리한다', async () => {
    const disconnectDatabase = vi.fn().mockResolvedValue(undefined)
    const server = createServerStub((callback) => {
      callback?.(new Error('close failed'))
    })

    await expect(
      stopServerGracefully({ server, disconnectDatabase })
    ).rejects.toThrow('close failed')
    expect(disconnectDatabase).toHaveBeenCalledOnce()
  })

  it('deadline을 넘기면 연결을 종료하고 DB를 정리한다', async () => {
    const closeAllConnections = vi.fn()
    const disconnectDatabase = vi.fn().mockResolvedValue(undefined)
    const server = createServerStub(() => undefined, closeAllConnections)

    await expect(
      stopServerGracefully({ server, disconnectDatabase, timeoutMs: 5 })
    ).rejects.toThrow('Server shutdown exceeded 5ms.')
    expect(closeAllConnections).toHaveBeenCalledOnce()
    expect(disconnectDatabase).toHaveBeenCalledOnce()
  })

  it('DB 정리에도 deadline을 적용한다', async () => {
    const server = createServerStub((callback) => callback?.())

    await expect(
      stopServerGracefully({
        server,
        disconnectDatabase: () => new Promise<void>(() => undefined),
        timeoutMs: 5
      })
    ).rejects.toThrow('Database disconnect exceeded 5ms.')
  })

  it('background drain이 실패해도 DB를 정리한다', async () => {
    const server = createServerStub((callback) => callback?.())
    const disconnectDatabase = vi.fn().mockResolvedValue(undefined)

    await expect(
      stopServerGracefully({
        server,
        drainBackgroundTasks: () =>
          Promise.reject(new Error('email drain failed')),
        disconnectDatabase
      })
    ).rejects.toThrow('email drain failed')
    expect(disconnectDatabase).toHaveBeenCalledOnce()
  })

  it('background drain deadline이면 작업을 abort하고 DB를 정리한다', async () => {
    const server = createServerStub((callback) => callback?.())
    const abortBackgroundTasks = vi.fn()
    const disconnectDatabase = vi.fn().mockResolvedValue(undefined)

    await expect(
      stopServerGracefully({
        server,
        abortBackgroundTasks,
        drainBackgroundTasks: () => new Promise<void>(() => undefined),
        disconnectDatabase,
        timeoutMs: 5
      })
    ).rejects.toThrow('Background task drain exceeded 5ms.')
    expect(abortBackgroundTasks).toHaveBeenCalledOnce()
    expect(disconnectDatabase).toHaveBeenCalledOnce()
  })
})
