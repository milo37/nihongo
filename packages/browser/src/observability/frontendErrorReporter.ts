import { z } from 'zod'
import { reportClientErrorRequestSchema } from '@nihongo/contracts/observability/report-client-error'
import { routeLabelKeys, type RouteLabelKey } from '../i18n/routePresentation'
import { isRealApiMode } from '../libs/apiMode'
import { createApiFrontendErrorTransport } from './frontendErrorTransport'

// The shared contract (JLP-762), with the route key narrowed to known screens.
// No environment: one image serves STAGING and PRODUCTION, so the API logs its own.
const frontendErrorEventSchema = reportClientErrorRequestSchema.extend({
  routeKey: z.enum(routeLabelKeys)
})

export type FrontendErrorEvent = z.output<typeof frontendErrorEventSchema>
export type FrontendErrorInput = Omit<
  FrontendErrorEvent,
  'schemaVersion' | 'occurredAt' | 'releaseId'
>

export interface FrontendErrorTransport {
  send: (event: FrontendErrorEvent) => void | Promise<void>
}

export interface FrontendErrorReporter {
  report: (input: FrontendErrorInput) => boolean
}

interface CreateFrontendErrorReporterOptions {
  readonly releaseId: string
  readonly transport?: FrontendErrorTransport
  readonly now?: () => Date
}

export const createFrontendErrorReporter = ({
  releaseId: configuredReleaseId,
  transport,
  now = () => new Date()
}: CreateFrontendErrorReporterOptions): FrontendErrorReporter => ({
  report: (input) => {
    if (!transport) return false
    const parsed = frontendErrorEventSchema.safeParse({
      schemaVersion: 1,
      occurredAt: now().toISOString(),
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

// Mock mode has no server to log to, so it sends nothing.
export const frontendErrorReporter = createFrontendErrorReporter({
  releaseId: __NIHONGO_RELEASE_ID__,
  transport: isRealApiMode
    ? createApiFrontendErrorTransport({
        baseUrl: import.meta.env.VITE_API_BASE_URL ?? '/api'
      })
    : undefined
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
