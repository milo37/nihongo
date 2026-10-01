import { describe, expect, it, vi } from 'vitest'
import { createJsonLogger, type LogContext } from './logger.js'

const releaseId = '1234567890abcdef1234567890abcdef12345678'

describe('closed structured logger', () => {
  it('records only exact event fields with release and environment correlation', () => {
    const lines: string[] = []
    const logger = createJsonLogger('info', (line) => lines.push(line), {
      deploymentEnvironment: 'STAGING',
      releaseId
    })

    logger.info('http.request.completed', {
      requestId: '00000000-0000-4000-8000-000000000001',
      routeTemplate: '/api/v1/questions/:questionId',
      statusClass: '2xx',
      durationMs: 18
    })

    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      schemaVersion: 1,
      level: 'info',
      event: 'http.request.completed',
      deploymentEnvironment: 'STAGING',
      releaseId,
      requestId: '00000000-0000-4000-8000-000000000001',
      routeTemplate: '/api/v1/questions/:questionId',
      statusClass: '2xx',
      durationMs: 18
    })
  })

  it('drops unknown fields, unsafe route data, and unknown runtime events', () => {
    const lines: string[] = []
    const logger = createJsonLogger('debug', (line) => lines.push(line))
    const base = {
      requestId: '00000000-0000-4000-8000-000000000001',
      routeTemplate: '/api/v1/questions/:questionId',
      statusClass: '2xx',
      durationMs: 18
    }

    logger.info('http.request.completed', {
      ...base,
      body: 'private answer'
    })
    logger.info('http.request.completed', {
      ...base,
      routeTemplate: '/api/v1/questions?token=private'
    })
    ;(logger.info as unknown as (event: string, context?: LogContext) => void)(
      'unknown.event',
      {}
    )

    expect(lines).toEqual([])
  })

  it('honors levels and swallows sink failures', () => {
    const sink = vi.fn(() => {
      throw new Error('sink unavailable')
    })
    const logger = createJsonLogger('warn', sink)

    expect(() => logger.info('api.started')).not.toThrow()
    expect(() =>
      logger.error('api.shutdown.failed', {
        signal: 'SIGTERM',
        errorCode: 'SHUTDOWN_FAILED'
      })
    ).not.toThrow()
    expect(sink).toHaveBeenCalledTimes(1)
  })
})
