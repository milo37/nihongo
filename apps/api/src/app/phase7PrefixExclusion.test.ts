import { describe, expect, it } from 'vitest'
import { isPhase7ExcludedRequest } from './phase7PrefixExclusion.js'

describe('Phase 7 prefix exclusion classifier', () => {
  it.each([
    '/api/v1/admin',
    '/api/v1/admin/questions',
    '/api/v1/question-reports',
    '/api/v1/question-reports/019d0000-0000-7000-8000-000000000001',
    '/API/V1/ADMIN',
    '/api//v1/admin',
    '/api/v1/ignored/../admin',
    '/api/v1/admin/../questions',
    '/api/v1/admin/%2e%2e/questions',
    '/api/v1/%61dmin',
    '/api/v1/%2561dmin',
    '/api/v1/%252561dmin/questions',
    '/api/v1/%61dmin/%ZZ',
    '/api/v1/%71uestion-reports/%ZZ',
    '/api/v1%2fquestion-reports',
    '/api\\v1\\admin'
  ])('literal/decoded alias %s를 제외한다', (pathname) => {
    expect(isPhase7ExcludedRequest(`http://localhost:3001${pathname}`)).toBe(
      true
    )
  })

  it('adapter가 보존한 origin-form request-target도 그대로 검사한다', () => {
    expect(
      isPhase7ExcludedRequest('/api/v1/admin/%252e%252e/questions?x=1')
    ).toBe(true)
  })

  it.each([
    String.raw`http://localhost:3001\api\v1\admin\questions`,
    String.raw`https://localhost:3001\api\v1\question-reports\019d0000-0000-7000-8000-000000000001`,
    String.raw`http:\\localhost:3001\api\v1\admin`,
    String.raw`http:/\localhost:3001\api\v1\question-reports`,
    String.raw`http:\\localhost:3001\api\v1\admin\..\..\..\health\live`,
    String.raw`http:/\localhost:3001\api\v1\question-reports\..\..\..\health\ready`
  ])('WHATWG absolute-form backslash alias %s를 제외한다', (requestTarget) => {
    expect(isPhase7ExcludedRequest(requestTarget)).toBe(true)
  })

  it.each([
    'http://localhost:3001?next=/api/v1/admin',
    'http://localhost:3001#next=/api/v1/question-reports',
    String.raw`http:\\localhost:3001?next=/api/v1/admin`,
    String.raw`http:/\localhost:3001#next=/api/v1/question-reports`
  ])(
    'absolute-form의 query/fragment %s를 pathname으로 오인하지 않는다',
    (target) => {
      expect(isPhase7ExcludedRequest(target)).toBe(false)
    }
  )

  it.each([
    '/api/v1/questions',
    '/api/v1/administrator',
    '/api/v1/question-report',
    '/api/v1/question-reports-archive',
    '/health/live'
  ])('비 Phase 7 경로 %s는 통과시킨다', (pathname) => {
    expect(isPhase7ExcludedRequest(`http://localhost:3001${pathname}`)).toBe(
      false
    )
  })
})
