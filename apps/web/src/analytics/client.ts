import {
  analyticsEventSchema,
  type AnalyticsEnvironment,
  type AnalyticsEvent,
  type AnalyticsEventInput
} from '@nihongo/contracts/analytics/events'
import { releaseId } from '@libs/releaseId'

export interface AnalyticsTransport {
  send: (event: AnalyticsEvent) => void | Promise<void>
}

export interface AnalyticsClient {
  track: (input: AnalyticsEventInput) => boolean
}

interface CreateAnalyticsClientOptions {
  readonly environment: AnalyticsEnvironment
  readonly releaseId: string
  readonly transport?: AnalyticsTransport
  readonly now?: () => Date
  readonly createCorrelationId?: () => string
}

export const createAnalyticsClient = ({
  environment,
  releaseId,
  transport,
  now = () => new Date(),
  createCorrelationId = () => crypto.randomUUID()
}: CreateAnalyticsClientOptions): AnalyticsClient => ({
  track: (input) => {
    if (!transport) return false

    const parsed = analyticsEventSchema.safeParse({
      schemaVersion: 1,
      occurredAt: now().toISOString(),
      environment,
      releaseId,
      correlationId: createCorrelationId(),
      ...input
    })
    if (!parsed.success) return false

    try {
      const delivery = transport.send(parsed.data)
      if (delivery instanceof Promise) {
        void delivery.catch(() => undefined)
      }
      return true
    } catch {
      return false
    }
  }
})

export const analyticsClient = createAnalyticsClient({
  environment: 'LOCAL',
  releaseId
})
