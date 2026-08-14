import { describe, expect, it, vi } from 'vitest'
import { createAuthEmailDispatcher } from './emailDispatcher.js'
import type { AuthEmailMessage, AuthEmailPort } from './emailPort.js'

const message: AuthEmailMessage = {
  from: 'auth@example.test',
  purpose: 'EMAIL_VERIFICATION',
  recipient: 'user@example.test',
  url: 'https://nihongo.example.test/verify-email#token=private'
}

describe('auth email dispatcher', () => {
  it('전송 완료를 기다리지 않고 enqueue한 뒤 drain에서 마무리한다', async () => {
    let resolveDelivery: (() => void) | undefined
    const emailPort: AuthEmailPort = {
      send: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveDelivery = resolve
          })
      )
    }
    const dispatcher = createAuthEmailDispatcher({ emailPort })

    dispatcher.enqueue(message)
    expect(emailPort.send).toHaveBeenCalledOnce()

    let drained = false
    const draining = dispatcher.drain().then(() => {
      drained = true
    })
    await Promise.resolve()
    expect(drained).toBe(false)

    resolveDelivery?.()
    await draining
    expect(drained).toBe(true)
  })

  it('실패 telemetry에는 purpose만 전달하고 drain을 거부하지 않는다', async () => {
    const onDeliveryFailure = vi.fn()
    const dispatcher = createAuthEmailDispatcher({
      emailPort: {
        send: vi.fn().mockRejectedValue(new Error('recipient and token'))
      },
      onDeliveryFailure
    })

    dispatcher.enqueue(message)
    await expect(dispatcher.drain()).resolves.toBeUndefined()
    expect(onDeliveryFailure).toHaveBeenCalledWith(
      'EMAIL_VERIFICATION',
      'DELIVERY_FAILED'
    )
  })

  it('capacity를 넘긴 작업과 abort된 대기 작업을 fail-closed 처리한다', async () => {
    const resolvers: Array<() => void> = []
    const onDeliveryFailure = vi.fn()
    const emailPort: AuthEmailPort = {
      send: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolvers.push(resolve)
          })
      )
    }
    const dispatcher = createAuthEmailDispatcher({
      capacity: 2,
      concurrency: 1,
      emailPort,
      onDeliveryFailure
    })

    dispatcher.enqueue(message)
    dispatcher.enqueue({ ...message, purpose: 'PASSWORD_RESET' })
    dispatcher.enqueue(message)

    expect(emailPort.send).toHaveBeenCalledOnce()
    expect(onDeliveryFailure).toHaveBeenCalledWith(
      'EMAIL_VERIFICATION',
      'QUEUE_FULL'
    )

    dispatcher.abort()
    expect(onDeliveryFailure).toHaveBeenCalledWith('PASSWORD_RESET', 'ABORTED')
    resolvers[0]?.()
    await expect(dispatcher.drain()).resolves.toBeUndefined()
  })

  it('drain을 시작한 뒤 새 작업을 받지 않는다', async () => {
    const onDeliveryFailure = vi.fn()
    const emailPort: AuthEmailPort = {
      send: vi.fn().mockResolvedValue(undefined)
    }
    const dispatcher = createAuthEmailDispatcher({
      emailPort,
      onDeliveryFailure
    })

    await dispatcher.drain()
    dispatcher.enqueue(message)

    expect(emailPort.send).not.toHaveBeenCalled()
    expect(onDeliveryFailure).toHaveBeenCalledWith(
      'EMAIL_VERIFICATION',
      'ABORTED'
    )
  })
})
