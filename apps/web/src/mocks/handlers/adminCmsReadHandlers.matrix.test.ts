import {
  encodeAdminQuestionVersionCursor,
  listAdminQuestionsResponseSchema,
  listAdminQuestionVersionsResponseSchema
} from '@nihongo/contracts/admin/phase7'
import { apiFailureSchema } from '@nihongo/contracts/common/error'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetAdminCmsReadRateLimitForTesting } from '@mocks/handlers/adminCmsReadHandlers'
import { mockDatabase } from '@mocks/repository/mockDatabase'

const BASE = 'http://localhost/api/v1/admin'

beforeEach(() => resetAdminCmsReadRateLimitForTesting())

describe('Phase 7 canonical admin read boundary matrix', () => {
  it('query 오류 body를 Hono와 일치시키고 source read 전에 닫는다', async () => {
    mockDatabase.loginAs('ADMIN')
    const sourceRead = vi.spyOn(
      mockDatabase,
      'listCanonicalAdminQuestionSources'
    )

    for (const query of ['=x', '__proto__=x', 'constructor=x', 'q=%E0%A4%A']) {
      const response = await fetch(BASE + '/questions?' + query)
      expect(response.status).toBe(422)
      expect(apiFailureSchema.parse(await response.json()).fieldErrors).toEqual(
        {
          query: ['쿼리 문자열이 올바르지 않습니다.']
        }
      )
    }

    const duplicateQueries: readonly [string, string][] = [
      [BASE + '/questions?page=1&page=2', 'page'],
      [BASE + '/tags?q=jlpt&q=n5', 'q']
    ]
    for (const [url, key] of duplicateQueries) {
      const response = await fetch(url)
      expect(response.status).toBe(422)
      expect(apiFailureSchema.parse(await response.json()).fieldErrors).toEqual(
        {
          [key]: ['중복 쿼리 키는 허용되지 않습니다.']
        }
      )
    }

    expect((await fetch(BASE + '/questions?unknown=1')).status).toBe(422)
    expect(sourceRead).not.toHaveBeenCalled()
  })

  it('UUID v1-v8과 noncanonical variants를 구분한다', async () => {
    mockDatabase.loginAs('ADMIN')
    for (const version of ['1', '6', '7', '8']) {
      const id = `00000000-0000-${version}000-8000-000000000000`
      const response = await fetch(`${BASE}/question-versions/${id}/preview`)
      expect(response.status).toBe(404)
      expect(apiFailureSchema.parse(await response.json()).message).toBe(
        '문제 버전을 찾을 수 없습니다.'
      )
    }
    for (const id of [
      '00000000-0000-0000-8000-000000000000',
      '00000000-0000-f000-8000-000000000000',
      '00000000-0000-6000-7000-000000000000',
      '00000000-0000-6000-C000-000000000000'
    ]) {
      const response = await fetch(`${BASE}/question-versions/${id}/preview`)
      expect(response.status).toBe(404)
      expect(apiFailureSchema.parse(await response.json()).message).toBe(
        '요청한 경로를 찾을 수 없습니다.'
      )
    }
    const list = listAdminQuestionsResponseSchema.parse(
      await (await fetch(`${BASE}/questions?pageSize=1`)).json()
    )
    const item = list.items[0]
    if (!item) throw new Error('canonical seed fixture가 필요합니다.')
    expect(
      (await fetch(`${BASE}/questions/${item.questionId.toUpperCase()}`)).status
    ).toBe(404)
    expect((await fetch(`${BASE}/questions/${item.questionId}/`)).status).toBe(
      404
    )
    expect(
      (await fetch(`${BASE}/questions/${item.questionId}`, { method: 'HEAD' }))
        .status
    ).toBe(404)
  })

  it('encoded/case/slash/dot Phase 7 aliases를 generic 404로 닫는다', async () => {
    const authRead = vi.spyOn(mockDatabase, 'getCurrentUser')
    const sourceRead = vi.spyOn(
      mockDatabase,
      'listCanonicalAdminQuestionSources'
    )
    const aliases = [
      '/api/v1/%61dmin/questions',
      '/api/v1/%252561dmin/questions',
      '/API/V1/ADMIN/questions',
      '/api//v1/admin/questions',
      '/api/v1/admin%2fquestions',
      '/api/v1/admin%5cquestions',
      '/api/v1/admin/%252e/questions',
      '/api/v1/not-admin/%252e%252e/admin/questions',
      '/api/v1/%2571uestion-reports'
    ]

    for (const pathname of aliases) {
      const response = await fetch('http://localhost' + pathname)
      expect(response.status).toBe(404)
      expect(apiFailureSchema.parse(await response.json())).toMatchObject({
        code: 'RESOURCE_NOT_FOUND',
        message: '요청한 경로를 찾을 수 없습니다.',
        retryable: false
      })
    }

    expect(authRead).not.toHaveBeenCalled()
    expect(sourceRead).not.toHaveBeenCalled()
  })

  it('OPTIONS는 auth/rate/source 없이 exact canonical path만 처리한다', async () => {
    const sourceRead = vi.spyOn(
      mockDatabase,
      'listCanonicalAdminQuestionSources'
    )
    const preflight = await fetch(`${BASE}/questions`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost' }
    })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-origin')).toBe(
      'http://localhost'
    )
    expect(preflight.headers.get('access-control-allow-methods')).toBe(
      'DELETE, GET, OPTIONS, PATCH, POST, PUT'
    )
    expect(sourceRead).not.toHaveBeenCalled()
    expect(
      (
        await fetch(`${BASE}/questions/`, {
          method: 'OPTIONS',
          headers: { Origin: 'http://localhost' }
        })
      ).status
    ).toBe(404)
    const untrusted = await fetch(BASE + '/questions', {
      method: 'OPTIONS',
      headers: { Origin: 'https://example.invalid' }
    })
    expect(untrusted.status).toBe(204)
    expect(untrusted.headers.get('access-control-allow-origin')).toBeNull()
    const missing = await fetch(BASE + '/questions', { method: 'OPTIONS' })
    expect(missing.status).toBe(204)
    expect(missing.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('cursor exhaustion과 cross-question diff를 닫는다', async () => {
    mockDatabase.loginAs('ADMIN')
    const list = listAdminQuestionsResponseSchema.parse(
      await (await fetch(`${BASE}/questions?pageSize=2`)).json()
    )
    const [first, second] = list.items
    if (!first || !second) throw new Error('두 개의 seed fixture가 필요합니다.')
    const cursor = encodeAdminQuestionVersionCursor({
      versionNumber: 1,
      id: first.selectedVersionId
    })
    const exhausted = await fetch(
      `${BASE}/questions/${first.questionId}/versions?cursor=${encodeURIComponent(cursor)}`
    )
    expect(
      listAdminQuestionVersionsResponseSchema.parse(await exhausted.json())
        .items
    ).toEqual([])
    expect(
      (
        await fetch(
          `${BASE}/question-versions/${first.selectedVersionId}/diff?baseVersionId=${second.selectedVersionId}`
        )
      ).status
    ).toBe(404)
  })

  it('shared operation policy로 429 retryability와 Retry-After를 함께 만든다', async () => {
    mockDatabase.loginAs('ADMIN')
    for (let request = 0; request < 120; request += 1) {
      expect((await fetch(`${BASE}/questions?pageSize=1`)).status).toBe(200)
    }

    const limited = await fetch(`${BASE}/questions?pageSize=1`)
    const body = apiFailureSchema.parse(await limited.json())

    expect(limited.status).toBe(429)
    expect(body).toMatchObject({ code: 'RATE_LIMITED', retryable: true })
    expect(limited.headers.get('retry-after')).toMatch(/^[1-9][0-9]*$/u)
    expect(limited.headers.get('cache-control')).toBe('private, no-store')
    expect(limited.headers.get('x-request-id')).toBe(body.requestId)
  })

  it('list leakage, dormant reports, legacy GET/POST 회귀를 고정한다', async () => {
    mockDatabase.loginAs('ADMIN')
    const serialized = JSON.stringify(
      await (await fetch(`${BASE}/questions?pageSize=100`)).json()
    )
    for (const forbidden of [
      'correctOptionId',
      'explanationKo',
      'explanationJa',
      'options'
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
    expect(
      (await fetch('http://localhost/api/v1/question-reports')).status
    ).toBe(404)
    expect(
      (
        await fetch('http://localhost/api/v1/question-reports', {
          method: 'POST'
        })
      ).status
    ).toBe(404)
    expect(
      (await fetch('http://localhost/api/admin/question?pageSize=100')).status
    ).toBe(200)
    expect(
      (
        await fetch('http://localhost/api/admin/question', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}'
        })
      ).status
    ).not.toBe(404)
  })
})
