import { describe, expect, it } from 'vitest'
import { calendarDateSchema, isoDateTimeSchema } from '../src/common/date.js'
import {
  apiFailureSchema,
  errorStatusByCode,
  stableErrorCodeSchema
} from '../src/common/error.js'
import { opaqueIdSchema } from '../src/common/id.js'
import {
  createPageResponseSchema,
  pageRequestSchema
} from '../src/common/pagination.js'
import { z } from 'zod'

const UUID = '018f6b7a-1f4b-7d5e-8a91-4c27df9c10a1'

describe('공통 계약', () => {
  it('opaque ID와 달력 날짜를 엄격하게 검증한다', () => {
    expect(opaqueIdSchema.safeParse(UUID).success).toBe(true)
    expect(opaqueIdSchema.safeParse('question-1').success).toBe(false)
    expect(opaqueIdSchema.parse(UUID.toUpperCase())).toBe(UUID)
    expect(calendarDateSchema.safeParse('2024-02-29').success).toBe(true)
    expect(calendarDateSchema.safeParse('2025-02-29').success).toBe(false)
  })

  it('offset datetime을 UTC로 정규화한다', () => {
    expect(isoDateTimeSchema.parse('2026-08-12T12:00:00+09:00')).toBe(
      '2026-08-12T03:00:00.000Z'
    )
  })

  it('pagination query만 안전하게 coercion한다', () => {
    expect(pageRequestSchema.parse({ page: '2', pageSize: '10' })).toEqual({
      page: 2,
      pageSize: 10
    })
    expect(pageRequestSchema.safeParse({ page: 0 }).success).toBe(false)
    expect(
      createPageResponseSchema(z.string()).safeParse({
        items: [],
        page: 1,
        pageSize: 20,
        total: Number.MAX_SAFE_INTEGER + 1
      }).success
    ).toBe(false)
  })

  it('stable error code와 status mapping을 닫힌 집합으로 유지한다', () => {
    for (const code of stableErrorCodeSchema.options) {
      expect(errorStatusByCode[code]).toBeGreaterThanOrEqual(400)
    }

    expect(
      apiFailureSchema.safeParse({
        code: 'INTERNAL_SERVER_ERROR',
        message: '요청을 처리하지 못했습니다.',
        requestId: UUID,
        retryable: true,
        stack: 'secret'
      }).success
    ).toBe(false)
  })
})
