import type {
  AuthEmailMessage,
  AuthEmailPort,
  AuthEmailPurpose
} from './emailPort.js'

export interface AuthEmailDispatcher {
  abort: () => void
  drain: () => Promise<void>
  enqueue: (message: AuthEmailMessage) => void
}

export type AuthEmailDeliveryFailureReason =
  | 'ABORTED'
  | 'DELIVERY_FAILED'
  | 'QUEUE_FULL'

interface CreateAuthEmailDispatcherDependencies {
  capacity?: number
  concurrency?: number
  emailPort: AuthEmailPort
  onDeliveryFailure?: (
    purpose: AuthEmailPurpose,
    reason: AuthEmailDeliveryFailureReason
  ) => void
}

export const createAuthEmailDispatcher = ({
  capacity = 100,
  concurrency = 2,
  emailPort,
  onDeliveryFailure = () => undefined
}: CreateAuthEmailDispatcherDependencies): AuthEmailDispatcher => {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new Error('Auth email queue capacity must be a positive integer.')
  }
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('Auth email concurrency must be a positive integer.')
  }

  const queue: AuthEmailMessage[] = []
  const drainResolvers = new Set<() => void>()
  let activeCount = 0
  let aborted = false
  let accepting = true

  const reportFailure = (
    purpose: AuthEmailPurpose,
    reason: AuthEmailDeliveryFailureReason
  ): void => {
    try {
      onDeliveryFailure(purpose, reason)
    } catch {
      // Telemetry failures must not escape into auth request processing.
    }
  }

  const resolveDrainsWhenIdle = (): void => {
    if (activeCount > 0 || queue.length > 0) {
      return
    }
    for (const resolve of drainResolvers) {
      resolve()
    }
    drainResolvers.clear()
  }

  const pump = (): void => {
    while (!aborted && activeCount < concurrency && queue.length > 0) {
      const message = queue.shift()
      if (!message) {
        break
      }
      activeCount += 1

      let delivery: Promise<void>
      try {
        delivery = emailPort.send(message)
      } catch {
        activeCount -= 1
        reportFailure(message.purpose, 'DELIVERY_FAILED')
        continue
      }

      void delivery
        .catch(() => reportFailure(message.purpose, 'DELIVERY_FAILED'))
        .finally(() => {
          activeCount -= 1
          pump()
          resolveDrainsWhenIdle()
        })
    }
    resolveDrainsWhenIdle()
  }

  return {
    abort: () => {
      accepting = false
      aborted = true
      for (const message of queue.splice(0)) {
        reportFailure(message.purpose, 'ABORTED')
      }
      resolveDrainsWhenIdle()
    },
    enqueue: (message) => {
      if (!accepting) {
        reportFailure(message.purpose, 'ABORTED')
        return
      }
      if (activeCount + queue.length >= capacity) {
        reportFailure(message.purpose, 'QUEUE_FULL')
        return
      }
      queue.push(structuredClone(message))
      pump()
    },
    drain: async () => {
      accepting = false
      if (activeCount === 0 && queue.length === 0) {
        return
      }
      await new Promise<void>((resolve) => drainResolvers.add(resolve))
    }
  }
}
