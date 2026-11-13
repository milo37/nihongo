import { z } from 'zod'

/**
 * POST /api/v1/client-errors (JLP-762). The web and admin screens report an
 * unexpected error; the API writes one line to its own log (CloudWatch) and
 * keeps nothing else. No sign-in, no cookie needed, 204 with no body.
 * Only labels travel: no message, stack, URL or user data.
 */
export const clientErrorSourceSchema = z.enum([
  'WINDOW_ERROR',
  'UNHANDLED_REJECTION',
  'ROUTE_RENDER',
  'UNEXPECTED_API_ERROR',
  'API_RESPONSE_VALIDATION'
])

export const reportClientErrorRequestSchema = z
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
    /** The screen bundle's release; differs from the API's on a stale tab. */
    releaseId: z.string().regex(/^[0-9a-f]{40}$/u),
    source: clientErrorSourceSchema,
    /** Screen label key such as routes.practiceSession. */
    routeKey: z.string().regex(/^routes\.[A-Za-z]{1,48}$/u),
    /** X-Request-Id of the failed API call, when there was one. */
    requestId: z.uuid().optional(),
    statusClass: z.enum(['1xx', '2xx', '3xx', '4xx', '5xx']).optional()
  })
  .strict()

export type ReportClientErrorRequest = z.output<
  typeof reportClientErrorRequestSchema
>
