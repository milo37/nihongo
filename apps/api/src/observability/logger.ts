import { z } from 'zod'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'

export type OperationalLogEvent =
  | 'api.started'
  | 'api.shutdown.started'
  | 'api.shutdown.completed'
  | 'api.shutdown.failed'
  | 'http.request.completed'
  | 'http.request.failed'
  | 'auth.email.delivery_failed'
  | 'auth.reauthentication.maintenance_failed'

export interface LogContext {
  readonly [key: string]: unknown
}

export interface OperationalLogMetadata {
  readonly deploymentEnvironment:
    | 'LOCAL'
    | 'TEST'
    | 'DEVELOPMENT'
    | 'STAGING'
    | 'PRODUCTION'
  readonly releaseId: string
}

export interface StructuredLogger {
  debug: (event: OperationalLogEvent, context?: LogContext) => void
  info: (event: OperationalLogEvent, context?: LogContext) => void
  warn: (event: OperationalLogEvent, context?: LogContext) => void
  error: (event: OperationalLogEvent, context?: LogContext) => void
}

const LOCAL_RELEASE_ID = '0000000000000000000000000000000000000000'
const LEVEL_PRIORITY: Record<Exclude<LogLevel, 'silent'>, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
}
const metadataSchema = z
  .object({
    deploymentEnvironment: z.enum([
      'LOCAL',
      'TEST',
      'DEVELOPMENT',
      'STAGING',
      'PRODUCTION'
    ]),
    releaseId: z.string().regex(/^[0-9a-f]{40}$/u)
  })
  .strict()
const requestIdSchema = z.uuid()
const routeTemplateSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^(?:\*|\/[A-Za-z0-9_./:*-]*)$/u)
const statusClassSchema = z.enum(['1xx', '2xx', '3xx', '4xx', '5xx'])
const durationSchema = z.number().int().min(0).max(30_000)
const errorCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/u)
const signalSchema = z.enum(['SIGINT', 'SIGTERM'])
const emptyContextSchema = z.object({}).strict()
const httpContextSchema = z
  .object({
    requestId: requestIdSchema,
    routeTemplate: routeTemplateSchema,
    statusClass: statusClassSchema,
    durationMs: durationSchema
  })
  .strict()

const contextSchemaByEvent = {
  'api.started': emptyContextSchema,
  'api.shutdown.started': z.object({ signal: signalSchema }).strict(),
  'api.shutdown.completed': z.object({ signal: signalSchema }).strict(),
  'api.shutdown.failed': z
    .object({
      signal: signalSchema,
      errorCode: z.literal('SHUTDOWN_FAILED')
    })
    .strict(),
  'http.request.completed': httpContextSchema,
  'http.request.failed': httpContextSchema
    .extend({ errorCode: errorCodeSchema })
    .strict(),
  'auth.email.delivery_failed': z
    .object({
      purpose: z.enum(['EMAIL_VERIFICATION', 'PASSWORD_RESET']),
      deliveryReason: z.enum(['ABORTED', 'DELIVERY_FAILED', 'QUEUE_FULL'])
    })
    .strict(),
  'auth.reauthentication.maintenance_failed': z
    .object({ errorCode: z.literal('MAINTENANCE_FAILED') })
    .strict()
} as const

const defaultMetadata: OperationalLogMetadata = {
  deploymentEnvironment: 'TEST',
  releaseId: LOCAL_RELEASE_ID
}

export const createJsonLogger = (
  level: LogLevel,
  sink: (line: string) => void = console.log,
  metadata: OperationalLogMetadata = defaultMetadata
): StructuredLogger => {
  const parsedMetadata = metadataSchema.safeParse(metadata)

  const write = (
    entryLevel: Exclude<LogLevel, 'silent'>,
    event: OperationalLogEvent,
    context: LogContext = {}
  ): void => {
    if (
      level === 'silent' ||
      LEVEL_PRIORITY[entryLevel] < LEVEL_PRIORITY[level] ||
      !parsedMetadata.success
    ) {
      return
    }

    const contextSchema = contextSchemaByEvent[event]
    if (!contextSchema) return
    const parsedContext = contextSchema.safeParse(context)
    if (!parsedContext.success) return

    try {
      sink(
        JSON.stringify({
          schemaVersion: 1,
          timestamp: new Date().toISOString(),
          level: entryLevel,
          event,
          ...parsedMetadata.data,
          ...parsedContext.data
        })
      )
    } catch {
      // Operational telemetry must never change product behavior.
    }
  }

  return {
    debug: (event, context) => write('debug', event, context),
    info: (event, context) => write('info', event, context),
    warn: (event, context) => write('warn', event, context),
    error: (event, context) => write('error', event, context)
  }
}
