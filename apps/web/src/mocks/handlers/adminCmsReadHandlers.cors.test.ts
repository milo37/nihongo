import { describe, expect, it, vi } from 'vitest'
import { mockDatabase } from '@mocks/repository/mockDatabase'

describe('Phase 7 canonical admin technical CORS', () => {
  it('exact base headers를 auth/rate/source read 없이 반환한다', async () => {
    const sourceRead = vi.spyOn(
      mockDatabase,
      'listPhase7AuthoritativeAdminQuestionSources'
    )
    const response = await fetch('http://localhost/api/v1/admin/questions', {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost' }
    })

    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe(
      'http://localhost'
    )
    expect(response.headers.get('access-control-allow-credentials')).toBe(
      'true'
    )
    expect(response.headers.get('access-control-allow-headers')).toBe(
      'Content-Type'
    )
    expect(response.headers.get('access-control-allow-methods')).toBe(
      'DELETE, GET, OPTIONS, PATCH, POST, PUT'
    )
    expect(response.headers.get('access-control-expose-headers')).toBe(
      'Content-Disposition, Idempotency-Replayed, Location, Retry-After, X-Request-Id, X-Nihongo-Practice-Contract'
    )
    expect(response.headers.get('access-control-max-age')).toBe('600')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('vary')).toBe('Origin')
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(sourceRead).not.toHaveBeenCalled()
  })

  it('GET success/error는 technical CORS를 적용하고 alias 404는 pre-CORS로 유지한다', async () => {
    mockDatabase.loginAs('ADMIN')
    const trusted = await fetch(
      'http://localhost/api/v1/admin/questions?pageSize=1',
      {
        headers: { Origin: 'http://localhost' }
      }
    )
    expect(trusted.status).toBe(200)
    expect(trusted.headers.get('access-control-allow-origin')).toBe(
      'http://localhost'
    )
    expect(trusted.headers.get('access-control-allow-credentials')).toBe('true')
    expect(trusted.headers.get('access-control-expose-headers')).toBe(
      'Content-Disposition, Idempotency-Replayed, Location, Retry-After, X-Request-Id, X-Nihongo-Practice-Contract'
    )
    expect(trusted.headers.get('vary')).toBe('Origin')

    const untrusted = await fetch(
      'http://localhost/api/v1/admin/questions?pageSize=1',
      {
        headers: { Origin: 'https://example.invalid' }
      }
    )
    expect(untrusted.status).toBe(200)
    expect(untrusted.headers.get('access-control-allow-origin')).toBeNull()
    expect(untrusted.headers.get('access-control-allow-credentials')).toBe(
      'true'
    )

    const validation = await fetch(
      'http://localhost/api/v1/admin/questions?page=1&page=2',
      { headers: { Origin: 'http://localhost' } }
    )
    expect(validation.status).toBe(422)
    expect(validation.headers.get('access-control-allow-origin')).toBe(
      'http://localhost'
    )

    const alias = await fetch('http://localhost/api/v1/%61dmin/questions', {
      headers: { Origin: 'http://localhost' }
    })
    expect(alias.status).toBe(404)
    expect(alias.headers.get('access-control-allow-origin')).toBeNull()
    expect(alias.headers.get('access-control-allow-credentials')).toBeNull()
  })
})
