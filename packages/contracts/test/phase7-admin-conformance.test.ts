import { describe, expect, it } from 'vitest'

import {
  assertPhase7OperationFailureResponse,
  assertPhase7ErrorPolicyManifest,
  assertPhase7OperationManifest,
  assertPhase7OperationSchemaManifest,
  buildPhase7OperationFailureResponse,
  computePhase7Retryability,
  phase7ErrorSurfaceByOperation,
  phase7DormantAfterSlice3AOperationManifest,
  phase7DormantAfterSlice3RA1OperationManifest,
  phase7OperationManifest,
  phase7OperationSchemaManifest,
  phase7OperationSchemas,
  phase7ActiveThroughSlice3AOperationManifest,
  phase7ActiveThroughSlice3RA1OperationManifest,
  phase7Slice3ACommandOperationManifest,
  phase7Slice3RRemediationOperationManifest,
  phase7Slice2ReadOperationManifest
} from '../src/admin/phase7.js'
import {
  assertPhase7Slice2ConformanceManifest,
  phase7DeferredOperationManifest,
  phase7OperationErrorConformanceManifest,
  phase7Slice2ExpectedOperations,
  phase7Slice2ReadConformanceManifest
} from '../src/testing/phase7-admin-conformance.js'

const requestId = '019a1234-5678-7abc-8def-0123456789ab'

const failure = (code: string, retryable: boolean) => ({
  code,
  message: 'contract failure',
  requestId,
  retryable
})

describe('Phase 7 operation and Slice 2 conformance manifests', () => {
  it('closes exactly 28 operations with exactly eight active GET reads', () => {
    expect(() => assertPhase7OperationManifest()).not.toThrow()
    expect(phase7OperationManifest).toHaveLength(28)
    expect(phase7Slice2ReadOperationManifest).toHaveLength(8)
    expect(
      phase7Slice2ReadOperationManifest.every((entry) => entry.method === 'GET')
    ).toBe(true)
  })

  it('fixes the exact ordered Slice 3A active and Slice 3R dormant tuples', () => {
    const tuple = (entry: (typeof phase7OperationManifest)[number]) => [
      entry.operation,
      entry.operationId,
      entry.method,
      entry.path,
      entry.successStatus,
      entry.requiresFreshAssurance
    ]
    expect(phase7Slice3ACommandOperationManifest.map(tuple)).toEqual([
      [
        'createAdminQuestion',
        'admin.createAdminQuestion',
        'POST',
        '/api/v1/admin/questions',
        201,
        false
      ],
      [
        'createAdminQuestionVersion',
        'admin.createAdminQuestionVersion',
        'POST',
        '/api/v1/admin/questions/:questionId/versions',
        201,
        false
      ],
      [
        'updateQuestionVersion',
        'admin.updateQuestionVersion',
        'PATCH',
        '/api/v1/admin/question-versions/:versionId',
        200,
        false
      ],
      [
        'requestContentReview',
        'admin.requestContentReview',
        'POST',
        '/api/v1/admin/question-versions/:versionId/review-request',
        200,
        false
      ],
      [
        'requestQuestionChanges',
        'admin.requestQuestionChanges',
        'POST',
        '/api/v1/admin/question-versions/:versionId/change-request',
        200,
        false
      ]
    ])
    expect(phase7Slice3RRemediationOperationManifest.map(tuple)).toEqual([
      [
        'approveQuestionVersion',
        'admin.approveQuestionVersion',
        'POST',
        '/api/v1/admin/question-versions/:versionId/approval',
        200,
        true
      ],
      [
        'withdrawQuestionApproval',
        'admin.withdrawQuestionApproval',
        'POST',
        '/api/v1/admin/question-versions/:versionId/approval-withdrawal',
        200,
        true
      ],
      [
        'reauthenticateAdmin',
        'admin.reauthenticateAdmin',
        'POST',
        '/api/v1/admin/reauthentication',
        200,
        false
      ]
    ])
    expect(
      phase7ActiveThroughSlice3AOperationManifest.map(
        (entry) => entry.operation
      )
    ).toEqual(
      phase7OperationManifest
        .filter(
          (entry) =>
            entry.slice2Route ||
            phase7Slice3ACommandOperationManifest.includes(entry as never)
        )
        .map((entry) => entry.operation)
    )
    expect(phase7ActiveThroughSlice3AOperationManifest).toHaveLength(13)
    expect(phase7DormantAfterSlice3AOperationManifest).toHaveLength(15)
    expect(
      phase7DormantAfterSlice3AOperationManifest.map((entry) => entry.operation)
    ).toEqual(
      phase7OperationManifest
        .filter(
          (entry) =>
            !phase7ActiveThroughSlice3AOperationManifest.includes(
              entry as never
            )
        )
        .map((entry) => entry.operation)
    )

    expect(phase7ActiveThroughSlice3RA1OperationManifest).toHaveLength(14)
    expect(phase7DormantAfterSlice3RA1OperationManifest).toHaveLength(14)
    expect(
      phase7ActiveThroughSlice3RA1OperationManifest.map(
        (entry) => entry.operation
      )
    ).toEqual(
      phase7OperationManifest
        .filter(
          (entry) =>
            phase7ActiveThroughSlice3AOperationManifest.includes(
              entry as never
            ) || entry.operation === 'reauthenticateAdmin'
        )
        .map((entry) => entry.operation)
    )
    expect(
      phase7DormantAfterSlice3RA1OperationManifest.map(
        (entry) => entry.operation
      )
    ).toEqual(
      phase7OperationManifest
        .filter(
          (entry) =>
            !phase7ActiveThroughSlice3RA1OperationManifest.includes(
              entry as never
            )
        )
        .map((entry) => entry.operation)
    )
  })

  it('exports one named ErrorCodeSchema for every manifest operation', async () => {
    const phase7Exports = await import('../src/admin/phase7.js')
    const actual = Object.keys(phase7Exports)
      .filter((name) => name.endsWith('ErrorCodeSchema'))
      .sort()
    const expected = phase7OperationManifest
      .map((entry) => entry.operation + 'ErrorCodeSchema')
      .sort()
    expect(actual).toEqual(expected)
  })

  it('binds every operation to exact closed request and response schemas', () => {
    expect(() => assertPhase7OperationSchemaManifest()).not.toThrow()
    expect(Object.keys(phase7OperationSchemas)).toEqual(
      phase7OperationManifest.map((entry) => entry.operation)
    )
    expect(phase7OperationSchemaManifest).toHaveLength(28)
    phase7OperationSchemaManifest.forEach((entry) => {
      expect(entry.schemas).toBe(phase7OperationSchemas[entry.operation])
      expect(
        [
          entry.schemas.params,
          entry.schemas.query,
          entry.schemas.body,
          entry.schemas.success,
          entry.schemas.error
        ].every((schema) => typeof schema.safeParse === 'function')
      ).toBe(true)
    })
  })

  it('fixes the canonical Slice 2 route order and 20 deferred operations', () => {
    expect(() => assertPhase7Slice2ConformanceManifest()).not.toThrow()
    expect(
      phase7Slice2ReadConformanceManifest.map((entry) => entry.operation)
    ).toEqual(phase7Slice2ExpectedOperations)
    expect(phase7DeferredOperationManifest).toHaveLength(20)
    expect(
      phase7Slice2ReadConformanceManifest.every(
        (entry) =>
          entry.cacheControl === 'private, no-store' &&
          entry.requestIdHeader === 'X-Request-Id' &&
          entry.rateLimitGroup === 'ADMIN_READ'
      )
    ).toBe(true)
  })

  it('classifies every operation into the exact retryability surface matrix', () => {
    expect(() => assertPhase7ErrorPolicyManifest()).not.toThrow()
    expect(phase7OperationErrorConformanceManifest).toHaveLength(28)
    expect(
      phase7OperationErrorConformanceManifest.reduce<Record<string, number>>(
        (counts, entry) => ({
          ...counts,
          [entry.errorSurface]: (counts[entry.errorSurface] ?? 0) + 1
        }),
        {}
      )
    ).toEqual({
      GET_READ: 10,
      KEYLESS_MUTATION: 14,
      VALIDATION_WRITE_ZERO: 1,
      APPLY_IMPORT: 1,
      EXPORT: 1,
      REAUTHENTICATION: 1
    })
    phase7OperationErrorConformanceManifest.forEach((entry) => {
      expect(entry.errorSurface).toBe(
        phase7ErrorSurfaceByOperation[entry.operation]
      )
      expect(entry.deterministic4xxRetryable).toBe(false)
      expect(entry.rateLimitedRetryable).toBe(true)
      expect(entry.rateLimitedRetryAfterRequired).toBe(true)
    })
  })

  it('enforces wire retryability for all 28 named operation error schemas', () => {
    phase7OperationErrorConformanceManifest.forEach((entry) => {
      const schema = phase7OperationSchemas[entry.operation].error
      expect(
        schema.safeParse(failure('AUTHENTICATION_REQUIRED', false)).success
      ).toBe(true)
      expect(
        schema.safeParse(failure('AUTHENTICATION_REQUIRED', true)).success
      ).toBe(false)
      expect(schema.safeParse(failure('RATE_LIMITED', true)).success).toBe(true)
      expect(schema.safeParse(failure('RATE_LIMITED', false)).success).toBe(
        false
      )

      const transientExpectation =
        entry.errorSurface === 'GET_READ' ||
        entry.errorSurface === 'VALIDATION_WRITE_ZERO'
          ? true
          : entry.errorSurface === 'REAUTHENTICATION'
            ? false
            : null
      for (const code of [
        'INTERNAL_SERVER_ERROR',
        'SERVICE_UNAVAILABLE'
      ] as const) {
        if (transientExpectation === null) {
          expect(schema.safeParse(failure(code, true)).success).toBe(true)
          expect(schema.safeParse(failure(code, false)).success).toBe(true)
        } else {
          expect(
            schema.safeParse(failure(code, transientExpectation)).success
          ).toBe(true)
          expect(
            schema.safeParse(failure(code, !transientExpectation)).success
          ).toBe(false)
        }
      }
    })
  })

  it('computes transient retryability from operation and disposition', () => {
    phase7OperationErrorConformanceManifest.forEach((entry) => {
      expect(
        computePhase7Retryability({
          operation: entry.operation,
          code: 'AUTHENTICATION_REQUIRED',
          disposition: 'NO_TX'
        })
      ).toBe(false)
      expect(
        computePhase7Retryability({
          operation: entry.operation,
          code: 'RATE_LIMITED',
          disposition: 'NO_TX'
        })
      ).toBe(true)

      for (const disposition of [
        'NO_TX',
        'DEFINITE_ROLLBACK',
        'COMMIT_CONFIRMED',
        'COMMIT_UNKNOWN'
      ] as const) {
        const expected = entry.transientRetryabilityByDisposition[disposition]
        const compute = () =>
          computePhase7Retryability({
            operation: entry.operation,
            code: 'SERVICE_UNAVAILABLE',
            disposition
          })
        if (expected === null) {
          expect(compute).toThrow()
        } else {
          expect(compute()).toBe(expected)
        }
      }
    })
    expect(() =>
      computePhase7Retryability({
        operation: 'createAdminQuestion',
        code: 'RATE_LIMITED',
        disposition: 'DEFINITE_ROLLBACK'
      })
    ).toThrow()
  })

  it('closes the five duplicate-race exceptions without widening them', () => {
    const duplicateRaceOperations = phase7OperationErrorConformanceManifest
      .filter((entry) => entry.duplicateRaceRetryable === false)
      .map((entry) => entry.operation)
    expect(duplicateRaceOperations).toEqual([
      'createAdminQuestion',
      'createAdminQuestionVersion',
      'updateQuestionVersion',
      'publishQuestionVersion',
      'applyQuestionImport'
    ])
    duplicateRaceOperations.forEach((operation) => {
      expect(
        computePhase7Retryability({
          operation,
          code: 'SERVICE_UNAVAILABLE',
          disposition: 'DEFINITE_ROLLBACK',
          internalReason: 'CONTENT_DUPLICATE_CONCURRENT_RACE'
        })
      ).toBe(false)
    })
    expect(() =>
      computePhase7Retryability({
        operation: 'archiveAdminQuestion',
        code: 'SERVICE_UNAVAILABLE',
        disposition: 'DEFINITE_ROLLBACK',
        internalReason: 'CONTENT_DUPLICATE_CONCURRENT_RACE'
      })
    ).toThrow()
  })

  it('builds and asserts canonical status/body/header transport', () => {
    const deterministic = buildPhase7OperationFailureResponse({
      operation: 'listAdminQuestions',
      failure: {
        code: 'ADMIN_REQUIRED',
        message: '관리자 권한이 필요합니다.',
        requestId
      },
      disposition: 'NO_TX'
    })
    expect(deterministic).toEqual({
      status: 403,
      body: {
        code: 'ADMIN_REQUIRED',
        message: '관리자 권한이 필요합니다.',
        requestId,
        retryable: false
      },
      headers: {
        'Cache-Control': 'private, no-store',
        'X-Request-Id': requestId
      }
    })
    expect(() =>
      assertPhase7OperationFailureResponse({
        operation: 'listAdminQuestions',
        response: deterministic,
        disposition: 'NO_TX'
      })
    ).not.toThrow()

    expect(() =>
      buildPhase7OperationFailureResponse({
        operation: 'listAdminQuestions',
        failure: {
          code: 'RATE_LIMITED',
          message: 'too many requests',
          requestId
        },
        disposition: 'NO_TX'
      })
    ).toThrow()
    const limited = buildPhase7OperationFailureResponse({
      operation: 'listAdminQuestions',
      failure: {
        code: 'RATE_LIMITED',
        message: 'too many requests',
        requestId
      },
      disposition: 'NO_TX',
      retryAfterSeconds: 7
    })
    expect(limited.status).toBe(429)
    expect(limited.body.retryable).toBe(true)
    expect(limited.headers['Retry-After']).toBe('7')

    const commitUnknown = buildPhase7OperationFailureResponse({
      operation: 'createAdminQuestion',
      failure: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'commit outcome unknown',
        requestId
      },
      disposition: 'COMMIT_UNKNOWN',
      retryAfterSeconds: 3
    })
    expect(commitUnknown.status).toBe(503)
    expect(commitUnknown.body.retryable).toBe(false)
    expect(commitUnknown.headers['Retry-After']).toBe('3')

    const reauthentication = buildPhase7OperationFailureResponse({
      operation: 'reauthenticateAdmin',
      failure: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'reauthentication failed',
        requestId
      },
      disposition: 'NO_TX'
    })
    expect(reauthentication.body.retryable).toBe(false)
  })

  it('rejects tampered status, no-store, request ID, and Retry-After transport', () => {
    const limited = buildPhase7OperationFailureResponse({
      operation: 'listAdminQuestions',
      failure: {
        code: 'RATE_LIMITED',
        message: 'too many requests',
        requestId
      },
      disposition: 'NO_TX',
      retryAfterSeconds: 7
    })
    const assertResponse = (
      response: typeof limited
    ): ReturnType<typeof assertPhase7OperationFailureResponse> =>
      assertPhase7OperationFailureResponse({
        operation: 'listAdminQuestions',
        response,
        disposition: 'NO_TX'
      })

    expect(() => assertResponse({ ...limited, status: 500 })).toThrow()
    expect(() =>
      assertResponse({
        ...limited,
        headers: { ...limited.headers, 'Cache-Control': 'public' }
      })
    ).toThrow()
    expect(() =>
      assertResponse({
        ...limited,
        headers: {
          ...limited.headers,
          'X-Request-Id': '019a1234-5678-7abc-8def-0123456789ac'
        }
      })
    ).toThrow()
    expect(() =>
      assertResponse({
        ...limited,
        headers: {
          'Cache-Control': 'private, no-store',
          'X-Request-Id': requestId
        }
      })
    ).toThrow()
    for (const retryAfter of ['0', '1e3', '1.0', ' 1']) {
      expect(() =>
        assertResponse({
          ...limited,
          headers: { ...limited.headers, 'Retry-After': retryAfter }
        })
      ).toThrow()
    }
  })
})
