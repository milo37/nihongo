import {
  phase7Slice3ACommandOperationManifest,
  phase7Slice3RRemediationOperationManifest
} from '@nihongo/contracts/admin/phase7'
import { describe, expect, it } from 'vitest'
import {
  getCanonicalPhase7Slice3Operation,
  isCanonicalPhase7ActiveRequest,
  isPhase7ExcludedRequest
} from './phase7PrefixExclusion.js'

const canonicalId = '019d0000-0000-7000-8000-000000000001'
const deeplyNestedAdminAlias = `/api/v1/%${'25'.repeat(32)}61dmin/questions`
const materializePath = (path: string): string =>
  path.replace(':questionId', canonicalId).replace(':versionId', canonicalId)

describe('Phase 7 prefix exclusion classifier', () => {
  it('maps exactly the five active Slice 3A command operations', () => {
    const manifest = phase7Slice3ACommandOperationManifest
    expect(
      manifest.map((entry) =>
        getCanonicalPhase7Slice3Operation({
          method: entry.method,
          requestTarget: materializePath(entry.path)
        })
      )
    ).toEqual(manifest.map((entry) => entry.operation))
    expect(manifest).toHaveLength(5)
  })

  it('keeps all three Slice 3R remediation operations dormant', () => {
    expect(
      phase7Slice3RRemediationOperationManifest.map((entry) =>
        getCanonicalPhase7Slice3Operation({
          method: entry.method,
          requestTarget: materializePath(entry.path)
        })
      )
    ).toEqual([null, null, null])
  })

  it.each([
    ['GET', '/api/v1/admin/questions'],
    ['POST', '/api/v1/admin/questions#alias'],
    ['POST', '/api/v1/admin/questions/'],
    ['POST', `/api/v1/admin/questions/${canonicalId.toUpperCase()}/versions`],
    [
      'POST',
      '/api/v1/admin/questions/00000000-0000-0000-0000-000000000000/versions'
    ],
    ['POST', `/api/v1/admin/questions/${canonicalId}/archive`],
    ['POST', `/api/v1/admin/question-versions/${canonicalId}/publication`],
    ['POST', `/api/v1/admin/question-versions/${canonicalId}/retirement`],
    ['POST', '/api/v1/admin/questions/import-validation'],
    ['POST', '/api/v1/admin/questions/export'],
    ['POST', `/api/v1/admin/question-versions/${canonicalId}/approval`],
    [
      'POST',
      `/api/v1/admin/question-versions/${canonicalId}/approval-withdrawal`
    ],
    ['POST', '/api/v1/admin/reauthentication'],
    ['POST', `/API/v1/admin/question-versions/${canonicalId}/approval`]
  ])(
    'keeps wrong-method, alias, malformed and dormant %s %s inactive',
    (method, requestTarget) => {
      expect(
        getCanonicalPhase7Slice3Operation({ method, requestTarget })
      ).toBeNull()
      expect(isCanonicalPhase7ActiveRequest({ method, requestTarget })).toBe(
        method === 'GET' && requestTarget === '/api/v1/admin/questions'
      )
    }
  )

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
    deeplyNestedAdminAlias,
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

  it('fragment가 붙은 protected path는 제외하되 canonical operation으로 실행하지 않는다', () => {
    const requestTarget = '/api/v1/admin/questions#alias'
    expect(isPhase7ExcludedRequest(requestTarget)).toBe(true)
    expect(
      getCanonicalPhase7Slice3Operation({ method: 'POST', requestTarget })
    ).toBeNull()
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
