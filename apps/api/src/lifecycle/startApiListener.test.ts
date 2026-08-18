import type { Server } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { startApiListener } from './startApiListener.js'

describe('startApiListener', () => {
  it('readiness가 끝난 뒤에만 listener를 연다', async () => {
    const order: string[] = []
    const server = {} as Server
    const checkReadiness = vi.fn(async () => {
      order.push('ready')
    })
    const createListener = vi.fn(() => {
      order.push('listen')
      return server
    })
    const disconnectDatabase = vi.fn(async () => undefined)

    await expect(
      startApiListener({
        checkReadiness,
        createListener,
        disconnectDatabase
      })
    ).resolves.toBe(server)
    expect(order).toEqual(['ready', 'listen'])
    expect(disconnectDatabase).not.toHaveBeenCalled()
  })

  it('readiness 실패 시 listener를 열지 않고 DB를 닫는다', async () => {
    const readinessError = new Error('not ready')
    const createListener = vi.fn(() => ({}) as Server)
    const disconnectDatabase = vi.fn(async () => undefined)

    await expect(
      startApiListener({
        checkReadiness: vi.fn().mockRejectedValue(readinessError),
        createListener,
        disconnectDatabase
      })
    ).rejects.toBe(readinessError)
    expect(createListener).not.toHaveBeenCalled()
    expect(disconnectDatabase).toHaveBeenCalledOnce()
  })

  it('listener 생성 실패 시에도 DB를 닫고 원래 오류를 보존한다', async () => {
    const listenerError = new Error('bind failed')
    const disconnectDatabase = vi.fn(async () => undefined)

    await expect(
      startApiListener({
        checkReadiness: vi.fn(async () => undefined),
        createListener: vi.fn(() => {
          throw listenerError
        }),
        disconnectDatabase
      })
    ).rejects.toBe(listenerError)
    expect(disconnectDatabase).toHaveBeenCalledOnce()
  })
})
