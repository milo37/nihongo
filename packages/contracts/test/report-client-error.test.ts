import { describe, expect, it } from 'vitest'
import { reportClientErrorRequestSchema } from '../src/observability/report-client-error.js'

const report = {
  schemaVersion: 1,
  occurredAt: '2026-11-13T12:00:00.000+09:00',
  releaseId: 'b'.repeat(40),
  source: 'ROUTE_RENDER',
  routeKey: 'routes.wrongNoteDetail'
}

describe('reportClientErrorRequestSchema (JLP-762)', () => {
  it('accepts the labels the browser reporter sends', () => {
    expect(reportClientErrorRequestSchema.parse(report)).toEqual(report)
    expect(
      reportClientErrorRequestSchema.parse({
        ...report,
        requestId: '019d0000-0000-7000-8000-0000000000aa',
        statusClass: '4xx'
      })
    ).toMatchObject({ statusClass: '4xx' })
  })

  it.each([
    ['a message', { ...report, message: 'boom' }],
    ['a stack', { ...report, stack: 'at x' }],
    ['a path as route', { ...report, routeKey: '/wrong-notes/1' }],
    ['a non-uuid request id', { ...report, requestId: 'abc' }],
    ['schema version 2', { ...report, schemaVersion: 2 }],
    ['an environment', { ...report, deploymentEnvironment: 'PRODUCTION' }]
  ])('rejects %s', (_label, value) => {
    expect(reportClientErrorRequestSchema.safeParse(value).success).toBe(false)
  })
})
