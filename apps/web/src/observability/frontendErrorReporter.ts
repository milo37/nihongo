import { z } from 'zod'
import type { AnalyticsEnvironment } from '@nihongo/contracts/analytics/events'
import { routeLabelKeys, type RouteLabelKey } from '@/i18n/routePresentation'
import { releaseId } from '@libs/releaseId'

const frontendErrorEventSchema = z
  .object({
    schemaVersion: z.literal(1),
    occurredAt: z.string().datetime({ offset: true }),
    deploymentEnvironment: z.enum([
      'LOCAL',
      'TEST',
      'DEVELOPMENT',
      'STAGING',
      'PRODUCTION'
    ]),
    releaseId: z.string().regex(/^[0-9a-f]{40}$/u),
    source: z.enum([
      'WINDOW_ERROR',
      'UNHANDLED_REJECTION',
      'ROUTE_RENDER',
      'UNEXPECTED_API_ERROR',
      'API_RESPONSE_VALIDATION'
    ]),
    routeKey: z.enum(routeLabelKeys),
    requestId: z.uuid().optional(),
    statusClass: z.enum(['1xx', '2xx', '3xx', '4xx', '5xx']).optional()
  })
  .strict()

export type FrontendErrorEvent = z.output<typeof frontendErrorEventSchema>
export type FrontendErrorInput = Omit<
  FrontendErrorEvent,
  'schemaVersion' | 'occurredAt' | 'deploymentEnvironment' | 'releaseId'
>

export interface FrontendErrorTransport {
  send: (event: FrontendErrorEvent) => void | Promise<void>
}

export interface FrontendErrorReporter {
  report: (input: FrontendErrorInput) => boolean
}

interface CreateFrontendErrorReporterOptions {
  readonly deploymentEnvironment: AnalyticsEnvironment
  readonly releaseId: string
  readonly transport?: FrontendErrorTransport
  readonly now?: () => Date
}

export const createFrontendErrorReporter = ({
  deploymentEnvironment,
  releaseId: configuredReleaseId,
  transport,
  now = () => new Date()
}: CreateFrontendErrorReporterOptions): FrontendErrorReporter => ({
  report: (input) => {
    if (!transport) return false
    const parsed = frontendErrorEventSchema.safeParse({
      schemaVersion: 1,
      occurredAt: now().toISOString(),
      deploymentEnvironment,
      releaseId: configuredReleaseId,
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

export const frontendErrorReporter = createFrontendErrorReporter({
  deploymentEnvironment: 'LOCAL',
  releaseId
})

export const installGlobalFrontendErrorReporting = (
  reporter: FrontendErrorReporter,
  getRouteKey: () => RouteLabelKey
): (() => void) => {
  const handleError = (): void => {
    reporter.report({ source: 'WINDOW_ERROR', routeKey: getRouteKey() })
  }
  const handleUnhandledRejection = (): void => {
    reporter.report({
      source: 'UNHANDLED_REJECTION',
      routeKey: getRouteKey()
    })
  }

  window.addEventListener('error', handleError)
  window.addEventListener('unhandledrejection', handleUnhandledRejection)
  return () => {
    window.removeEventListener('error', handleError)
    window.removeEventListener('unhandledrejection', handleUnhandledRejection)
  }
}
