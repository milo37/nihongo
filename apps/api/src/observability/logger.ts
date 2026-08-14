export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'

export interface LogContext {
  [key: string]: unknown
}

export interface StructuredLogger {
  debug: (event: string, context?: LogContext) => void
  info: (event: string, context?: LogContext) => void
  warn: (event: string, context?: LogContext) => void
  error: (event: string, context?: LogContext) => void
}

const SENSITIVE_KEY_PATTERN =
  /authorization|cookie|password|secret|session|token|database.?url|connection.?string|memo|e-?mail|pii|sql|query|correct.?option|answer/i
const REDACTED = '[REDACTED]'
const MAX_SANITIZE_DEPTH = 5
const LEVEL_PRIORITY: Record<Exclude<LogLevel, 'silent'>, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
}

const sanitizeValue = (value: unknown, depth: number): unknown => {
  if (depth >= MAX_SANITIZE_DEPTH) {
    return '[MAX_DEPTH]'
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, depth + 1))
  }

  if (typeof value !== 'object' || value === null) {
    return value
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      SENSITIVE_KEY_PATTERN.test(key)
        ? REDACTED
        : sanitizeValue(nestedValue, depth + 1)
    ])
  )
}

export const sanitizeLogContext = (context: LogContext): LogContext =>
  sanitizeValue(context, 0) as LogContext

export const createJsonLogger = (
  level: LogLevel,
  sink: (line: string) => void = console.log
): StructuredLogger => {
  const write = (
    entryLevel: Exclude<LogLevel, 'silent'>,
    event: string,
    context: LogContext = {}
  ): void => {
    if (
      level === 'silent' ||
      LEVEL_PRIORITY[entryLevel] < LEVEL_PRIORITY[level]
    ) {
      return
    }

    sink(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: entryLevel,
        event,
        ...sanitizeLogContext(context)
      })
    )
  }

  return {
    debug: (event, context) => write('debug', event, context),
    info: (event, context) => write('info', event, context),
    warn: (event, context) => write('warn', event, context),
    error: (event, context) => write('error', event, context)
  }
}
